import {readFileSync} from 'node:fs';
import {decryptSecret, encryptSecret, hashPassword, newToken, sha256, verifyPassword} from '../lib/crypto.mjs';
import {withTransaction} from '../lib/db.mjs';
import {enumerateBlocks} from '../lib/blocks.mjs';
import {aiFacts, buildReport, METRICS, parseFilters, receivableSummary, thresholdValues, warehouseValuation} from '../lib/metrics.mjs';
import {AI_MODEL, aiConfigured, answerQuestion, PROVIDERS, reportDigest} from '../lib/ai.mjs';
import {alertMessage, evaluateAlerts, sendTelegram} from '../lib/alerts.mjs';
import {demoRows} from '../lib/model.mjs';
import {assertAllowedSourceUrl} from '../lib/net-guard.mjs';
import {applyCors, HttpError, isUuid, parseCookies, readJson, send, str, toCsv} from './http.mjs';
import {handleMcp} from './mcp.mjs';

const report = JSON.parse(readFileSync(new URL('../src/data/report.json', import.meta.url), 'utf8'));
const PAGES = new Map(report.pages.map(p => [p.id, {page: p, blocks: enumerateBlocks(p)}]));
const ROLE_RANK = {viewer: 1, analyst: 2, admin: 3, owner: 4};
const COOKIE = 'nova_session';
const PLAN = new Set(['free', 'pro', 'enterprise']);
const PRIORITY = new Set(['baja', 'media', 'alta', 'urgente']);
const TASK_STATUS = new Set(['todo', 'doing', 'done', 'cancelled']);

export function createHandler({pool, config, now = () => new Date()}) {
  const role = config.dbRole === undefined ? 'nova_api' : config.dbRole;
  const tx = (opts, fn) => withTransaction(pool, {role, ...opts}, fn);

  async function session(req) {
    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : parseCookies(req.headers.cookie)[COOKIE];
    if (!token || token.length > 200) return null;
    return tx({}, async c => {
      const row = (await c.query(`SELECT s.id AS session_id, u.id, u.email, u.name, u.platform_admin FROM app.sessions s
                                   JOIN app.users u ON u.id = s.user_id
                                  WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.disabled_at IS NULL`,
      [sha256(token)])).rows[0];
      if (row) await c.query('UPDATE app.sessions SET last_seen_at = now() WHERE id = $1', [row.session_id]);
      return row || null;
    });
  }

  async function memberships(userId) {
    return tx({userId}, async c => (await c.query(
      `SELECT m.tenant_id, m.role, t.slug, t.name, t.mode, t.timezone, t.plan FROM app.memberships m
         JOIN app.tenants t ON t.id = m.tenant_id WHERE m.user_id = $1 ORDER BY t.name`, [userId])).rows);
  }

  /** Tenant comes from the header but is only accepted if the session user is a member. */
  async function contextFor(user, tenantId, minRole = 'viewer') {
    if (!isUuid(tenantId)) throw new HttpError(400, 'Tenant inválido');
    const m = (await memberships(user.id)).find(x => x.tenant_id === tenantId);
    if (!m) throw new HttpError(403, 'Sin acceso a esta empresa');
    if (ROLE_RANK[m.role] < ROLE_RANK[minRole]) throw new HttpError(403, 'Rol insuficiente');
    const companies = await tx({tenantId, userId: user.id}, async c => {
      const rows = (await c.query('SELECT source_id, company_id FROM app.membership_companies WHERE tenant_id = $1 AND user_id = $2',
        [tenantId, user.id])).rows;
      return rows.length ? rows.map(r => `${r.source_id}:${r.company_id}`) : null;
    });
    return {user, tenantId, membership: m, companies};
  }

  async function tenantContext(req, minRole = 'viewer') {
    const user = await session(req);
    if (!user) throw new HttpError(401, 'Sesión requerida');
    return contextFor(user, req.headers['x-nova-tenant'], minRole);
  }

  const audit = (c, ctx, action, target, details = {}) => c.query(
    'INSERT INTO ops.audit_log(tenant_id, user_id, action, target, details) VALUES ($1, $2, $3, $4, $5)',
    [ctx.tenantId, ctx.user.id, action, target, JSON.stringify(details)]);

  function requireCsrf(req) {
    // Custom header forces a CORS preflight: cross-site forms cannot send it.
    if (req.headers['x-nova-request'] !== '1') throw new HttpError(403, 'Falta encabezado X-Nova-Request');
  }

  async function status(ctx) {
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => {
      const pub = (await c.query('SELECT version, business_date::text, published_at, sources, consistency FROM ops.published_versions ORDER BY version DESC LIMIT 1')).rows[0] || null;
      const sources = (await c.query(`SELECT s.id, s.name, s.status, s.last_collect_at, s.next_collect_at, s.last_error, s.consecutive_failures,
                                             (SELECT row_to_json(r) FROM (SELECT run_seq, state, business_date::text, observed_from, observed_to, published_at, error
                                                FROM ingest.runs WHERE source_id = s.id ORDER BY run_seq DESC LIMIT 1) r) AS last_run
                                        FROM app.connector_sources s ORDER BY s.name`)).rows;
      const quality = (await c.query(`SELECT check_name, dataset, status, count(*)::int AS n FROM ops.data_quality_results
                                       WHERE created_at > now() - interval '7 days' AND status <> 'ok' GROUP BY 1, 2, 3`)).rows;
      return {mode: 'live', published: pub, sources: sources.map(s => ({...s, last_error: s.last_error ? String(s.last_error).slice(0, 200) : null})), quality};
    });
  }

  async function reportFor(ctx, pageId, query) {
    const entry = PAGES.get(pageId);
    if (!entry) throw new HttpError(404, 'Reporte inexistente');
    // One REPEATABLE READ snapshot: every widget of the response reads the same published state.
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true, isolation: 'REPEATABLE READ'}, async c => {
      const pub = (await c.query('SELECT version, business_date::text, published_at, sources, consistency FROM ops.published_versions ORDER BY version DESC LIMIT 1')).rows[0];
      if (!pub) return {mode: 'live', published: null, widgets: Object.fromEntries(entry.blocks.map(b => [b.id, {kind: 'missing', reason: 'Aún no hay datos publicados para esta empresa.'}]))};
      const filters = parseFilters(query, pageId, pub.business_date);
      const widgets = await buildReport(c, pageId, filters, {companies: ctx.companies, blocks: entry.blocks});
      return {mode: 'live', published: pub, filters, widgets};
    });
  }

  async function filterOptions(ctx) {
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => {
      const q = async sql => (await c.query(sql)).rows.map(r => r.v).filter(Boolean);
      return {
        anio: await q(`SELECT DISTINCT extract(year FROM business_date)::int::text AS v FROM mart.sales_day ORDER BY 1 DESC`),
        unidad: await q('SELECT DISTINCT unit_name AS v FROM app.business_unit_rules ORDER BY 1'),
        canal: await q('SELECT DISTINCT channel AS v FROM app.business_unit_rules ORDER BY 1'),
        marca: await q('SELECT DISTINCT brand AS v FROM core.dim_product ORDER BY 1'),
        categoria: await q('SELECT DISTINCT category_name AS v FROM core.dim_product ORDER BY 1'),
        provincia: await q('SELECT DISTINCT state_name AS v FROM core.dim_partner ORDER BY 1'),
        vendedor: await q('SELECT DISTINCT u.name AS v FROM core.dim_user u WHERE EXISTS (SELECT 1 FROM core.fact_sales_line f WHERE f.source_id = u.source_id AND f.salesperson_id = u.user_id) ORDER BY 1'),
      };
    });
  }

  const routes = [];
  const route = (method, pattern, fn) => routes.push({method, pattern, fn});

  route('GET', /^\/health\/live$/, async () => ({ok: true}));
  route('GET', /^\/health\/ready$/, async () => {
    if (!pool) throw new HttpError(503, 'Base no configurada');
    await tx({}, c => c.query('SELECT 1'));
    return {ok: true};
  });

  // Legacy endpoints kept for compatibility: demo stays explicit; live no longer lists global snapshots.
  route('GET', /^\/api\/state$/, async ({req}) => {
    if (config.mode === 'demo') return {mode: 'demo', snapshots: [{id: 'demo', created_at: '2026-06-30T23:00:00Z', source: 'Demostración', rows: demoRows()}], jobs: []};
    if (!pool || !(await session(req))) throw new HttpError(401, 'Acceso restringido');
    throw new HttpError(410, 'Reemplazado por /api/status y /api/reports/:pagina');
  });
  route('POST', /^\/api\/refresh$/, async () => {
    if (config.mode === 'demo') throw new HttpError(409, 'La actualización requiere conectar la base analítica y el worker de Odoo.');
    throw new HttpError(410, 'Actualizar consulta la última publicación (/api/status); ya no dispara extracciones al ERP.');
  });

  // Brute-force protection: exponential lock per email (after 5 failures) and per client
  // IP (after 30), stored in app.auth_throttle. A missing user still runs scrypt
  // against a fixed dummy hash so response time does not reveal which emails exist.
  let dummyHash;
  const clientIp = req => String(req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0]
    || req.socket?.remoteAddress || 'unknown').trim().slice(0, 64);
  const throttleKeys = (req, email) => [[`email:${email}`, 5], [`ip:${clientIp(req)}`, 30]];
  async function assertNotLocked(keys) {
    const row = await tx({}, async c => (await c.query(
      'SELECT max(locked_until) AS until FROM app.auth_throttle WHERE key = ANY($1) AND locked_until > now()', [keys.map(k => k[0])])).rows[0]);
    if (row?.until) {
      const minutes = Math.max(1, Math.ceil((new Date(row.until).getTime() - Date.now()) / 60000));
      throw new HttpError(429, `Demasiados intentos fallidos. Vuelve a intentar en ${minutes} min.`, {retryAfter: minutes * 60});
    }
  }
  async function recordFailure(keys) {
    await tx({}, async c => {
      for (const [key, free] of keys) {
        await c.query(`INSERT INTO app.auth_throttle AS t(key, failures, updated_at) VALUES ($1, 1, now())
          ON CONFLICT (key) DO UPDATE SET
            failures = CASE WHEN t.updated_at < now() - interval '1 day' THEN 1 ELSE t.failures + 1 END,
            updated_at = now()`, [key]);
        await c.query(`UPDATE app.auth_throttle SET locked_until = now() + make_interval(mins => least(60, power(2, failures - $2)::int))
          WHERE key = $1 AND failures >= $2`, [key, free]);
      }
      if (Math.random() < 0.02) await c.query("DELETE FROM app.auth_throttle WHERE updated_at < now() - interval '2 days'");
    });
  }

  route('POST', /^\/api\/auth\/login$/, async ({req}) => {
    requireCsrf(req);
    const body = await readJson(req, 4096);
    const email = str(body.email, 200, {required: true, name: 'email'}).toLowerCase();
    const password = typeof body.password === 'string' ? body.password.slice(0, 1024) : '';
    const keys = throttleKeys(req, email);
    await assertNotLocked(keys);
    const user = await tx({}, async c => (await c.query('SELECT id, email, name, password_hash, disabled_at FROM app.users WHERE email = $1', [email])).rows[0]);
    dummyHash ??= await hashPassword(newToken());
    const valid = await verifyPassword(password, user ? user.password_hash : dummyHash);
    const ok = user && !user.disabled_at && valid;
    if (!ok) { await recordFailure(keys); throw new HttpError(401, 'Credenciales inválidas'); }
    await tx({}, c => c.query('DELETE FROM app.auth_throttle WHERE key = $1', [keys[0][0]]));
    const token = newToken();
    const expires = new Date(now().getTime() + config.sessionHours * 3600000);
    await tx({}, c => c.query('INSERT INTO app.sessions(token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [sha256(token), user.id, expires]));
    const cookie = `${COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${config.sessionHours * 3600}; SameSite=${config.cookieSameSite}${config.cookieSecure ? '; Secure' : ''}`;
    return {status: 200, headers: {'Set-Cookie': cookie},
      body: {user: {id: user.id, email: user.email, name: user.name}, memberships: await memberships(user.id), token_type: 'cookie'}};
  });
  route('POST', /^\/api\/auth\/logout$/, async ({req}) => {
    requireCsrf(req);
    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : parseCookies(req.headers.cookie)[COOKIE];
    if (token && token.length <= 200) await tx({}, c => c.query('UPDATE app.sessions SET revoked_at = now() WHERE token_hash = $1', [sha256(token)]));
    return {status: 200, headers: {'Set-Cookie': `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=${config.cookieSameSite}${config.cookieSecure ? '; Secure' : ''}`}, body: {ok: true}};
  });
  route('GET', /^\/api\/session$/, async ({req}) => {
    if (config.mode === 'demo' && !pool) return {mode: 'demo'};
    const user = await session(req);
    if (!user) throw new HttpError(401, 'Sesión requerida');
    return {mode: 'live', user: {id: user.id, email: user.email, name: user.name}, memberships: await memberships(user.id)};
  });

  route('GET', /^\/api\/status$/, async ({req}) => status(await tenantContext(req)));
  route('GET', /^\/api\/filters$/, async ({req}) => filterOptions(await tenantContext(req)));
  route('GET', /^\/api\/metrics$/, async () => ({metrics: METRICS}));
  route('GET', /^\/api\/reports\/([a-z0-9]+)$/, async ({req, match, query}) => reportFor(await tenantContext(req), match[1], query));
  route('GET', /^\/api\/reports\/([a-z0-9]+)\/export\.csv$/, async ({req, match, query}) => {
    const ctx = await tenantContext(req);
    const data = await reportFor(ctx, match[1], query);
    const entry = PAGES.get(match[1]);
    const rows = [['Reporte', entry.page.label], ['Tenant', ctx.membership.name], ['Versión publicada', data.published?.version ?? '—'],
      ['Fecha de negocio', data.published?.business_date ?? '—'], ['Consistencia', data.published?.consistency ?? '—'],
      ['Filtros', JSON.stringify(query)], []];
    for (const b of entry.blocks) {
      const wd = data.widgets[b.id];
      if (wd.kind === 'kpi' || wd.kind === 'metric') rows.push([b.id, b.label, wd.value, wd.raw ?? '']);
      else if (wd.kind === 'table') { rows.push([b.id, b.label]); for (const r of wd.rows) rows.push(['', ...r]); }
      else if (wd.kind === 'missing') rows.push([b.id, b.label, 'Sin dato', wd.reason]);
    }
    return {status: 200, raw: toCsv(rows), headers: {'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="nova-${match[1]}-v${data.published?.version ?? 0}.csv"`}};
  });
  // Omega IA. The server re-reads the published reports for this tenant and filters (the
  // browser's numbers are never trusted) and asks Claude. General questions (page "omega")
  // read the main reports together. Max 60 questions per user per hour.
  const AI_SCOPE = ['comercial', 'inventarios', 'compras', 'logistica', 'financiero'];
  /** The company's provider and decrypted key, else the server-wide Anthropic key, else null. */
  async function aiFor(ctx) {
    const row = await tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c =>
      (await c.query('SELECT provider, model, secret_ciphertext FROM app.ai_settings WHERE tenant_id = $1', [ctx.tenantId])).rows[0]);
    if (row?.secret_ciphertext) return {provider: row.provider, model: row.model, apiKey: decryptSecret(row.secret_ciphertext, config.secretKey), scope: 'empresa'};
    if (aiConfigured()) return {provider: 'anthropic', model: AI_MODEL, apiKey: null, scope: 'servidor'};
    return null;
  }
  route('GET', /^\/api\/ai\/settings$/, async ({req}) => {
    const ctx = await tenantContext(req, 'admin');
    const row = await tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => (await c.query(
      'SELECT provider, model, secret_ciphertext IS NOT NULL AS has_key, updated_at FROM app.ai_settings WHERE tenant_id = $1', [ctx.tenantId])).rows[0]);
    return {providers: Object.entries(PROVIDERS).map(([id, p]) => ({id, label: p.label, default_model: p.defaultModel})),
      provider: row?.provider || null, model: row?.model || null, configured: Boolean(row?.has_key), updated_at: row?.updated_at || null,
      server_fallback: aiConfigured()};
  });
  route('PUT', /^\/api\/ai\/settings$/, async ({req}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req, 'admin');
    if (!config.secretKey) throw new HttpError(503, 'Cifrado de secretos no configurado en el servidor');
    const b = await readJson(req, 4096);
    const provider = str(b.provider, 20, {required: true, name: 'proveedor'});
    if (!PROVIDERS[provider]) throw new HttpError(400, 'Proveedor no soportado');
    const model = str(b.model, 80) || PROVIDERS[provider].defaultModel;
    if (!/^[A-Za-z0-9._:\-/]{1,80}$/.test(model)) throw new HttpError(400, 'Modelo inválido');
    const apiKey = str(b.api_key, 300);
    await tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      await c.query(`INSERT INTO app.ai_settings(tenant_id, provider, model, secret_ciphertext, updated_at, updated_by)
        VALUES ($1, $2, $3, $4, now(), $5)
        ON CONFLICT (tenant_id) DO UPDATE SET provider = EXCLUDED.provider, model = EXCLUDED.model,
          secret_ciphertext = coalesce(EXCLUDED.secret_ciphertext, CASE WHEN app.ai_settings.provider = EXCLUDED.provider THEN app.ai_settings.secret_ciphertext END),
          updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [ctx.tenantId, provider, model, apiKey ? encryptSecret(apiKey, config.secretKey) : null, ctx.user.id]);
      await audit(c, ctx, 'ai.settings', provider);
    });
    return {ok: true};
  });
  route('DELETE', /^\/api\/ai\/settings$/, async ({req}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req, 'admin');
    await tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      await c.query('DELETE FROM app.ai_settings WHERE tenant_id = $1', [ctx.tenantId]);
      await audit(c, ctx, 'ai.settings.delete', null);
    });
    return {ok: true};
  });
  route('POST', /^\/api\/ai\/report$/, async ({req}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req);
    const ai = await aiFor(ctx);
    if (!ai) throw new HttpError(503, 'Omega IA no está configurada: un administrador debe elegir el proveedor y cargar su clave en Configuración · Omega IA.');
    const body = await readJson(req, 16 * 1024);
    const question = str(body.question, 500, {required: true, name: 'pregunta'});
    const pageId = String(body.page_id || 'omega');
    if (pageId !== 'omega' && !PAGES.has(pageId)) throw new HttpError(400, 'Reporte inexistente');
    const filters = {};
    for (const [k, v] of Object.entries(body.filters || {})) {
      if (/^[a-z_]{1,20}$/.test(k) && typeof v === 'string' && v.length <= 80) filters[k] = v;
    }
    const key = `ai:${ctx.user.id}`;
    const used = await tx({}, async c => (await c.query(`INSERT INTO app.auth_throttle AS t(key, failures, updated_at) VALUES ($1, 1, now())
      ON CONFLICT (key) DO UPDATE SET failures = CASE WHEN t.updated_at < now() - interval '1 hour' THEN 1 ELSE t.failures + 1 END,
        updated_at = CASE WHEN t.updated_at < now() - interval '1 hour' THEN now() ELSE t.updated_at END
      RETURNING failures`, [key])).rows[0].failures);
    if (used > 60) throw new HttpError(429, 'Alcanzaste el límite de 60 preguntas por hora a Omega IA. Vuelve a intentar más tarde.');
    const pages = pageId === 'omega' ? AI_SCOPE : [pageId, ...(pageId === 'nivel1' ? ['comercial'] : [])];
    const digests = [];
    let cut = 'sin datos publicados';
    const pub = await tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c =>
      (await c.query('SELECT business_date::text FROM ops.published_versions ORDER BY version DESC LIMIT 1')).rows[0]);
    if (pub?.business_date) digests.push(await tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, c => aiFacts(c, pub.business_date, ctx.companies)));
    for (const id of pages) {
      const payload = await reportFor(ctx, id, filters);
      if (payload.published) cut = `${payload.published.business_date} · versión ${payload.published.version}`;
      digests.push(reportDigest(PAGES.get(id).page, payload));
    }
    if (cut === 'sin datos publicados') throw new HttpError(409, 'Aún no hay datos publicados para esta empresa.');
    try {
      const a = await answerQuestion({provider: ai.provider, apiKey: ai.apiKey, model: ai.model, question, cut, filters, digests});
      return {headline: a.headline, points: a.points, suggestion: a.suggestion || null, missing_data: a.missing_data || [],
        sources: [`Omega IA (${PROVIDERS[ai.provider].label} · ${a.model}) · cierre ${cut}`, ...pages.map(id => `Reporte «${PAGES.get(id).page.label}»`)]};
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(error.status === 422 ? 422 : 502, error.status === 422 ? error.message : 'Omega IA no respondió. Usa la lectura calculada mientras tanto.');
    }
  });
  route('GET', /^\/api\/inventory\/warehouses$/, async ({req, query}) => {
    const ctx = await tenantContext(req);
    // One REPEATABLE READ snapshot, like the reports: totals, warehouses and products agree.
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true, isolation: 'REPEATABLE READ'}, async c => {
      const pub = (await c.query('SELECT version, business_date::text, published_at FROM ops.published_versions ORDER BY version DESC LIMIT 1')).rows[0];
      if (!pub) return {mode: 'live', published: null};
      return {mode: 'live', published: pub, ...(await warehouseValuation(c, query, ctx.companies))};
    });
  });
  route('GET', /^\/api\/receivables$/, async ({req}) => {
    const ctx = await tenantContext(req);
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => {
      const pub = (await c.query('SELECT version, business_date::text FROM ops.published_versions ORDER BY version DESC LIMIT 1')).rows[0];
      return {published: pub || null, summary: pub ? await receivableSummary(c, pub.business_date, ctx.companies) : null,
        label: 'Saldo capturado en el intervalo del lote (no saldo exacto a las 00:00)'};
    });
  });

  // Data sources --------------------------------------------------------------
  route('GET', /^\/api\/sources$/, async ({req}) => {
    const ctx = await tenantContext(req, 'admin');
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => ({sources: (await c.query(
      `SELECT s.id, s.name, s.base_url, s.db_name, s.login, s.timezone, s.collect_after::text, s.collect_tz, s.status, s.installation_uuid,
              s.source_generation, s.link_confirmed_at, s.last_seen_at, s.last_collect_at, s.next_collect_at, s.consecutive_failures,
              s.last_error, s.capabilities->'datasets' AS datasets, s.capabilities->>'odoo_version' AS odoo_version,
              s.capabilities->>'connector_version' AS connector_version,
              (SELECT json_agg(json_build_object('id', company_id, 'name', name, 'authorized', authorized)) FROM app.source_companies sc WHERE sc.source_id = s.id) AS companies
         FROM app.connector_sources s ORDER BY s.name`)).rows}));
  });
  route('POST', /^\/api\/sources$/, async ({req}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req, 'admin');
    const b = await readJson(req, 8192);
    const baseUrl = str(b.base_url, 300, {required: true, name: 'base_url'});
    await assertAllowedSourceUrl(baseUrl, {allowInsecure: config.allowInsecureSources, allowlist: config.sourceHostAllowlist})
      .catch(e => { throw new HttpError(400, e.message); });
    const apiKey = str(b.api_key, 200, {required: true, name: 'api_key'});
    if (!config.secretKey) throw new HttpError(503, 'Cifrado de secretos no configurado en el servidor');
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      const s = (await c.query(`INSERT INTO app.connector_sources(tenant_id, name, base_url, db_name, login, timezone, collect_after, collect_tz)
                                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, status`,
      [ctx.tenantId, str(b.name, 120, {required: true, name: 'name'}), baseUrl, str(b.db_name, 120, {required: true, name: 'db_name'}),
        str(b.login, 120, {required: true, name: 'login'}), str(b.timezone, 64) || 'America/Guayaquil',
        /^([01]\d|2[0-3]):[0-5]\d$/.test(b.collect_after || '') ? b.collect_after : '03:00', str(b.collect_tz, 64) || 'America/Guayaquil'])).rows[0];
      await c.query('INSERT INTO app.connector_credentials(source_id, tenant_id, secret_ciphertext) VALUES ($1, $2, $3)',
        [s.id, ctx.tenantId, encryptSecret(apiKey, config.secretKey)]);
      await audit(c, ctx, 'source.create', s.id, {base_url: baseUrl});
      return {status: 201, body: s};
    });
  });
  route('POST', /^\/api\/sources\/([0-9a-f-]{36})\/(link|test|resync|collect|pause|resume|rotate)$/, async ({req, match}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req, 'admin');
    const [, sourceId, action] = match;
    const b = await readJson(req, 4096);
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      const src = (await c.query('SELECT id, status FROM app.connector_sources WHERE id = $1', [sourceId])).rows[0];
      if (!src) throw new HttpError(404, 'Fuente inexistente'); // RLS hides other tenants' sources
      if (action === 'pause' || action === 'resume') {
        await c.query('UPDATE app.connector_sources SET status = $2 WHERE id = $1', [sourceId, action === 'pause' ? 'paused' : 'active']);
        await audit(c, ctx, `source.${action}`, sourceId);
        return {status: src.status, next: action === 'pause' ? 'paused' : 'active'};
      }
      if (action === 'rotate') {
        const apiKey = str(b.api_key, 200, {required: true, name: 'api_key'});
        await c.query('UPDATE app.connector_credentials SET secret_ciphertext = $2, rotated_at = now() WHERE source_id = $1', [sourceId, encryptSecret(apiKey, config.secretKey)]);
        await audit(c, ctx, 'source.rotate_key', sourceId);
        return {rotated: true};
      }
      const payload = action === 'link' ? {link_token: str(b.link_token, 100, {required: true, name: 'link_token'})}
        : action === 'resync' ? {datasets: Array.isArray(b.datasets) ? b.datasets.filter(x => typeof x === 'string').slice(0, 50) : []} : {};
      if (action === 'resync' && !payload.datasets.length) throw new HttpError(400, 'Indique datasets');
      const command = (await c.query(`INSERT INTO ops.source_commands(tenant_id, source_id, command, payload, requested_by)
                                       VALUES ($1, $2, $3, $4, $5) RETURNING id, status`,
      [ctx.tenantId, sourceId, action === 'collect' ? 'collect_now' : action, JSON.stringify(payload), ctx.user.id])).rows[0];
      await audit(c, ctx, `source.${action}`, sourceId);
      return {status: 202, body: {command_id: command.id, status: command.status}};
    });
  });
  route('GET', /^\/api\/commands\/(\d+)$/, async ({req, match}) => {
    const ctx = await tenantContext(req, 'admin');
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => {
      const row = (await c.query('SELECT id, command, status, result, created_at, finished_at FROM ops.source_commands WHERE id = $1', [match[1]])).rows[0];
      if (!row) throw new HttpError(404, 'Comando inexistente');
      return row;
    });
  });
  route('GET', /^\/api\/sources\/([0-9a-f-]{36})\/runs$/, async ({req, match}) => {
    const ctx = await tenantContext(req, 'admin');
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => ({runs: (await c.query(
      `SELECT run_seq, run_uuid, state, business_date::text, observed_from, observed_to, discovered_at, received_at, acked_at, published_at,
              attempts, error, (manifest->'totals') AS totals FROM ingest.runs WHERE source_id = $1 ORDER BY run_seq DESC LIMIT 60`, [match[1]])).rows}));
  });

  // Factory -------------------------------------------------------------------
  route('GET', /^\/api\/factory\/requests$/, async ({req, query}) => {
    const ctx = await tenantContext(req);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 50);
    const offset = Math.max(Number(query.offset) || 0, 0);
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => ({requests: (await c.query(
      `SELECT id, created_at, client_name, plan, title, priority, status, market_item FROM app.factory_requests
        WHERE ($1 OR user_id = $2) ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
      [ROLE_RANK[ctx.membership.role] >= ROLE_RANK.admin, ctx.user.id, limit, offset])).rows, limit, offset}));
  });
  route('POST', /^\/api\/factory\/requests$/, async ({req}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req);
    const key = str(req.headers['idempotency-key'], 100, {required: true, name: 'Idempotency-Key'});
    const b = await readJson(req, 32 * 1024);
    const fields = {client_name: 120, title: 140, process: 600, actors: 400, data_sources: 400, integrations: 400, outputs: 400};
    const vals = Object.fromEntries(Object.entries(fields).map(([k, max]) => [k, str(b[k], max, {required: true, name: k})]));
    if (b.terms_accepted !== true) throw new HttpError(400, 'Debe aceptar los términos vigentes');
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      const terms = (await c.query('SELECT version, sha256 FROM app.terms_versions WHERE version = $1', [str(b.terms_version, 40, {required: true, name: 'terms_version'})])).rows[0];
      if (!terms || terms.sha256 !== b.terms_sha256) throw new HttpError(400, 'Versión de términos desconocida o texto distinto al vigente');
      const existing = (await c.query('SELECT id, created_at, status FROM app.factory_requests WHERE idempotency_key = $1', [key])).rows[0];
      if (existing) return {status: 200, body: {...existing, idempotent_replay: true}};
      const conversation = Array.isArray(b.conversation) ? b.conversation.slice(0, 40).map(m => ({role: m?.role === 'user' ? 'user' : 'assistant', text: String(m?.text || '').slice(0, 1000)})) : [];
      const row = (await c.query(
        `INSERT INTO app.factory_requests(tenant_id, user_id, idempotency_key, client_name, client_email, plan, title, process, actors, data_sources,
                                          integrations, outputs, priority, budget, timeline, market_item, conversation, terms_version, terms_sha256, terms_accepted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, now()) RETURNING id, created_at, status`,
        [ctx.tenantId, ctx.user.id, key, vals.client_name, str(b.client_email, 180), PLAN.has(b.plan) ? b.plan : 'free', vals.title, vals.process,
          vals.actors, vals.data_sources, vals.integrations, vals.outputs, PRIORITY.has(b.priority) ? b.priority : 'media', str(b.budget, 80),
          str(b.timeline, 80), str(b.market_item, 120), JSON.stringify(conversation), terms.version, terms.sha256])).rows[0];
      await audit(c, ctx, 'factory.request', row.id);
      return {status: 201, body: row};
    });
  });

  // Tasks / notes / thresholds (per tenant and user) ----------------------------
  route('GET', /^\/api\/tasks$/, async ({req}) => {
    const ctx = await tenantContext(req);
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => ({tasks: (await c.query(
      'SELECT * FROM app.tasks WHERE owner_id = $1 OR assignee_id = $1 ORDER BY created_at DESC LIMIT 200', [ctx.user.id])).rows}));
  });
  route('POST', /^\/api\/tasks$/, async ({req}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req);
    const b = await readJson(req, 8192);
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      const row = (await c.query(`INSERT INTO app.tasks(tenant_id, owner_id, title, description, priority, due_date, view_id)
                                   VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [ctx.tenantId, ctx.user.id, str(b.title, 200, {required: true, name: 'title'}), str(b.description, 4000),
        PRIORITY.has(b.priority) ? b.priority : 'media', /^\d{4}-\d{2}-\d{2}$/.test(b.due_date || '') ? b.due_date : null, str(b.view_id, 40)])).rows[0];
      await audit(c, ctx, 'task.create', row.id);
      return {status: 201, body: row};
    });
  });
  route('PATCH', /^\/api\/tasks\/([0-9a-f-]{36})$/, async ({req, match}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req);
    const b = await readJson(req, 8192);
    if (b.status !== undefined && !TASK_STATUS.has(b.status)) throw new HttpError(400, 'Estado inválido');
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      const due = b.due_date === null ? 'clear' : /^\d{4}-\d{2}-\d{2}$/.test(b.due_date || '') ? b.due_date : null;
      const row = (await c.query(`UPDATE app.tasks SET title = coalesce($3, title), description = coalesce($4, description),
                                     status = coalesce($5, status), priority = coalesce($6, priority),
                                     due_date = CASE WHEN $7::text = 'clear' THEN NULL WHEN $7::text IS NOT NULL THEN $7::date ELSE due_date END,
                                     view_id = coalesce($8, view_id), updated_at = now()
                                   WHERE id = $1 AND (owner_id = $2 OR assignee_id = $2) RETURNING *`,
      [match[1], ctx.user.id, str(b.title, 200), str(b.description, 4000), b.status ?? null, PRIORITY.has(b.priority) ? b.priority : null,
        due, str(b.view_id, 40)])).rows[0];
      if (!row) throw new HttpError(404, 'Tarea inexistente');
      await audit(c, ctx, 'task.update', row.id, {status: b.status});
      return row;
    });
  });
  route('DELETE', /^\/api\/tasks\/([0-9a-f-]{36})$/, async ({req, match}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req);
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      const n = (await c.query('DELETE FROM app.tasks WHERE id = $1 AND owner_id = $2', [match[1], ctx.user.id])).rowCount;
      if (!n) throw new HttpError(404, 'Tarea inexistente');
      await audit(c, ctx, 'task.delete', match[1]);
      return {deleted: true};
    });
  });
  route('GET', /^\/api\/notes$/, async ({req}) => {
    const ctx = await tenantContext(req);
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => ({notes: (await c.query(
      'SELECT * FROM app.notes WHERE owner_id = $1 ORDER BY pinned DESC, updated_at DESC LIMIT 200', [ctx.user.id])).rows}));
  });
  route('POST', /^\/api\/notes$/, async ({req}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req);
    const b = await readJson(req, 8192);
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => ({status: 201, body: (await c.query(
      'INSERT INTO app.notes(tenant_id, owner_id, body, color, view_id, pinned) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [ctx.tenantId, ctx.user.id, str(b.body, 4000, {required: true, name: 'body'}), str(b.color, 20) || 'amber', str(b.view_id, 40), b.pinned === true])).rows[0]}));
  });
  route('PATCH', /^\/api\/notes\/([0-9a-f-]{36})$/, async ({req, match}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req);
    const b = await readJson(req, 8192);
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      const row = (await c.query(`UPDATE app.notes SET body = coalesce($3, body), color = coalesce($4, color), pinned = coalesce($5, pinned),
                                     view_id = coalesce($6, view_id), updated_at = now() WHERE id = $1 AND owner_id = $2 RETURNING *`,
      [match[1], ctx.user.id, str(b.body, 4000), str(b.color, 20), typeof b.pinned === 'boolean' ? b.pinned : null, str(b.view_id, 40)])).rows[0];
      if (!row) throw new HttpError(404, 'Nota inexistente');
      return row;
    });
  });
  route('DELETE', /^\/api\/notes\/([0-9a-f-]{36})$/, async ({req, match}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req);
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      const n = (await c.query('DELETE FROM app.notes WHERE id = $1 AND owner_id = $2', [match[1], ctx.user.id])).rowCount;
      if (!n) throw new HttpError(404, 'Nota inexistente');
      return {deleted: true};
    });
  });

  // Thresholds: shared per company (admins edit), evaluated against the latest published close.
  route('GET', /^\/api\/thresholds$/, async ({req}) => {
    const ctx = await tenantContext(req);
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true, isolation: 'REPEATABLE READ'}, async c => {
      const rules = (await c.query('SELECT id, metric, comparator, warn_value, crit_value, enabled, updated_at FROM app.threshold_rules ORDER BY id')).rows;
      const pub = (await c.query('SELECT version, business_date::text FROM ops.published_versions ORDER BY version DESC LIMIT 1')).rows[0];
      const values = pub?.business_date ? await thresholdValues(c, pub.business_date, ctx.companies) : {};
      return {rules, values, published: pub || null, can_edit: ROLE_RANK[ctx.membership.role] >= ROLE_RANK.admin};
    });
  });
  route('PUT', /^\/api\/thresholds\/([a-z0-9-]{1,60})$/, async ({req, match}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req, 'admin');
    const b = await readJson(req, 2048);
    const value = Number(b.threshold);
    if (!Number.isFinite(value)) throw new HttpError(400, 'Umbral inválido');
    const comparator = b.comparator === 'gt' ? 'gt' : 'lt';
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      await c.query(`INSERT INTO app.threshold_rules(id, tenant_id, metric, comparator, warn_value, crit_value, enabled, owner_id, updated_at)
        VALUES ($1, $2, $1, $3, $4, $4, $5, $6, now())
        ON CONFLICT (tenant_id, id) DO UPDATE SET comparator = EXCLUDED.comparator, warn_value = EXCLUDED.warn_value,
          crit_value = EXCLUDED.crit_value, enabled = EXCLUDED.enabled, owner_id = EXCLUDED.owner_id, updated_at = now()`,
      [match[1], ctx.tenantId, comparator, value, b.enabled !== false, ctx.user.id]);
      await audit(c, ctx, 'threshold.update', match[1], {threshold: value, enabled: b.enabled !== false});
      return {ok: true};
    });
  });
  route('DELETE', /^\/api\/thresholds\/([a-z0-9-]{1,60})$/, async ({req, match}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req, 'admin');
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      await c.query('DELETE FROM app.threshold_rules WHERE id = $1', [match[1]]);
      return {ok: true};
    });
  });

  // Alert notifications (Telegram) per company; admins configure, the cron sends after each close.
  route('GET', /^\/api\/notify\/settings$/, async ({req}) => {
    const ctx = await tenantContext(req, 'admin');
    const row = await tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => (await c.query(
      `SELECT telegram_chat_id, enabled, telegram_token_ciphertext IS NOT NULL AS has_token, last_version, last_sent_at, last_error
         FROM app.notify_settings WHERE tenant_id = $1`, [ctx.tenantId])).rows[0]);
    return {chat_id: row?.telegram_chat_id || null, enabled: Boolean(row?.enabled), has_token: Boolean(row?.has_token),
      last_version: row?.last_version || null, last_sent_at: row?.last_sent_at || null, last_error: row?.last_error || null};
  });
  route('PUT', /^\/api\/notify\/settings$/, async ({req}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req, 'admin');
    if (!config.secretKey) throw new HttpError(503, 'Cifrado de secretos no configurado en el servidor');
    const b = await readJson(req, 4096);
    const token = str(b.telegram_token, 120);
    const chat = str(b.chat_id, 64);
    if (token && !/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token)) throw new HttpError(400, 'Token de bot inválido (formato 123456:ABC…)');
    if (chat && !/^-?\d{3,20}$|^@[A-Za-z0-9_]{4,64}$/.test(chat)) throw new HttpError(400, 'Chat inválido: usa el número del chat o @canal');
    await tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      await c.query(`INSERT INTO app.notify_settings(tenant_id, telegram_token_ciphertext, telegram_chat_id, enabled, updated_at, updated_by)
        VALUES ($1, $2, $3, $4, now(), $5)
        ON CONFLICT (tenant_id) DO UPDATE SET telegram_token_ciphertext = coalesce(EXCLUDED.telegram_token_ciphertext, app.notify_settings.telegram_token_ciphertext),
          telegram_chat_id = coalesce(EXCLUDED.telegram_chat_id, app.notify_settings.telegram_chat_id), enabled = EXCLUDED.enabled,
          updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [ctx.tenantId, token ? encryptSecret(token, config.secretKey) : null, chat, b.enabled === true, ctx.user.id]);
      await audit(c, ctx, 'notify.settings', null, {enabled: b.enabled === true});
    });
    return {ok: true};
  });
  route('POST', /^\/api\/notify\/test$/, async ({req}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req, 'admin');
    const data = await tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => {
      const n = (await c.query('SELECT telegram_token_ciphertext, telegram_chat_id FROM app.notify_settings WHERE tenant_id = $1', [ctx.tenantId])).rows[0];
      const pub = (await c.query('SELECT business_date::text FROM ops.published_versions ORDER BY version DESC LIMIT 1')).rows[0];
      const alerts = pub ? await evaluateAlerts(c, pub.business_date, ctx.companies) : [];
      return {n, pub, alerts};
    });
    if (!data.n?.telegram_token_ciphertext || !data.n.telegram_chat_id) throw new HttpError(400, 'Guarda primero el token del bot y el chat');
    const text = data.alerts.length ? alertMessage(ctx.membership.name, data.pub.business_date, data.alerts, process.env.NOVA_PANEL_URL || '')
      : `OMEGA · ${ctx.membership.name}\nMensaje de prueba: la conexión con Telegram funciona. Hoy no hay umbrales excedidos.`;
    try { await sendTelegram(decryptSecret(data.n.telegram_token_ciphertext, config.secretKey), data.n.telegram_chat_id, text); }
    catch (e) { throw new HttpError(502, e.message); }
    return {ok: true, alerts: data.alerts.length};
  });

  // Decisions: shared inbox per company with who decided and when.
  const DECISION_STATUS = new Set(['pendiente', 'aprobada', 'rechazada', 'escalada', 'reasignada']);
  route('GET', /^\/api\/decisions$/, async ({req}) => {
    const ctx = await tenantContext(req);
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => ({decisions: (await c.query(
      `SELECT d.*, u.name AS decided_by_name FROM app.decisions d LEFT JOIN app.users u ON u.id = d.decided_by
        ORDER BY d.created_at DESC LIMIT 300`)).rows}));
  });
  route('POST', /^\/api\/decisions$/, async ({req}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req);
    const b = await readJson(req, 8192);
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      const row = (await c.query(`INSERT INTO app.decisions(tenant_id, id, kind, title, detail, recommendation, priority, page_id, source, created_by)
        VALUES ($1, $2, 'omega', $3, $4, $5, 'media', $6, 'Pregúntale a Omega', $7) RETURNING *`,
      [ctx.tenantId, `omega-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, str(b.title, 300, {required: true, name: 'title'}),
        str(b.detail, 2000), str(b.recommendation, 1000), str(b.page_id, 40), ctx.user.id])).rows[0];
      await audit(c, ctx, 'decision.create', row.id);
      return {status: 201, body: row};
    });
  });
  route('PATCH', /^\/api\/decisions\/([A-Za-z0-9._:-]{1,80})$/, async ({req, match}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req, 'analyst');
    const b = await readJson(req, 4096);
    if (!DECISION_STATUS.has(b.status)) throw new HttpError(400, 'Estado inválido');
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      // Derived decisions (e.g. an exceeded threshold) get a row the first time someone decides them.
      const row = (await c.query(`INSERT INTO app.decisions(tenant_id, id, kind, title, status, decided_by, decided_at, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, now(), $6)
        ON CONFLICT (tenant_id, id) DO UPDATE SET status = EXCLUDED.status, decided_by = EXCLUDED.decided_by, decided_at = now()
        RETURNING *`, [ctx.tenantId, match[1], match[1].startsWith('th-') ? 'umbral' : 'omega', str(b.title, 300), b.status, ctx.user.id])).rows[0];
      await audit(c, ctx, 'decision.status', row.id, {status: b.status});
      return row;
    });
  });

  route('POST', /^\/mcp$/, async ({req}) => {
    // Cross-site CSRF is blocked by the SameSite=Lax session cookie and the exact JSON content type.
    const user = await session(req);
    if (!user) throw new HttpError(401, 'Token requerido');
    const body = await readJson(req, 16 * 1024);
    // Re-authorized on every tool call with the same rules as the UI (tenant + company grants).
    return handleMcp(body, {user, memberships: () => memberships(user.id),
      report: async (tenantId, page, query) => reportFor(await contextFor(user, tenantId), page, query),
      status: async tenantId => status(await contextFor(user, tenantId)), pages: [...PAGES.keys()]});
  });

  return async function handler(req, res) {
    applyCors(req, res, config.corsOrigins);
    if (req.method === 'OPTIONS') return send(res, 204, '', {'Content-Type': 'text/plain'});
    const url = new URL(req.url, 'http://localhost');
    const query = Object.fromEntries([...url.searchParams.entries()].slice(0, 30).map(([k, v]) => [k, v.slice(0, 200)]));
    try {
      const candidates = routes.filter(r => r.pattern.test(url.pathname));
      if (!candidates.length) throw new HttpError(404, 'Ruta inexistente');
      const r = candidates.find(x => x.method === req.method);
      if (!r) throw new HttpError(405, 'Método no permitido');
      if (!pool && !['/health/live', '/api/state', '/api/refresh', '/api/session', '/api/metrics'].includes(url.pathname)) {
        throw new HttpError(503, 'Base analítica pendiente de configuración');
      }
      const out = await r.fn({req, res, match: url.pathname.match(r.pattern), query});
      if (out && out.raw !== undefined) return send(res, out.status, out.raw, out.headers);
      if (out && out.status && out.body !== undefined) return send(res, out.status, out.body, out.headers || {});
      return send(res, 200, out);
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.status === 401) res.setHeader('WWW-Authenticate', 'Bearer realm="NOVA"');
        return send(res, error.status, {error: error.message, ...error.extra});
      }
      console.error(JSON.stringify({level: 'error', event: 'api_failure', path: url.pathname, code: error.code || error.name}));
      return send(res, 503, {error: 'No se pudo procesar la solicitud. Intenta nuevamente.'});
    }
  };
}
