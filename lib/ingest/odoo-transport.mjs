// Odoo 16 native JSON-RPC over HTTPS with a dedicated user + API key. Only the
// nova.connector methods are ever called (no generic execute of models).

const METHODS = new Set(['get_capabilities', 'confirm_link', 'list_ready_runs', 'get_manifest', 'read_part',
  'ack_run', 'request_resync']);

export class SourceError extends Error {
  constructor(message, {code = 'source_error', retryable = true} = {}) {
    super(message); this.name = 'SourceError'; this.code = code; this.retryable = retryable;
  }
}

async function readLimited(response, maxBytes) {
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) { await reader.cancel(); throw new SourceError('Respuesta de la fuente excede el límite', {code: 'too_large', retryable: false}); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createOdooTransport({baseUrl, db, login, apiKey, timeoutMs = 60000, maxResponseBytes = 16 * 1024 * 1024,
  fetchImpl = globalThis.fetch}) {
  const endpoint = new URL('/jsonrpc', baseUrl).toString();
  let uid = null;
  let seq = 0;

  async function rpc(service, method, args) {
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: {'Content-Type': 'application/json', 'User-Agent': 'nova-connector-client/1'},
        body: JSON.stringify({jsonrpc: '2.0', method: 'call', params: {service, method, args}, id: ++seq}),
      });
    } catch (error) {
      throw new SourceError(`Fuente no disponible (${error.name})`, {code: 'unreachable'});
    }
    if (!response.ok) throw new SourceError(`HTTP ${response.status} de la fuente`, {code: 'http', retryable: response.status >= 500});
    const body = JSON.parse(await readLimited(response, maxResponseBytes));
    if (body.error) {
      const message = String(body.error.data?.message || body.error.message || 'Error RPC').slice(0, 300);
      const name = String(body.error.data?.name || '');
      const access = /AccessError|AccessDenied/.test(name);
      throw new SourceError(message, {code: access ? 'access' : 'rpc', retryable: !access});
    }
    return body.result;
  }

  async function call(method, ...args) {
    if (!METHODS.has(method)) throw new SourceError('Método no permitido', {retryable: false});
    if (!uid) {
      uid = await rpc('common', 'authenticate', [db, login, apiKey, {}]);
      if (!uid) throw new SourceError('Credenciales de integración rechazadas', {code: 'auth', retryable: false});
    }
    return rpc('object', 'execute_kw', [db, uid, apiKey, 'nova.connector', method, args]);
  }

  return {
    getCapabilities: () => call('get_capabilities'),
    confirmLink: (token, ref) => call('confirm_link', token, ref),
    listReadyRuns: (source, limit = 10) => call('list_ready_runs', source, limit),
    getManifest: (source, runUuid) => call('get_manifest', source, runUuid),
    readPart: (source, runUuid, partNo) => call('read_part', source, runUuid, partNo),
    ackRun: (source, runUuid, receipt) => call('ack_run', source, runUuid, receipt),
    requestResync: (source, keys) => call('request_resync', source, keys),
  };
}
