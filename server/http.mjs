export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

/** Read a JSON body enforcing the size limit *while* streaming (413 before buffering it all). */
export async function readJson(req, limit = 32 * 1024) {
  if (req.body !== undefined && typeof req[Symbol.asyncIterator] !== 'function') return req.body;
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > limit) throw new HttpError(413, 'Solicitud demasiado grande');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Solicitud demasiado grande');
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  if (!size) return {};
  const type = String(req.headers['content-type'] || '');
  if (type.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'Se requiere application/json');
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'JSON inválido'); }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (typeof body === 'string' && headers['Content-Type']) return res.end(body);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function applyCors(req, res, origins) {
  const origin = req.headers.origin;
  if (origin && origins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Nova-Tenant, X-Nova-Request, Idempotency-Key, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = v => typeof v === 'string' && UUID.test(v);

export function str(value, max, {required = false, name = 'campo'} = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `Falta ${name}`);
    return null;
  }
  if (typeof value !== 'string') throw new HttpError(400, `${name} inválido`);
  const t = value.trim();
  if (required && !t) throw new HttpError(400, `Falta ${name}`);
  if (t.length > max) throw new HttpError(400, `${name} excede ${max} caracteres`);
  return t;
}

/** CSV with formula-injection neutralization for text cells. */
export function toCsv(rows) {
  const cell = v => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?[\d.,]+%?$/.test(s)) s = `'${s}`;
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
