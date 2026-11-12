// Serves Python-generated fixture batches (tests/fixtures/batches/<source>) with
// the same interface as the Odoo transport. Labelled FIXTURE data, never client
// data. Fault injection hooks let tests simulate corruption, loss and retries.
import {readdirSync, readFileSync} from 'node:fs';

export function createFixtureTransport(sourceName, {root = new URL('../../tests/fixtures/batches/', import.meta.url), visibleRuns = Infinity,
  faults = {}, ...opts} = {}) {
  const base = new URL(`${sourceName}/`, root);
  const read = rel => JSON.parse(readFileSync(new URL(rel, base), 'utf8'));
  const caps = read('capabilities.json');
  const runs = readdirSync(base).filter(d => d.startsWith('run-')).sort().map(dir => ({dir, manifest: read(`${dir}/manifest.json`)}));
  const acked = new Map();
  const calls = {readPart: 0, ackRun: 0, getManifest: 0};
  let linked = opts.linkedRef !== undefined ? opts.linkedRef : (caps.state === 'linked' ? 'fixture' : null);
  const check = source => {
    if (source.installation_uuid !== caps.installation_uuid || source.generation !== caps.generation) {
      const e = new Error('La instalación no coincide.'); e.code = 'access'; throw e;
    }
  };
  const find = uuid => runs.find(r => r.manifest.run_uuid === uuid);
  return {
    calls, acked, caps,
    setVisible(n) { visibleRuns = n; },
    async getCapabilities() { return {...caps, central_source_ref: linked}; },
    async confirmLink(token, ref) {
      if (token !== 'fixture-link-token') throw new Error('Código de vinculación inválido.');
      linked = ref; return {installation_uuid: caps.installation_uuid, generation: caps.generation, state: 'linked'};
    },
    async listReadyRuns(source) {
      check(source);
      const visible = runs.slice(0, visibleRuns);
      return {runs: visible.filter(r => !acked.has(r.manifest.run_uuid)).map(r => ({run_uuid: r.manifest.run_uuid, run_seq: r.manifest.run_seq, state: 'ready'})),
        acknowledged_recent: visible.filter(r => acked.has(r.manifest.run_uuid)).map(r => ({run_uuid: r.manifest.run_uuid, run_seq: r.manifest.run_seq, state: 'acknowledged'}))};
    },
    async getManifest(source, uuid) {
      check(source); calls.getManifest++;
      const m = structuredClone(find(uuid).manifest);
      return faults.manifest ? faults.manifest(m) : m;
    },
    async readPart(source, uuid, partNo) {
      check(source); calls.readPart++;
      if (faults.dropConnectionOnPart === partNo && !faults._dropped) { faults._dropped = true; throw Object.assign(new Error('Fuente no disponible (ECONNRESET)'), {code: 'unreachable'}); }
      const r = find(uuid);
      const part = read(`${r.dir}/part-${String(partNo).padStart(5, '0')}.json`);
      return faults.part ? faults.part(part, partNo) : part;
    },
    async ackRun(source, uuid, receipt) {
      check(source); calls.ackRun++;
      const r = find(uuid);
      const parts = new Map(receipt.parts.map(p => [p.part_no, p.sha256]));
      if (r.manifest.parts.some(p => parts.get(p.part_no) !== p.sha256) || parts.size !== r.manifest.parts.length) throw new Error('Recibo incompleto o con checksum distinto');
      if (acked.has(uuid)) return {status: 'already_acknowledged', receipt_uuid: acked.get(uuid)};
      acked.set(uuid, receipt.receipt_uuid);
      if (faults.loseAckResponse && !faults._ackLost) { faults._ackLost = true; throw Object.assign(new Error('Fuente no disponible (timeout)'), {code: 'unreachable'}); }
      return {status: 'acknowledged', receipt_uuid: receipt.receipt_uuid};
    },
    async requestResync(source, keys) { check(source); return {status: 'scheduled', datasets: keys}; },
  };
}
