import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';

// SSRF protection for administratively registered Odoo endpoints: HTTPS only
// (HTTP only with an explicit staging flag), no credentials in URL, and no
// private/loopback/link-local/metadata addresses unless the host is allowlisted.

function ipv4Private(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function ipv6Private(ip) {
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::') return true;
  if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  return mapped ? ipv4Private(mapped[1]) : false;
}

export function isPrivateAddress(ip) {
  return isIP(ip) === 4 ? ipv4Private(ip) : isIP(ip) === 6 ? ipv6Private(ip) : true;
}

export async function assertAllowedSourceUrl(raw, {allowInsecure = false, allowlist = [], resolve = lookup} = {}) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('URL de fuente inválida'); }
  if (url.username || url.password) throw new Error('La URL no puede incluir credenciales');
  if (url.protocol !== 'https:' && !(allowInsecure && url.protocol === 'http:')) throw new Error('La fuente debe usar HTTPS');
  if (url.search || url.hash) throw new Error('La URL de fuente no admite parámetros');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (allowlist.includes(host)) return url;
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Host interno no autorizado');
  const addresses = isIP(host) ? [{address: host}] : await resolve(host, {all: true});
  if (!addresses.length || addresses.some(a => isPrivateAddress(a.address))) throw new Error('Dirección privada o de metadata no autorizada');
  return url;
}
