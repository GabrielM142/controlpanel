import {readFileSync, readdirSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = new URL('../contracts/', import.meta.url);
const readJson = rel => JSON.parse(readFileSync(new URL(rel, root), 'utf8'));

export const registry = readJson('datasets.json');
export const datasetsByKey = new Map(registry.datasets.map(d => [d.key, d]));
export const SUPPORTED_MANIFESTS = ['nova.export.v1'];

const ajv = new Ajv2020({allErrors: false, strict: true, strictRequired: false});
addFormats(ajv);
const manifestValidator = ajv.compile(readJson('nova.export.v1/manifest.schema.json'));
const partValidator = ajv.compile(readJson('nova.export.v1/part.schema.json'));
const dataValidators = new Map();
for (const file of readdirSync(new URL('nova.export.v1/datasets/', root))) {
  const schema = readJson(`nova.export.v1/datasets/${file}`);
  dataValidators.set(file.replace('.schema.json', ''), ajv.compile(schema));
}

export class ContractError extends Error {
  constructor(message, details) { super(message); this.name = 'ContractError'; this.details = details; }
}

function explain(validator) {
  const e = validator.errors?.[0];
  return e ? `${e.instancePath || '/'} ${e.message}` : 'inválido';
}

/** Validate a manifest and its internal consistency (numbering, counts, datasets). */
export function validateManifest(manifest, {maxParts = 20000, maxPartBytes = 8 * 1024 * 1024} = {}) {
  if (!SUPPORTED_MANIFESTS.includes(manifest?.schema)) throw new ContractError('Versión de manifest incompatible', {schema: manifest?.schema});
  if (!manifestValidator(manifest)) throw new ContractError(`Manifest inválido: ${explain(manifestValidator)}`);
  const parts = manifest.parts;
  if (parts.length > maxParts) throw new ContractError('Demasiadas partes');
  parts.forEach((p, i) => {
    if (p.part_no !== i + 1) throw new ContractError('Numeración de partes no contigua');
    if (p.bytes > maxPartBytes) throw new ContractError(`Parte ${p.part_no} excede el tamaño permitido`);
  });
  if (manifest.totals.parts !== parts.length) throw new ContractError('Total de partes inconsistente');
  if (manifest.totals.records !== parts.reduce((s, p) => s + p.records, 0)) throw new ContractError('Total de registros inconsistente');
  if (manifest.totals.bytes !== parts.reduce((s, p) => s + p.bytes, 0)) throw new ContractError('Total de bytes inconsistente');
  for (const ds of manifest.datasets) {
    const spec = datasetsByKey.get(ds.key);
    if (!spec) throw new ContractError(`Dataset desconocido ${ds.key}`);
    if (ds.version < spec.min_version || ds.version > spec.version) throw new ContractError(`Versión incompatible de ${ds.key}`, {got: ds.version, min: spec.min_version, max: spec.version});
    const own = parts.filter(p => p.dataset === ds.key);
    if (JSON.stringify(own.map(p => p.part_no)) !== JSON.stringify([...ds.parts].sort((a, b) => a - b))) throw new ContractError(`Partes de ${ds.key} inconsistentes`);
    if (own.reduce((s, p) => s + p.records, 0) !== ds.records) throw new ContractError(`Conteo de ${ds.key} inconsistente`);
    if (ds.mode === 'snapshot_replace' && !ds.scope) throw new ContractError(`Snapshot de ${ds.key} sin alcance explícito`);
  }
  for (const p of parts) if (!manifest.datasets.some(d => d.key === p.dataset)) throw new ContractError(`Parte de dataset no declarado ${p.dataset}`);
  return manifest;
}

/** Validate an uncompressed part document against its manifest descriptor. */
export function validatePart(doc, descriptor, manifest) {
  if (!partValidator(doc)) throw new ContractError(`Parte inválida: ${explain(partValidator)}`);
  if (doc.run_uuid !== manifest.run_uuid || doc.part_no !== descriptor.part_no || doc.dataset !== descriptor.dataset) throw new ContractError('Parte no corresponde al manifest');
  if (doc.records.length !== descriptor.records) throw new ContractError('Conteo de la parte distinto al manifest');
  const ds = manifest.datasets.find(d => d.key === doc.dataset);
  if (doc.dataset_version !== ds.version) throw new ContractError('Versión de dataset distinta al manifest');
  const validator = dataValidators.get(doc.dataset);
  const companies = new Set(manifest.companies);
  const spec = datasetsByKey.get(doc.dataset);
  for (const rec of doc.records) {
    if (rec.op === 'upsert' && !validator(rec.data)) throw new ContractError(`Registro ${doc.dataset}/${rec.id}: ${explain(validator)}`);
    if (spec.company_scope === 'strict' && rec.op === 'upsert' && !companies.has(rec.company_id)) throw new ContractError(`Registro ${doc.dataset}/${rec.id} de compañía no autorizada`);
  }
  return doc;
}
