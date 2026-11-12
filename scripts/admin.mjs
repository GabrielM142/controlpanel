// Administrative CLI for the central database (run as migration/owner role).
//   node --env-file=.env scripts/admin.mjs create-tenant <slug> "<name>"
//   NOVA_NEW_PASSWORD=... node --env-file=.env scripts/admin.mjs create-user <email> "<name>"
//   node --env-file=.env scripts/admin.mjs grant <email> <tenant-slug> <owner|admin|analyst|viewer>
//   node --env-file=.env scripts/admin.mjs list-users       (correos, empresas y roles; nunca contraseñas)
//   NOVA_NEW_PASSWORD=... node --env-file=.env scripts/admin.mjs set-password <email>  (cierra sus sesiones y lo desbloquea)
//   node --env-file=.env scripts/admin.mjs unlock <email>  (quita el bloqueo por intentos fallidos)
//   node --env-file=.env scripts/admin.mjs terms            (registers src/data/terms.json version + sha256)
//   node --env-file=.env scripts/admin.mjs unit-rule <tenant-slug> <source-id> <company|journal|pos_config|team> <value> <code> "<unit name>" <channel> [priority]
//   node --env-file=.env scripts/admin.mjs rebuild <source-id> (full core/mart rebuild after changing unit rules)
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export function termsCanonical(t) {
  return [t.version, t.intro, ...t.sections.map(s => `${s.title}. ${s.body}`), t.note].join('\n');
}

export async function main([cmd, ...args], {pool: injected} = {}) {
  const {createPool, withTransaction} = await import('../lib/db.mjs');
  const pool = injected || createPool(undefined, {max: 1, applicationName: 'nova-admin'});
  const q = (sql, params) => pool.query(sql, params);
  try {
    if (cmd === 'create-tenant') {
      const [slug, name] = args;
      console.log((await q('INSERT INTO app.tenants(slug, name) VALUES ($1, $2) RETURNING id', [slug, name])).rows[0]);
    } else if (cmd === 'create-user') {
      const {hashPassword} = await import('../lib/crypto.mjs');
      const [email, name] = args;
      if (!process.env.NOVA_NEW_PASSWORD) throw new Error('Defina NOVA_NEW_PASSWORD (no se acepta por argumento)');
      console.log((await q('INSERT INTO app.users(email, name, password_hash) VALUES (lower($1), $2, $3) RETURNING id, email',
        [email, name, await hashPassword(process.env.NOVA_NEW_PASSWORD)])).rows[0]);
    } else if (cmd === 'list-users') {
      const rows = (await q(`SELECT u.email, u.name, u.platform_admin, u.disabled_at IS NOT NULL AS disabled,
               coalesce(string_agg(t.slug || ':' || m.role, ', ' ORDER BY t.slug), '') AS tenants
          FROM app.users u LEFT JOIN app.memberships m ON m.user_id = u.id LEFT JOIN app.tenants t ON t.id = m.tenant_id
         GROUP BY u.id ORDER BY u.email`)).rows;
      console.table(rows);
    } else if (cmd === 'set-password') {
      const {hashPassword} = await import('../lib/crypto.mjs');
      const [email] = args;
      if (!email) throw new Error('Uso: NOVA_NEW_PASSWORD=... admin.mjs set-password <email>');
      if (!process.env.NOVA_NEW_PASSWORD) throw new Error('Defina NOVA_NEW_PASSWORD (no se acepta por argumento)');
      const hash = await hashPassword(process.env.NOVA_NEW_PASSWORD);
      await withTransaction(pool, {}, async c => {
        const u = (await c.query('UPDATE app.users SET password_hash = $2 WHERE email = lower($1) RETURNING id, email',
          [email, hash])).rows[0];
        if (!u) throw new Error(`No existe el usuario ${email}. Use list-users o create-user.`);
        // A reset closes every open session of that user and clears its login lock.
        await c.query('UPDATE app.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [u.id]);
        await c.query('DELETE FROM app.auth_throttle WHERE key = $1', [`email:${u.email}`]);
        console.log({ok: true, email: u.email});
      });
    } else if (cmd === 'unlock') {
      const [email] = args;
      if (!email) throw new Error('Uso: admin.mjs unlock <email>');
      const r = await q('DELETE FROM app.auth_throttle WHERE key = $1', [`email:${String(email).toLowerCase()}`]);
      console.log({ok: true, unlocked: r.rowCount});
    } else if (cmd === 'grant') {
      const [email, slug, role] = args;
      await q(`INSERT INTO app.memberships(tenant_id, user_id, role) SELECT t.id, u.id, $3 FROM app.tenants t, app.users u
               WHERE t.slug = $2 AND u.email = lower($1) ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role`, [email, slug, role]);
      console.log('ok');
    } else if (cmd === 'terms') {
      const terms = JSON.parse(readFileSync(new URL('../src/data/terms.json', import.meta.url), 'utf8'));
      const sha = createHash('sha256').update(termsCanonical(terms)).digest('hex');
      await q('INSERT INTO app.terms_versions(version, sha256) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING', [terms.version, sha]);
      console.log({version: terms.version, sha256: sha});
    } else if (cmd === 'unit-rule') {
      const [slug, sourceId, type, value, code, name, channel, priority = '100'] = args;
      await q(`INSERT INTO app.business_unit_rules(tenant_id, source_id, match_type, match_value, unit_code, unit_name, channel, priority)
               SELECT id, $2, $3, $4, $5, $6, $7, $8 FROM app.tenants WHERE slug = $1`, [slug, sourceId, type, value, code, name, channel, Number(priority)]);
      console.log('ok — ejecute "rebuild" para recalcular el histórico con la nueva regla');
    } else if (cmd === 'rebuild') {
      const {rebuildAll} = await import('../lib/ingest/transform.mjs');
      const [sourceId] = args;
      await withTransaction(pool, {}, async c => {
        const s = (await c.query('SELECT id, tenant_id, timezone, attribute_map FROM app.connector_sources WHERE id = $1', [sourceId])).rows[0];
        const dates = await rebuildAll(c, {tenantId: s.tenant_id, sourceId: s.id, timezone: s.timezone, attributeMap: s.attribute_map || []});
        console.log(`${dates.length} fechas recalculadas`);
      });
    } else {
      // Usage = the leading comment block (every command listed there, however many).
      const lines = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
      console.log(lines.slice(1, lines.findIndex(l => !l.startsWith('//'))).join('\n'));
    }
  } finally { if (!injected) await pool.end(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main(process.argv.slice(2));
