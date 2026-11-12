import {createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCb, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';

const scrypt = promisify(scryptCb);
const SCRYPT = {N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024};

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('La contraseña debe tener al menos 12 caracteres');
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, n, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash || typeof password !== 'string') return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {...SCRYPT, N: Number(n)});
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function newToken() { return randomBytes(32).toString('base64url'); }
export function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

function keyFrom(secretKey) {
  const key = Buffer.from(secretKey || '', 'base64');
  if (key.length !== 32) throw new Error('NOVA_SECRET_KEY debe ser 32 bytes en base64');
  return key;
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encryptSecret(plain, secretKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secretKey), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptSecret(token, secretKey) {
  const [v, iv, tag, data] = String(token || '').split('.');
  if (v !== 'v1') throw new Error('formato de secreto desconocido');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secretKey), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

/** Resolve a stored credential: ciphertext or `env:VAR` secret-manager style reference. */
export function resolveSecret({secret_ciphertext, secret_ref}, secretKey, env = process.env) {
  if (secret_ref) {
    const m = /^env:([A-Z][A-Z0-9_]{1,63})$/.exec(secret_ref);
    if (!m || !env[m[1]]) throw new Error('Referencia de secreto no resoluble');
    return env[m[1]];
  }
  return decryptSecret(secret_ciphertext, secretKey);
}
