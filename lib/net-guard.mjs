import {lookup} from 'node:dns/promises';
import {lookup as lookupCb} from 'node:dns';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {BlockList, isIP} from 'node:net';
import {Readable} from 'node:stream';

// SSRF protection for administratively registered Odoo endpoints: HTTPS only
// (HTTP only with an explicit staging flag), no credentials in URL, and no
// private/loopback/link-local/metadata/reserved addresses unless the host is
// allowlisted. IPv6 forms that embed an IPv4 address (mapped ::ffff:a.b.c.d in
// any spelling, compatible ::a.b.c.d, NAT64 64:ff9b::, 6to4 2002::, Teredo) are
// rejected outright: an Odoo server is never registered that way.

// Two lists: BlockList also matches IPv4 lookups against IPv6 ::ffff:/96 rules.
const blocked4 = new BlockList();
const blocked6 = new BlockList();
for (const [net, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked4.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [['::', 96], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 32], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]) blocked6.addSubnet(net, prefix, 'ipv6');

export function isPrivateAddress(ip) {
  const family = isIP(ip);
  if (family === 4) return blocked4.check(ip, 'ipv4');
  if (family === 6) return blocked6.check(ip, 'ipv6');
  return true;
}

/**
 * fetch-compatible client that re-checks every address the connection actually
 * resolves to (closes the DNS-rebinding gap between the URL check and the
 * request). Never follows redirects: a 3xx surfaces as a non-ok response.
 */
export function guardedFetch({allowlist = []} = {}) {
  const pinnedLookup = (host, options, callback) => {
    lookupCb(host, {...options, all: true}, (error, addresses) => {
      if (error) return callback(error);
      if (!allowlist.includes(host) && (!addresses.length || addresses.some(a => isPrivateAddress(a.address)))) {
        return callback(new Error('Dirección privada o de metadata no autorizada'));
      }
      if (options.all) return callback(null, addresses);
      return callback(null, addresses[0].address, addresses[0].family);
    });
  };
  return (url, {method = 'GET', headers = {}, body, signal} = {}) => new Promise((resolve, reject) => {
    const target = new URL(url);
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(target, {method, headers, signal, lookup: pinnedLookup}, res => {
      const status = res.statusCode || 0;
      const nullBody = [101, 204, 205, 304].includes(status);
      if (nullBody) res.resume();
      resolve(new Response(nullBody ? null : Readable.toWeb(res), {status: status < 200 || status > 599 ? 502 : status}));
    });
    req.on('error', reject);
    req.end(body);
  });
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
