import {createHash, randomUUID} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {ContractError, validateManifest, validatePart} from '../contracts.mjs';

const FINAL = new Set(['received', 'validated', 'applied', 'published']);

export function decodePart(response, descriptor, {maxPartBytes}) {
  if (response?.encoding !== 'gzip+base64' || typeof response.content !== 'string') throw new ContractError('Codificación de parte no soportada');
  if (response.content.length > Math.ceil(maxPartBytes * 4 / 3) + 16) throw new ContractError('Parte comprimida excede el límite');
  if (response.sha256 !== descriptor.sha256 || response.part_no !== descriptor.part_no) throw new ContractError('Parte no coincide con el manifest');
  const gz = Buffer.from(response.content, 'base64');
  let content;
  try {
    // Bounded expansion: refuse anything that inflates beyond the declared size.
    content = gunzipSync(gz, {maxOutputLength: descriptor.bytes});
  } catch {
    throw new ContractError('Parte corrupta o truncada');
  }
  if (content.length !== descriptor.bytes) throw new ContractError('Tamaño de parte distinto al manifest');
  if (createHash('sha256').update(content).digest('hex') !== descriptor.sha256) throw new ContractError('Checksum de parte inválido');
  let doc;
  try { doc = JSON.parse(content.toString('utf8')); } catch { throw new ContractError('Parte con JSON inválido'); }
  return {gz, doc};
}

/**
 * Download, validate and durably store every ready run of a source, then ACK.
 * Idempotent: re-running after any crash re-uses stored parts and re-ACKs.
 */
export async function collectSource({db, source, transport, config, log = () => {}}) {
  const identity = {installation_uuid: source.installation_uuid, generation: source.source_generation};
  const caps = await transport.getCapabilities();
  if (caps.installation_uuid !== source.installation_uuid || caps.generation !== source.source_generation) {
    await db.query(`UPDATE app.connector_sources SET status = 'relink_required', last_error = $2 WHERE id = $1`,
      [source.id, 'La fuente cambió de instalación o generación: re-vincular. Los datos centrales se conservan.']);
    return {status: 'relink_required', runs: []};
  }
  await db.query('UPDATE app.connector_sources SET last_seen_at = now(), capabilities = $2, attribute_map = $3 WHERE id = $1',
    [source.id, JSON.stringify(caps), JSON.stringify(caps.attribute_map || [])]);
  const listing = await transport.listReadyRuns(identity, 10);
  const collected = [];
  const candidates = [...(listing.runs || []), ...(listing.acknowledged_recent || [])]
    .sort((a, b) => a.run_seq - b.run_seq);
  for (const item of candidates) {
    const known = (await db.query('SELECT * FROM ingest.runs WHERE source_id = $1 AND run_uuid = $2', [source.id, item.run_uuid])).rows[0];
    if (item.state === 'acknowledged' && !known) continue; // acknowledged by someone else / long ago: never re-import blindly
    const run = known || (await db.query(
      `INSERT INTO ingest.runs(tenant_id, source_id, run_uuid, run_seq, generation, state)
       VALUES ($1, $2, $3, $4, $5, 'discovered')
       ON CONFLICT (source_id, run_uuid) DO UPDATE SET run_seq = EXCLUDED.run_seq RETURNING *`,
      [source.tenant_id, source.id, item.run_uuid, item.run_seq, source.source_generation])).rows[0];
    if (['failed', 'rejected'].includes(run.state) && run.attempts >= 5) continue;
    try {
      if (!FINAL.has(run.state)) await downloadRun({db, source, transport, config, identity, run, log});
      await ackRun({db, transport, identity, runId: run.id, runUuid: run.run_uuid});
      collected.push(run.id);
    } catch (error) {
      const rejected = error instanceof ContractError;
      // Re-read the current state: a run already durably stored/validated is never downgraded
      // (e.g. only the ACK response was lost) and stays applicable.
      await db.query(`UPDATE ingest.runs SET attempts = attempts + 1, error = $3,
                      state = CASE WHEN state IN ('received', 'validated', 'applied', 'published') THEN state ELSE $2 END,
                      next_attempt_at = now() + make_interval(mins => least(60, 5 * (attempts + 1))) WHERE id = $1`,
        [run.id, rejected ? 'rejected' : 'failed', String(error.message).slice(0, 400)]);
      log('warn', 'run_failed', {source: source.id, run: run.run_uuid, error: error.message});
      if (rejected) break; // never skip a rejected run: later runs would apply out of order
    }
  }
  return {status: 'ok', runs: collected};
}

async function downloadRun({db, source, transport, config, identity, run, log}) {
  await db.query(`UPDATE ingest.runs SET state = 'downloading', attempts = attempts + 1 WHERE id = $1`, [run.id]);
  const manifest = validateManifest(await transport.getManifest(identity, run.run_uuid),
    {maxParts: config.maxRunParts, maxPartBytes: config.maxPartBytes});
  if (manifest.run_uuid !== run.run_uuid || manifest.run_seq !== Number(run.run_seq)) throw new ContractError('Manifest no corresponde al lote');
  if (manifest.source.installation_uuid !== source.installation_uuid || manifest.source.generation !== source.source_generation) throw new ContractError('Manifest de otra instalación/generación');
  const authorized = new Set((await db.query('SELECT company_id FROM app.source_companies WHERE source_id = $1 AND authorized', [source.id])).rows.map(r => Number(r.company_id)));
  if (authorized.size && manifest.companies.some(c => !authorized.has(c))) throw new ContractError('El manifest incluye compañías no autorizadas en NOVA');
  await db.query(`UPDATE ingest.runs SET manifest = $2, business_date = $3, requested_cutoff_at = $4, observed_from = $5, observed_to = $6
                  WHERE id = $1`, [run.id, JSON.stringify(manifest), manifest.business_date, manifest.requested_cutoff_at,
    manifest.observed_from, manifest.observed_to]);
  const stored = new Map((await db.query('SELECT part_no, sha256 FROM ingest.parts WHERE run_id = $1', [run.id])).rows.map(r => [r.part_no, r.sha256]));
  for (const descriptor of manifest.parts) {
    if (stored.get(descriptor.part_no) === descriptor.sha256) continue; // retry: never download twice
    const response = await transport.readPart(identity, run.run_uuid, descriptor.part_no);
    const {gz, doc} = decodePart(response, descriptor, config);
    validatePart(doc, descriptor, manifest);
    await db.query(`INSERT INTO ingest.parts(run_id, tenant_id, part_no, dataset, records, bytes, sha256, payload)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (run_id, part_no) DO NOTHING`,
      [run.id, source.tenant_id, descriptor.part_no, descriptor.dataset, descriptor.records, descriptor.bytes, descriptor.sha256, gz]);
  }
  const count = Number((await db.query('SELECT count(*) AS n FROM ingest.parts WHERE run_id = $1', [run.id])).rows[0].n);
  if (count !== manifest.parts.length) throw new Error('Partes faltantes tras la descarga');
  await db.query(`UPDATE ingest.runs SET state = 'validated', received_at = now(), validated_at = now(), error = NULL WHERE id = $1`, [run.id]);
  log('info', 'run_received', {source: source.id, run: run.run_uuid, parts: count});
}

/** ACK only after durable storage of every validated part. Lost ACK => re-ACK (idempotent at source). */
async function ackRun({db, transport, identity, runId, runUuid}) {
  const run = (await db.query('SELECT state, acked_at, manifest FROM ingest.runs WHERE id = $1', [runId])).rows[0];
  if (run.acked_at || !FINAL.has(run.state)) return;
  const parts = (await db.query('SELECT part_no, sha256 FROM ingest.parts WHERE run_id = $1 ORDER BY part_no', [runId])).rows;
  if (parts.length !== run.manifest.parts.length) throw new Error('No se puede confirmar un lote incompleto');
  const receipt = (await db.query(`INSERT INTO ingest.receipts(run_id, tenant_id, receipt_uuid)
      SELECT id, tenant_id, $2 FROM ingest.runs WHERE id = $1
      ON CONFLICT (run_id) DO UPDATE SET run_id = EXCLUDED.run_id RETURNING receipt_uuid`, [runId, randomUUID()])).rows[0];
  const response = await transport.ackRun(identity, runUuid, {receipt_uuid: receipt.receipt_uuid,
    parts: parts.map(p => ({part_no: p.part_no, sha256: p.sha256}))});
  await db.query('UPDATE ingest.receipts SET acked_at = now(), response = $2 WHERE run_id = $1', [runId, JSON.stringify(response)]);
  await db.query('UPDATE ingest.runs SET acked_at = now() WHERE id = $1', [runId]);
}
