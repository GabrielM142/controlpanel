import {readFileSync} from 'node:fs';
import {decryptSecret, encryptSecret, hashPassword, newToken, sha256, verifyPassword} from '../lib/crypto.mjs';
import {withTransaction} from '../lib/db.mjs';
import {enumerateBlocks} from '../lib/blocks.mjs';
import {aiFacts, buildReport, campaignPerformance, METRICS, parseFilters, receivableSummary, thresholdValues, warehouseValuation} from '../lib/metrics.mjs';
import {AI_MODEL, aiConfigured, answerQuestion, PROVIDERS, reportDigest} from '../lib/ai.mjs';
import {alertMessage, evaluateAlerts, sendTelegram} from '../lib/alerts.mjs';
import {cashflowBase} from '../lib/cashflow.mjs';
import {seedCompany} from '../lib/seed.mjs';
import {assertCanSpend, monthUsage, recordUsage, tenantPlan, truekenSettings, publicPlan} from '../lib/truekens.mjs';
import {KINDS as NOTIFY_KINDS, notify} from '../lib/notifications.mjs';
import {demoRows} from '../lib/model.mjs';
import {assertAllowedSourceUrl} from '../lib/net-guard.mjs';
import {applyCors, HttpError, isUuid, parseCookies, readJson, send, str, toCsv} from './http.mjs';
import {handleMcp} from './mcp.mjs';

const report = JSON.parse(readFileSync(new URL('../src/data/report.json', import.meta.url), 'utf8'));
const PAGES = new Map(report.pages.map(p => [p.id, {page: p, blocks: enumerateBlocks(p)}]));

// SaaS catalog: modules a company plan can enable (report pages and features) and assignable skills.
const UNIT_PAGE_IDS = ['mayoristahogar', 'mayoristaintorno', 'retailjuj', 'retailintorno'];
const MODULES = [
  ...report.pages.filter(p => !UNIT_PAGE_IDS.includes(p.id)).map(p => ({id: p.id, label: p.label, kind: 'reporte'})),
  {id: 'unidades', label: 'Unidades de negocio (4 páginas)', kind: 'reporte'},
  {id: 'omega', label: 'Omega IA', kind: 'función'}, {id: 'presupuesto', label: 'Presupuesto', kind: 'función'},
  {id: 'flujo', label: 'Flujo de efectivo', kind: 'función'}, {id: 'tickets', label: 'Tickets de soporte', kind: 'función'},
  {id: 'iris', label: 'Iris · leads y campañas', kind: 'función'}, {id: 'bodegas', label: 'Valorización por bodega', kind: 'función'},
  {id: 'decisiones', label: 'Decisiones', kind: 'función'}, {id: 'factory', label: 'Factory', kind: 'función'},
];
const SKILLS = [
  {id: 'sk-consult-comercial', label: 'Consultoría Comercial'}, {id: 'sk-precios', label: 'Estrategia de precios'},
  {id: 'sk-cartera', label: 'Optimización de cartera'}, {id: 'sk-sku', label: 'Rentabilidad por SKU'},
  {id: 'sk-dashboard', label: 'Dashboard ejecutivo a medida'},
];
/** Module of a page id (the 4 unit pages share "unidades"). */
const moduleOf = id => (UNIT_PAGE_IDS.includes(id) ? 'unidades' : id);
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
      const plan = await tenantPlan(c, ctx.tenantId);
      if (plan.status === 'suspendida') throw new HttpError(403, 'La cuenta de tu empresa está suspendida.');
      if (Array.isArray(plan.modules) && !plan.modules.includes(moduleOf(pageId))) throw new HttpError(403, 'Este módulo no está activo en el plan de tu empresa.');
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
    const user = await tx({}, async c => (await c.query('SELECT id, email, name, password_hash, disabled_at, platform_admin FROM app.users WHERE email = $1', [email])).rows[0]);
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
      body: {user: {id: user.id, email: user.email, name: user.name, platform_admin: Boolean(user.platform_admin)}, memberships: await memberships(user.id), token_type: 'cookie'}};
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
    return {mode: 'live', user: {id: user.id, email: user.email, name: user.name, platform_admin: Boolean(user.platform_admin)}, memberships: await memberships(user.id)};
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
    // Plan and monthly Trueken quota of the company first (the super admin sets them).
    const can = await tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, c => assertCanSpend(c, ctx.tenantId));
    if (!can.ok) throw new HttpError(can.status, can.message);
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
      // Trueken ledger: real tokens × platform multiplier, with who asked, what and where.
      const spent = await tx({tenantId: ctx.tenantId, userId: ctx.user.id}, c => recordUsage(c, {tenantId: ctx.tenantId, userId: ctx.user.id,
        pageId, provider: ai.provider, model: a.model, question, usage: a.usage})).catch(e => { console.error('trueken_record_failed', e.message); return null; });
      return {headline: a.headline, points: a.points, suggestion: a.suggestion || null, missing_data: a.missing_data || [], truekens: spent?.truekens ?? null,
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

  // Company inputs Odoo does not hold: budgets, marketing campaigns and business-unit rules.
  // Everyone in the company reads them (reports use them); admins replace them.
  const BUDGET_KINDS = ['ventas', 'compras', 'gastos_fijos', 'marketing'];
  const monthOf = v => {
    const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(String(v || '').trim());
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
    return `${m[1]}-${m[2]}-01`;
  };
  const dateOf = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim()) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? String(v).trim() : null);
  const amountOf = v => { const n = Number(String(v ?? '').replace(/[$\s]/g, '').replace(/,(?=\d{3}(\D|$))/g, '')); return Number.isFinite(n) && n >= 0 ? n : null; };
  const opt = (v, max) => { const s = str(v, max); return s ? s : null; };

  route('GET', /^\/api\/inputs$/, async ({req}) => {
    const ctx = await tenantContext(req);
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => {
      const budgets = (await c.query(`SELECT kind, to_char(month, 'YYYY-MM') AS month, unit_name, brand, amount::text AS amount
          FROM app.budgets ORDER BY kind, month, unit_name NULLS FIRST, brand NULLS FIRST`)).rows;
      const campaigns = (await c.query(`SELECT id, name, status, start_date::text, end_date::text, brand, unit_name, investment::text AS investment, source, leads
          FROM app.marketing_campaigns ORDER BY start_date, id`)).rows;
      const sources = (await c.query(`SELECT id, name, rebuild_requested_at, rebuilt_at FROM app.connector_sources ORDER BY created_at`)).rows;
      const rules = (await c.query(`SELECT r.id, r.source_id, r.match_type, r.match_value, r.unit_code, r.unit_name, r.channel, r.priority,
            d.name AS match_name FROM app.business_unit_rules r
          LEFT JOIN core.dim_unit_source d ON d.source_id = r.source_id AND d.match_type = r.match_type AND d.match_value = r.match_value
          ORDER BY r.priority, r.id`)).rows;
      const options = (await c.query('SELECT source_id, match_type, match_value, name FROM core.dim_unit_source ORDER BY match_type, name')).rows;
      const brands = (await c.query(`SELECT DISTINCT brand FROM core.dim_product WHERE brand IS NOT NULL ORDER BY 1 LIMIT 500`)).rows.map(r => r.brand);
      return {budgets, campaigns, sources, rules, options, brands, units: [...new Set([...rules.map(r => r.unit_name), 'Mayorista', 'Retail', 'E-commerce', 'Institucional'])],
        can_edit: ROLE_RANK[ctx.membership.role] >= ROLE_RANK.admin};
    });
  });

  route('PUT', /^\/api\/inputs\/budgets\/(ventas|compras|gastos_fijos|marketing)$/, async ({req, match}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req, 'admin');
    const b = await readJson(req, 512 * 1024);
    if (!Array.isArray(b.rows) || b.rows.length > 5000) throw new HttpError(400, 'Envía hasta 5000 filas');
    const seen = new Set();
    const rows = b.rows.map((r, i) => {
      const month = monthOf(r.month), amount = amountOf(r.amount);
      if (!month) throw new HttpError(400, `Fila ${i + 1}: mes inválido (usa AAAA-MM)`);
      if (amount === null) throw new HttpError(400, `Fila ${i + 1}: monto inválido`);
      const row = {month, unit: opt(r.unit_name, 120), brand: opt(r.brand, 120), amount};
      const key = `${row.month}|${row.unit || ''}|${row.brand || ''}`;
      if (seen.has(key)) throw new HttpError(400, `Fila ${i + 1}: repetida (mismo mes, unidad y marca)`);
      seen.add(key);
      return row;
    });
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      await c.query('DELETE FROM app.budgets WHERE kind = $1', [match[1]]);
      for (const r of rows) await c.query(`INSERT INTO app.budgets(tenant_id, kind, month, unit_name, brand, amount, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7)`, [ctx.tenantId, match[1], r.month, r.unit, r.brand, r.amount, ctx.user.id]);
      await audit(c, ctx, 'budget.replace', match[1], {rows: rows.length});
      return {ok: true, rows: rows.length};
    });
  });

  route('PUT', /^\/api\/inputs\/campaigns$/, async ({req}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req, 'admin');
    const b = await readJson(req, 256 * 1024);
    if (!Array.isArray(b.rows) || b.rows.length > 2000) throw new HttpError(400, 'Envía hasta 2000 campañas');
    const rows = b.rows.map((r, i) => {
      const name = str(r.name, 160), start = dateOf(r.start_date), end = dateOf(r.end_date), investment = amountOf(r.investment ?? 0);
      if (!name) throw new HttpError(400, `Fila ${i + 1}: falta el nombre de la campaña`);
      if (!start || !end || end < start) throw new HttpError(400, `Fila ${i + 1}: fechas inválidas (AAAA-MM-DD, fin ≥ inicio)`);
      if (investment === null) throw new HttpError(400, `Fila ${i + 1}: inversión inválida`);
      const status = String(r.status || 'ejecutada').toLowerCase().startsWith('plan') ? 'planificada' : 'ejecutada';
      return {name, status, start, end, brand: opt(r.brand, 120), unit: opt(r.unit_name, 120), investment};
    });
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      await c.query("DELETE FROM app.marketing_campaigns WHERE source = 'csv'"); // campaigns pushed by an app stay
      for (const r of rows) await c.query(`INSERT INTO app.marketing_campaigns(tenant_id, name, status, start_date, end_date, brand, unit_name, investment, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [ctx.tenantId, r.name, r.status, r.start, r.end, r.brand, r.unit, r.investment, ctx.user.id]);
      await audit(c, ctx, 'campaigns.replace', null, {rows: rows.length});
      return {ok: true, rows: rows.length};
    });
  });

  route('PUT', /^\/api\/inputs\/units$/, async ({req}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req, 'admin');
    const b = await readJson(req, 64 * 1024);
    if (!Array.isArray(b.rules) || b.rules.length > 300) throw new HttpError(400, 'Envía hasta 300 reglas');
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      const sources = new Set((await c.query('SELECT id FROM app.connector_sources')).rows.map(r => r.id));
      const rules = b.rules.map((r, i) => {
        if (!sources.has(r.source_id)) throw new HttpError(400, `Regla ${i + 1}: fuente inválida`);
        if (!['company', 'journal', 'pos_config', 'team'].includes(r.match_type)) throw new HttpError(400, `Regla ${i + 1}: tipo inválido`);
        const value = str(String(r.match_value ?? ''), 40), name = str(String(r.unit_name ?? ''), 120), channel = str(String(r.channel ?? ''), 60) || 'General';
        if (!value || !/^\d+$/.test(value)) throw new HttpError(400, `Regla ${i + 1}: elige qué equipo, diario, POS o empresa`);
        if (!name) throw new HttpError(400, `Regla ${i + 1}: falta la unidad de negocio`);
        const code = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'unidad';
        const priority = Number.isInteger(Number(r.priority)) ? Math.min(9999, Math.max(1, Number(r.priority))) : 100;
        return {source: r.source_id, type: r.match_type, value, code, name, channel, priority};
      });
      await c.query('DELETE FROM app.business_unit_rules');
      for (const r of rules) await c.query(`INSERT INTO app.business_unit_rules(tenant_id, source_id, match_type, match_value, unit_code, unit_name, channel, priority, validated_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [ctx.tenantId, r.source, r.type, r.value, r.code, r.name, r.channel, r.priority, ctx.user.email]);
      // The worker recalculates the history with the new rules on its next tick (a few minutes).
      await c.query('UPDATE app.connector_sources SET rebuild_requested_at = now()');
      await audit(c, ctx, 'units.replace', null, {rules: rules.length});
      return {ok: true, rules: rules.length, rebuild: 'solicitado'};
    });
  });

  // Budget builder: one year of one kind at a time. The base is what really happened (sales,
  // purchases, fixed expenses from the ledger) month by month, so a budget starts from facts.
  const BUDGET_BY = ['total', 'unit', 'brand'];
  async function budgetActuals(c, kind, by, from, to, companies) {
    const p = [from, to];
    const cs = a => companies ? `AND (${a}.source_id::text || ':' || ${a}.company_id) = ANY($3::text[])` : '';
    if (companies) p.push(companies);
    let sql;
    if (kind === 'ventas') {
      const key = by === 'unit' ? `coalesce((SELECT r.unit_name FROM app.business_unit_rules r WHERE r.unit_code = m.unit_code LIMIT 1), 'Sin unidad')`
        : by === 'brand' ? `coalesce(d.brand, 'Sin marca')` : `'Empresa'`;
      sql = `SELECT ${key} AS key, to_char(m.business_date, 'YYYY-MM') AS month, sum(m.net_amount)::text AS amount FROM core.fact_sales_line m
        LEFT JOIN core.dim_product d ON d.source_id = m.source_id AND d.product_id = m.product_id
       WHERE m.business_date BETWEEN $1::date AND $2::date ${cs('m')} GROUP BY 1, 2`;
    } else if (kind === 'compras') {
      const key = by === 'brand' ? `coalesce(d.brand, 'Sin marca')` : `'Empresa'`;
      sql = `SELECT ${key} AS key, to_char(pl.approve_date, 'YYYY-MM') AS month, sum(pl.amount)::text AS amount FROM core.fact_purchase_line pl
        LEFT JOIN core.dim_product d ON d.source_id = pl.source_id AND d.product_id = pl.product_id
       WHERE pl.approve_date BETWEEN $1::date AND $2::date ${cs('pl')} GROUP BY 1, 2`;
    } else if (kind === 'gastos_fijos') {
      // Selling + administrative expenses of the ledger (601, 602): what a unit must cover.
      sql = `SELECT 'Empresa' AS key, to_char(f.month, 'YYYY-MM') AS month, sum(f.balance)::text AS amount FROM core.fact_account_month f
       WHERE f.month BETWEEN date_trunc('month', $1::date) AND $2::date AND (f.code LIKE '601%' OR f.code LIKE '602%') ${cs('f')} GROUP BY 1, 2`;
    } else return [];
    return (await c.query(sql, p)).rows.map(r => ({key: r.key, month: r.month, amount: Number(r.amount)}));
  }

  route('GET', /^\/api\/budget\/(ventas|compras|gastos_fijos|marketing)\/(\d{4})$/, async ({req, match, query}) => {
    const ctx = await tenantContext(req);
    const [kind, year] = [match[1], Number(match[2])];
    if (year < 2000 || year > 2100) throw new HttpError(400, 'Año inválido');
    const by = BUDGET_BY.includes(query.by) ? query.by : 'total';
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => {
      const rows = (await c.query(`SELECT unit_name, brand, to_char(month, 'YYYY-MM') AS month, amount::text AS amount FROM app.budgets
          WHERE kind = $1 AND month >= make_date($2, 1, 1) AND month < make_date($2 + 1, 1, 1) ORDER BY month`, [kind, year])).rows;
      const pub = (await c.query('SELECT business_date::text AS d FROM ops.published_versions ORDER BY version DESC LIMIT 1')).rows[0];
      const cut = pub?.d || `${year}-12-31`;
      const base = await budgetActuals(c, kind, by, `${year - 1}-01-01`, `${year - 1}-12-31` < cut ? `${year - 1}-12-31` : cut, ctx.companies);
      const actual = await budgetActuals(c, kind, by, `${year}-01-01`, `${year}-12-31` < cut ? `${year}-12-31` : cut, ctx.companies);
      const units = (await c.query('SELECT DISTINCT unit_name FROM app.business_unit_rules ORDER BY 1')).rows.map(r => r.unit_name);
      const brands = (await c.query(`SELECT DISTINCT brand FROM core.dim_product WHERE brand IS NOT NULL ORDER BY 1 LIMIT 300`)).rows.map(r => r.brand);
      return {kind, year, by, rows, base, actual, units, brands, cutoff: cut, can_edit: ROLE_RANK[ctx.membership.role] >= ROLE_RANK.admin};
    });
  });

  route('PUT', /^\/api\/budget\/(ventas|compras|gastos_fijos|marketing)\/(\d{4})$/, async ({req, match}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req, 'admin');
    const [kind, year] = [match[1], Number(match[2])];
    const b = await readJson(req, 512 * 1024);
    const by = BUDGET_BY.includes(b.by) ? b.by : 'total';
    if (!Array.isArray(b.rows) || b.rows.length > 5000) throw new HttpError(400, 'Envía hasta 5000 filas');
    const seen = new Set();
    const rows = b.rows.map((r, i) => {
      const month = monthOf(r.month), amount = amountOf(r.amount);
      if (!month || Number(month.slice(0, 4)) !== year) throw new HttpError(400, `Fila ${i + 1}: el mes debe ser de ${year}`);
      if (amount === null) throw new HttpError(400, `Fila ${i + 1}: monto inválido`);
      const key = by === 'total' ? null : opt(typeof r.key === 'string' ? r.key : '', 120);
      if (by !== 'total' && !key) throw new HttpError(400, `Fila ${i + 1}: falta la ${by === 'unit' ? 'unidad' : 'marca'}`);
      const k = `${month}|${key || ''}`;
      if (seen.has(k)) throw new HttpError(400, `Fila ${i + 1}: repetida`);
      seen.add(k);
      return {month, unit: by === 'unit' ? key : null, brand: by === 'brand' ? key : null, amount};
    });
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      // Replaces only this year and this level (total, by unit or by brand) of the budget kind.
      const level = by === 'unit' ? 'unit_name IS NOT NULL AND brand IS NULL' : by === 'brand' ? 'brand IS NOT NULL AND unit_name IS NULL' : 'unit_name IS NULL AND brand IS NULL';
      await c.query(`DELETE FROM app.budgets WHERE kind = $1 AND month >= make_date($2, 1, 1) AND month < make_date($2 + 1, 1, 1) AND ${level}`, [kind, year]);
      for (const r of rows) await c.query(`INSERT INTO app.budgets(tenant_id, kind, month, unit_name, brand, amount, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [ctx.tenantId, kind, r.month, r.unit, r.brand, r.amount, ctx.user.id]);
      await audit(c, ctx, 'budget.year', `${kind}:${year}:${by}`, {rows: rows.length});
      return {ok: true, rows: rows.length};
    });
  });

  // Marketing app integration (Iris or any other): admins create a token; the app pushes campaigns.
  route('GET', /^\/api\/integrations\/marketing$/, async ({req}) => {
    const ctx = await tenantContext(req, 'admin');
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => {
      const tokens = (await c.query(`SELECT id, label, created_at, last_used_at FROM app.integration_tokens
          WHERE tenant_id = $1 AND kind = 'marketing' AND revoked_at IS NULL ORDER BY id`, [ctx.tenantId])).rows;
      const sources = (await c.query(`SELECT source, count(*) AS campaigns, max(updated_at) AS last FROM app.marketing_campaigns GROUP BY 1 ORDER BY 1`)).rows;
      return {tokens, sources, endpoint: '/api/integrations/marketing/campaigns'};
    });
  });
  route('POST', /^\/api\/integrations\/marketing\/tokens$/, async ({req}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req, 'admin');
    const b = await readJson(req, 2048);
    const label = str(b.label, 80) || 'App de marketing';
    const token = `omk_${newToken()}`;
    await tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      await c.query(`INSERT INTO app.integration_tokens(tenant_id, kind, label, token_hash, created_by) VALUES ($1, 'marketing', $2, $3, $4)`,
        [ctx.tenantId, label, sha256(token), ctx.user.id]);
      await audit(c, ctx, 'integration.token', 'marketing', {label});
    });
    return {token, label}; // shown once; only its hash is stored
  });
  route('DELETE', /^\/api\/integrations\/marketing\/tokens\/(\d{1,12})$/, async ({req, match}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req, 'admin');
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      const n = (await c.query(`UPDATE app.integration_tokens SET revoked_at = now() WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL`,
        [match[1], ctx.tenantId])).rowCount;
      if (!n) throw new HttpError(404, 'Token inexistente');
      await audit(c, ctx, 'integration.revoke', match[1], {});
      return {ok: true};
    });
  });
  // Push endpoint for the marketing app: Authorization: Bearer omk_…; upsert by (source, external_id).
  route('POST', /^\/api\/integrations\/marketing\/campaigns$/, async ({req}) => {
    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!/^omk_[A-Za-z0-9_-]{40,60}$/.test(token)) throw new HttpError(401, 'Token de integración requerido');
    const owner = await tx({}, async c => (await c.query(`UPDATE app.integration_tokens SET last_used_at = now()
        WHERE token_hash = $1 AND kind = 'marketing' AND revoked_at IS NULL RETURNING tenant_id, created_by`, [sha256(token)])).rows[0]);
    if (!owner) throw new HttpError(401, 'Token inválido o revocado');
    const b = await readJson(req, 512 * 1024);
    const source = (str(typeof b.source === 'string' ? b.source : '', 40) || 'app').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'app';
    if (source === 'csv') throw new HttpError(400, 'source "csv" está reservado para la carga manual');
    if (!Array.isArray(b.campaigns) || !b.campaigns.length || b.campaigns.length > 2000) throw new HttpError(400, 'Envía entre 1 y 2000 campañas');
    const rows = b.campaigns.map((r, i) => {
      const ext = str(r.id === undefined ? '' : String(r.id), 120), name = str(typeof r.name === 'string' ? r.name : '', 160);
      const start = dateOf(r.start_date), end = dateOf(r.end_date || r.start_date), investment = amountOf(r.investment ?? 0);
      const leads = r.leads === undefined || r.leads === null ? null : Number.isInteger(Number(r.leads)) && Number(r.leads) >= 0 ? Number(r.leads) : NaN;
      if (!ext) throw new HttpError(400, `Campaña ${i + 1}: falta id`);
      if (!name) throw new HttpError(400, `Campaña ${i + 1}: falta name`);
      if (!start || !end || end < start) throw new HttpError(400, `Campaña ${i + 1}: fechas inválidas (AAAA-MM-DD)`);
      if (investment === null) throw new HttpError(400, `Campaña ${i + 1}: investment inválido`);
      if (Number.isNaN(leads)) throw new HttpError(400, `Campaña ${i + 1}: leads inválido`);
      const status = String(r.status || 'ejecutada').toLowerCase();
      return {ext, name, start, end, investment, leads, status: /plan|draft|borrador|scheduled/.test(status) ? 'planificada' : 'ejecutada',
        brand: opt(typeof r.brand === 'string' ? r.brand : null, 120), unit: opt(typeof r.unit === 'string' ? r.unit : null, 120)};
    });
    return tx({tenantId: owner.tenant_id, userId: owner.created_by}, async c => {
      for (const r of rows) await c.query(`INSERT INTO app.marketing_campaigns(tenant_id, source, external_id, name, status, start_date, end_date, brand, unit_name, investment, leads, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
          ON CONFLICT (tenant_id, source, external_id) WHERE external_id IS NOT NULL DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status,
            start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, brand = EXCLUDED.brand, unit_name = EXCLUDED.unit_name,
            investment = EXCLUDED.investment, leads = EXCLUDED.leads, updated_at = now()`,
        [owner.tenant_id, source, r.ext, r.name, r.status, r.start, r.end, r.brand, r.unit, r.investment, r.leads]);
      await c.query(`INSERT INTO ops.audit_log(tenant_id, user_id, action, target, details) VALUES ($1, $2, 'integration.push', $3, $4)`,
        [owner.tenant_id, owner.created_by, source, JSON.stringify({campaigns: rows.length})]);
      return {ok: true, source, campaigns: rows.length};
    });
  });

  // Cash flow: real cash, committed flows and run-rate; scenarios are saved per company.
  route('GET', /^\/api\/cashflow$/, async ({req, query}) => {
    const ctx = await tenantContext(req);
    const horizon = Math.min(12, Math.max(3, Number(query.meses) || 6));
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true, isolation: 'REPEATABLE READ'}, async c => {
      const pub = (await c.query('SELECT version, business_date::text AS d FROM ops.published_versions ORDER BY version DESC LIMIT 1')).rows[0];
      if (!pub?.d) return {published: null};
      const base = await cashflowBase(c, pub.d, ctx.companies, horizon);
      const scenarios = (await c.query('SELECT id, name, params, updated_at FROM app.cashflow_scenarios ORDER BY name')).rows;
      return {published: {version: pub.version, business_date: pub.d}, ...base, scenarios,
        can_edit: ROLE_RANK[ctx.membership.role] >= ROLE_RANK.analyst};
    });
  });
  route('PUT', /^\/api\/cashflow\/scenarios$/, async ({req}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req, 'analyst');
    const b = await readJson(req, 16 * 1024);
    const name = str(b.name, 80, {required: true, name: 'nombre del escenario'});
    if (!b.params || typeof b.params !== 'object' || Array.isArray(b.params)) throw new HttpError(400, 'Parámetros inválidos');
    const params = JSON.stringify(b.params);
    if (params.length > 12000) throw new HttpError(400, 'Escenario demasiado grande');
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      const row = (await c.query(`INSERT INTO app.cashflow_scenarios(tenant_id, name, params, created_by) VALUES ($1, $2, $3, $4)
          ON CONFLICT (tenant_id, name) DO UPDATE SET params = EXCLUDED.params, created_by = EXCLUDED.created_by, updated_at = now()
          RETURNING id`, [ctx.tenantId, name, params, ctx.user.id])).rows[0];
      await audit(c, ctx, 'cashflow.scenario', name, {});
      return {ok: true, id: row.id};
    });
  });
  route('DELETE', /^\/api\/cashflow\/scenarios\/(\d{1,12})$/, async ({req, match}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req, 'analyst');
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      const n = (await c.query('DELETE FROM app.cashflow_scenarios WHERE id = $1', [match[1]])).rowCount;
      if (!n) throw new HttpError(404, 'Escenario inexistente');
      return {ok: true};
    });
  });

  // Real Omega IA usage: answered questions this month (company and user) and the hourly limit.
  route('GET', /^\/api\/ai\/usage$/, async ({req}) => {
    const ctx = await tenantContext(req);
    const r = await tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => (await c.query(`SELECT
        count(*) FILTER (WHERE at >= date_trunc('month', now())) AS month,
        count(*) FILTER (WHERE at >= date_trunc('month', now()) AND user_id = $1) AS mine,
        count(*) FILTER (WHERE at > now() - interval '1 hour' AND user_id = $1) AS hour
      FROM app.ai_usage`, [ctx.user.id])).rows[0]);
    const recent = await tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => (await c.query(
      `SELECT at, page_id, provider FROM app.ai_usage WHERE user_id = $1 ORDER BY at DESC LIMIT 8`, [ctx.user.id])).rows);
    return {month: Number(r.month), mine: Number(r.mine), hour: Number(r.hour), hourly_limit: 60, recent};
  });

  // Company brand: color and logo shared by all users (admins change it).
  route('GET', /^\/api\/tenant\/theme$/, async ({req}) => {
    const ctx = await tenantContext(req);
    const row = await tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => (await c.query(
      'SELECT brand_color, logo, updated_at FROM app.tenant_theme WHERE tenant_id = $1', [ctx.tenantId])).rows[0]);
    return {brand_color: row?.brand_color || null, logo: row?.logo || null, updated_at: row?.updated_at || null,
      can_edit: ROLE_RANK[ctx.membership.role] >= ROLE_RANK.admin};
  });
  route('PUT', /^\/api\/tenant\/theme$/, async ({req}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req, 'admin');
    const b = await readJson(req, 300 * 1024);
    const color = typeof b.brand_color === 'string' ? b.brand_color.trim().toLowerCase() : '';
    if (!/^#[0-9a-f]{6}$/.test(color)) throw new HttpError(400, 'Color de marca inválido (#rrggbb)');
    const logo = b.logo === null || b.logo === undefined || b.logo === '' ? null : String(b.logo);
    if (logo && (logo.length > 280000 || !/^data:image\/(png|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(logo))) throw new HttpError(400, 'Logo inválido: PNG o SVG de hasta 200 KB');
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      await c.query(`INSERT INTO app.tenant_theme(tenant_id, brand_color, logo, updated_by, updated_at) VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (tenant_id) DO UPDATE SET brand_color = EXCLUDED.brand_color, logo = EXCLUDED.logo, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [ctx.tenantId, color, logo, ctx.user.id]);
      await audit(c, ctx, 'theme.update', color, {logo: Boolean(logo)});
      return {ok: true};
    });
  });
  route('DELETE', /^\/api\/tenant\/theme$/, async ({req}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req, 'admin');
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      await c.query('DELETE FROM app.tenant_theme WHERE tenant_id = $1', [ctx.tenantId]);
      return {ok: true};
    });
  });

  // Helpdesk (OMEGA tickets): SLA by priority, assignee, first response, resolution and comments.
  const TICKET_SLA_HOURS = {alta: 4, media: 24, baja: 72};
  const TICKET_STATUS = ['abierto', 'en_progreso', 'esperando', 'resuelto', 'cerrado'];
  const ticketCols = `t.id, t.title, t.description, t.category, t.customer, t.priority, t.status, t.assignee_id, ua.name AS assignee_name,
      t.created_by, uc.name AS created_by_name, t.created_at, t.due_at, t.first_response_at, t.resolved_at, t.updated_at, t.source`;
  const ticketFrom = `FROM app.tickets t LEFT JOIN app.users ua ON ua.id = t.assignee_id LEFT JOIN app.users uc ON uc.id = t.created_by`;

  route('GET', /^\/api\/tickets$/, async ({req, query}) => {
    const ctx = await tenantContext(req);
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => {
      const open = query.estado === 'todos' ? '' : `WHERE t.status NOT IN ('cerrado') OR t.updated_at > now() - interval '30 days'`;
      const tickets = (await c.query(`SELECT ${ticketCols} ${ticketFrom} ${open} ORDER BY (t.status IN ('resuelto', 'cerrado')), t.due_at LIMIT 500`)).rows;
      const k = (await c.query(`SELECT count(*) FILTER (WHERE status NOT IN ('resuelto', 'cerrado')) AS open,
          count(*) FILTER (WHERE status NOT IN ('resuelto', 'cerrado') AND due_at < now()) AS late,
          count(*) FILTER (WHERE status NOT IN ('resuelto', 'cerrado') AND due_at >= now() AND due_at < now() + (due_at - created_at) * 0.2) AS at_risk,
          count(*) FILTER (WHERE resolved_at >= date_trunc('day', now())) AS solved_today,
          count(*) FILTER (WHERE resolved_at > now() - interval '30 days') AS solved30,
          count(*) FILTER (WHERE resolved_at > now() - interval '30 days' AND resolved_at <= due_at) AS on_time30,
          avg(extract(epoch FROM (first_response_at - created_at)) / 60) FILTER (WHERE first_response_at IS NOT NULL AND created_at > now() - interval '30 days') AS response_min,
          avg(extract(epoch FROM (resolved_at - created_at)) / 3600) FILTER (WHERE resolved_at > now() - interval '30 days') AS resolve_h
        FROM app.tickets`)).rows[0];
      const agents = (await c.query(`SELECT u.id, u.name, m.role FROM app.memberships m JOIN app.users u ON u.id = m.user_id
          WHERE m.tenant_id = $1 AND u.disabled_at IS NULL ORDER BY u.name`, [ctx.tenantId])).rows;
      const n = v => (v === null ? null : Number(v));
      return {tickets, agents, sla_hours: TICKET_SLA_HOURS, me: ctx.user.id,
        kpis: {open: n(k.open), late: n(k.late), at_risk: n(k.at_risk), solved_today: n(k.solved_today), solved30: n(k.solved30),
          sla_pct: Number(k.solved30) ? Number(k.on_time30) / Number(k.solved30) * 100 : null, response_min: n(k.response_min), resolve_h: n(k.resolve_h)},
        can_manage: ROLE_RANK[ctx.membership.role] >= ROLE_RANK.analyst};
    });
  });
  route('GET', /^\/api\/tickets\/(\d{1,12})$/, async ({req, match}) => {
    const ctx = await tenantContext(req);
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => {
      const ticket = (await c.query(`SELECT ${ticketCols} ${ticketFrom} WHERE t.id = $1`, [match[1]])).rows[0];
      if (!ticket) throw new HttpError(404, 'Ticket inexistente');
      const comments = (await c.query(`SELECT k.id, k.body, k.internal, k.created_at, u.name AS author FROM app.ticket_comments k
          LEFT JOIN app.users u ON u.id = k.author_id WHERE k.ticket_id = $1 ORDER BY k.created_at`, [match[1]])).rows;
      return {ticket, comments};
    });
  });
  route('POST', /^\/api\/tickets$/, async ({req}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req);
    const b = await readJson(req, 16 * 1024);
    const title = str(b.title, 200, {required: true, name: 'título'});
    if (title.length < 3) throw new HttpError(400, 'El título necesita al menos 3 caracteres');
    const priority = ['alta', 'media', 'baja'].includes(b.priority) ? b.priority : 'media';
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      const row = (await c.query(`INSERT INTO app.tickets(tenant_id, title, description, category, customer, priority, created_by, due_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(hours => $8)) RETURNING id`,
      [ctx.tenantId, title, str(b.description, 8000), str(b.category, 60) || 'general', str(b.customer, 160), priority, ctx.user.id, TICKET_SLA_HOURS[priority]])).rows[0];
      await audit(c, ctx, 'ticket.create', String(row.id), {priority});
      await notify(c, ctx.tenantId, {kind: 'ticket', severity: priority === 'alta' ? 'atencion' : 'info', title: `Nuevo ticket #${row.id}: ${title}`,
        body: `Prioridad ${priority} · SLA ${TICKET_SLA_HOURS[priority]} h${str(b.customer, 160) ? ` · ${str(b.customer, 160)}` : ''}`, pageId: 'tickets', dedupe: `ticket:new:${row.id}`});
      return {id: row.id};
    });
  });
  route('PATCH', /^\/api\/tickets\/(\d{1,12})$/, async ({req, match}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req, 'analyst');
    const b = await readJson(req, 4096);
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      const t = (await c.query('SELECT id, status, priority, created_at FROM app.tickets WHERE id = $1 FOR UPDATE', [match[1]])).rows[0];
      if (!t) throw new HttpError(404, 'Ticket inexistente');
      const sets = ['updated_at = now()'];
      const p = [match[1]];
      if (b.status !== undefined) {
        if (!TICKET_STATUS.includes(b.status)) throw new HttpError(400, 'Estado inválido');
        sets.push(`status = $${p.push(b.status)}`);
        sets.push(`resolved_at = CASE WHEN $${p.length} IN ('resuelto', 'cerrado') THEN coalesce(resolved_at, now()) ELSE NULL END`);
        // Moving a ticket out of "abierto" counts as the first response.
        if (b.status !== 'abierto') sets.push('first_response_at = coalesce(first_response_at, now())');
      }
      if (b.priority !== undefined) {
        if (!TICKET_SLA_HOURS[b.priority]) throw new HttpError(400, 'Prioridad inválida');
        sets.push(`priority = $${p.push(b.priority)}`, `due_at = created_at + make_interval(hours => $${p.push(TICKET_SLA_HOURS[b.priority])})`);
      }
      if (b.assignee_id !== undefined) {
        if (b.assignee_id !== null) {
          const ok = (await c.query('SELECT 1 FROM app.memberships WHERE tenant_id = $1 AND user_id = $2', [ctx.tenantId, b.assignee_id])).rows.length;
          if (!ok) throw new HttpError(400, 'El responsable no pertenece a la empresa');
        }
        sets.push(`assignee_id = $${p.push(b.assignee_id)}`);
        if (b.assignee_id) await notify(c, ctx.tenantId, {kind: 'ticket', userId: b.assignee_id, title: `Te asignaron el ticket #${match[1]}`,
          body: 'Revísalo en Tickets de soporte.', pageId: 'tickets'});
      }
      await c.query(`UPDATE app.tickets SET ${sets.join(', ')} WHERE id = $1`, p);
      await audit(c, ctx, 'ticket.update', match[1], {status: b.status, priority: b.priority, assignee: b.assignee_id});
      return {ok: true};
    });
  });
  route('POST', /^\/api\/tickets\/(\d{1,12})\/comments$/, async ({req, match}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req);
    const b = await readJson(req, 8192);
    const body = str(b.body, 4000, {required: true, name: 'comentario'});
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      const t = (await c.query('SELECT id, created_by FROM app.tickets WHERE id = $1', [match[1]])).rows[0];
      if (!t) throw new HttpError(404, 'Ticket inexistente');
      await c.query('INSERT INTO app.ticket_comments(tenant_id, ticket_id, author_id, body, internal) VALUES ($1, $2, $3, $4, $5)',
        [ctx.tenantId, t.id, ctx.user.id, body, b.internal === true]);
      // A public answer from someone other than the requester is the first response.
      const response = b.internal !== true && t.created_by !== ctx.user.id;
      await c.query(`UPDATE app.tickets SET updated_at = now()${response ? ', first_response_at = coalesce(first_response_at, now())' : ''} WHERE id = $1`, [t.id]);
      return {ok: true};
    });
  });

  // Marketing app data (Iris or others): campaigns with leads, cost per lead, captured customers and ROI.
  route('GET', /^\/api\/marketing\/performance$/, async ({req, query}) => {
    const ctx = await tenantContext(req);
    const source = /^[a-z0-9_-]{1,40}$/.test(query.fuente || '') ? query.fuente : null;
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => {
      const pub = (await c.query('SELECT business_date::text AS d FROM ops.published_versions ORDER BY version DESC LIMIT 1')).rows[0];
      const to = pub?.d || new Date().toISOString().slice(0, 10);
      const from = /^\d{4}-\d{2}-\d{2}$/.test(query.desde || '') ? query.desde : `${to.slice(0, 4)}-01-01`;
      return {from, to, source, ...(await campaignPerformance(c, from, to, ctx.companies, source))};
    });
  });

  // ---------------------------------------------------------------------------------------------
  // SaaS: company plan, Truekens ledger, notifications, suggested values and the super admin console.
  // ---------------------------------------------------------------------------------------------
  const monthRange = mes => {
    const m = /^(\d{4})-(\d{2})$/.exec(mes || '') ? mes : new Date().toISOString().slice(0, 7);
    const [y, mm] = m.split('-').map(Number);
    return {month: m, from: `${m}-01`, to: mm === 12 ? `${y + 1}-01-01` : `${y}-${String(mm + 1).padStart(2, '0')}-01`};
  };

  // Business units of the company in display order: the 4 unit pages show them by position.
  route('GET', /^\/api\/units$/, async ({req}) => {
    const ctx = await tenantContext(req);
    const units = await tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => (await c.query(
      'SELECT unit_name, min(priority) AS p FROM app.business_unit_rules GROUP BY 1 ORDER BY 2, 1')).rows.map(r => r.unit_name));
    return {units, pages: UNIT_PAGE_IDS.map((id, i) => ({page_id: id, name: units[i] || null}))};
  });

  // Plan of the company: modules, skills, quota (members read it; the super admin changes it).
  route('GET', /^\/api\/plan$/, async ({req}) => {
    const ctx = await tenantContext(req);
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => {
      const plan = await tenantPlan(c, ctx.tenantId);
      return {...publicPlan(plan), used: await monthUsage(c)};
    });
  });

  // Truekens ledger: managers see every user; the rest only their own consumption.
  const truekenQuery = async (c, ctx, mes, mine) => {
    const {month, from, to} = monthRange(mes);
    const p = [from, to];
    const who = mine ? `AND a.user_id = $${p.push(ctx.user.id)}` : '';
    // Tenants see Truekens only: real tokens and the factor stay inside OMEGA (super admin).
    const byUser = (await c.query(`SELECT coalesce(u.name, 'Usuario eliminado') AS name, u.email, count(*)::int AS questions,
        coalesce(sum(a.truekens), 0)::float AS truekens
      FROM app.ai_usage a LEFT JOIN app.users u ON u.id = a.user_id WHERE a.at >= $1::date AND a.at < $2::date ${who}
      GROUP BY 1, 2 ORDER BY truekens DESC`, p)).rows;
    const byPage = (await c.query(`SELECT coalesce(a.page_id, 'omega') AS page_id, a.feature, count(*)::int AS questions, coalesce(sum(a.truekens), 0)::float AS truekens
      FROM app.ai_usage a WHERE a.at >= $1::date AND a.at < $2::date ${who} GROUP BY 1, 2 ORDER BY truekens DESC`, p)).rows;
    const entries = (await c.query(`SELECT a.at, coalesce(u.name, '—') AS user_name, a.page_id, a.feature, a.question, a.provider, a.model,
        a.truekens::float AS truekens
      FROM app.ai_usage a LEFT JOIN app.users u ON u.id = a.user_id WHERE a.at >= $1::date AND a.at < $2::date ${who}
      ORDER BY a.at DESC LIMIT 500`, p)).rows;
    return {month, byUser, byPage, entries};
  };
  route('GET', /^\/api\/truekens$/, async ({req, query}) => {
    const ctx = await tenantContext(req);
    const manager = ROLE_RANK[ctx.membership.role] >= ROLE_RANK.admin;
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => {
      const plan = await tenantPlan(c, ctx.tenantId);
      const used = await monthUsage(c);
      return {plan: publicPlan(plan), used, scope: manager ? 'empresa' : 'propio', ...(await truekenQuery(c, ctx, query.mes, !manager))};
    });
  });
  route('GET', /^\/api\/truekens\.csv$/, async ({req, query}) => {
    const ctx = await tenantContext(req, 'admin');
    const data = await tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, c => truekenQuery(c, ctx, query.mes, false));
    const rows = [['fecha', 'usuario', 'vista', 'pregunta', 'proveedor', 'modelo', 'truekens'],
      ...data.entries.map(e => [new Date(e.at).toISOString(), e.user_name, e.page_id || '', e.question || '', e.provider || '', e.model || '', e.truekens ?? ''])];
    return {status: 200, raw: toCsv(rows), headers: {'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="truekens-${data.month}.csv"`}};
  });

  // Notifications of the user in this company (addressed to them or to everyone), read state, prefs.
  route('GET', /^\/api\/notifications$/, async ({req, query}) => {
    const ctx = await tenantContext(req);
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: true}, async c => {
      const prefs = (await c.query('SELECT muted FROM app.notification_prefs WHERE user_id = $1', [ctx.user.id])).rows[0];
      const muted = prefs?.muted || [];
      const p = [ctx.user.id, muted];
      const kind = NOTIFY_KINDS.includes(query.tipo) ? `AND n.kind = $${p.push(query.tipo)}` : '';
      const unreadOnly = query.estado === 'no_leidas' ? 'AND r.read_at IS NULL' : '';
      const items = (await c.query(`SELECT n.id, n.kind, n.severity, n.title, n.body, n.page_id, n.created_at, r.read_at
          FROM app.notifications n LEFT JOIN app.notification_reads r ON r.notification_id = n.id AND r.user_id = $1
         WHERE (n.user_id IS NULL OR n.user_id = $1) AND NOT (n.kind = ANY($2::text[])) ${kind} ${unreadOnly}
         ORDER BY n.created_at DESC LIMIT 200`, p)).rows;
      const counts = (await c.query(`SELECT n.kind, count(*)::int AS n FROM app.notifications n
          LEFT JOIN app.notification_reads r ON r.notification_id = n.id AND r.user_id = $1
         WHERE (n.user_id IS NULL OR n.user_id = $1) AND r.read_at IS NULL AND NOT (n.kind = ANY($2::text[])) GROUP BY 1`, [ctx.user.id, muted])).rows;
      return {items, unread: counts.reduce((s, r) => s + r.n, 0), unread_by_kind: Object.fromEntries(counts.map(r => [r.kind, r.n])), muted, kinds: NOTIFY_KINDS};
    });
  });
  route('POST', /^\/api\/notifications\/read$/, async ({req}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req);
    const b = await readJson(req, 16 * 1024);
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      const ids = b.all === true ? null : (Array.isArray(b.ids) ? b.ids.map(Number).filter(Number.isInteger).slice(0, 500) : []);
      const r = await c.query(`INSERT INTO app.notification_reads(notification_id, user_id, tenant_id)
          SELECT n.id, $1, $2 FROM app.notifications n WHERE (n.user_id IS NULL OR n.user_id = $1) AND ($3::bigint[] IS NULL OR n.id = ANY($3::bigint[]))
          ON CONFLICT DO NOTHING`, [ctx.user.id, ctx.tenantId, ids]);
      return {ok: true, marked: r.rowCount ?? null};
    });
  });
  route('PUT', /^\/api\/notifications\/prefs$/, async ({req}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req);
    const b = await readJson(req, 4096);
    const muted = Array.isArray(b.muted) ? [...new Set(b.muted.filter(k => NOTIFY_KINDS.includes(k)))] : [];
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      await c.query(`INSERT INTO app.notification_prefs(tenant_id, user_id, muted, updated_at) VALUES ($1, $2, $3, now())
          ON CONFLICT (tenant_id, user_id) DO UPDATE SET muted = EXCLUDED.muted, updated_at = now()`, [ctx.tenantId, ctx.user.id, muted]);
      return {ok: true, muted};
    });
  });

  // Suggested values (budget, thresholds, units) from the company's own data; admin of the company.
  route('POST', /^\/api\/inputs\/seed$/, async ({req}) => {
    requireCsrf(req);
    const ctx = await tenantContext(req, 'admin');
    const b = await readJson(req, 2048);
    const growth = Number.isFinite(Number(b.growth)) ? Math.max(-50, Math.min(100, Number(b.growth))) : 5;
    return tx({tenantId: ctx.tenantId, userId: ctx.user.id}, async c => {
      const pub = (await c.query('SELECT business_date::text AS d FROM ops.published_versions ORDER BY version DESC LIMIT 1')).rows[0];
      if (!pub) throw new HttpError(409, 'Aún no hay datos publicados para sugerir valores.');
      const out = await seedCompany(c, ctx.tenantId, ctx.user.id, {growth, cutoff: pub.d});
      await notify(c, ctx.tenantId, {kind: 'presupuesto', title: 'Valores sugeridos cargados',
        body: `Presupuesto (${Object.entries(out.budget).map(([k, v]) => `${k}: ${v} meses`).join(', ')}), ${out.thresholds} umbrales y ${out.units} unidades, a partir de tus datos.`, pageId: 'presupuesto'});
      await audit(c, ctx, 'inputs.seed', null, out);
      return {ok: true, ...out};
    });
  });

  // ---- Super admin console (app.users.platform_admin) ------------------------------------------
  async function platformContext(req) {
    const user = await session(req);
    if (!user) throw new HttpError(401, 'Sesión requerida');
    if (!user.platform_admin) throw new HttpError(403, 'Solo el super administrador de OMEGA');
    return user;
  }
  const ptx = (user, fn, opts = {}) => tx({userId: user.id, platform: true, ...opts}, fn);
  route('GET', /^\/api\/platform\/overview$/, async ({req, query}) => {
    const user = await platformContext(req);
    const {month, from, to} = monthRange(query.mes);
    return ptx(user, async c => {
      const settings = await truekenSettings(c);
      const tenants = (await c.query(`SELECT t.id, t.slug, t.name, t.created_at, p.plan_name, coalesce(p.status, 'activa') AS status,
          CASE WHEN p.tenant_id IS NULL THEN $3::int ELSE p.trueken_quota END AS quota, p.modules, coalesce(p.skills, '{}') AS skills, p.notes,
          (SELECT count(*) FROM app.memberships m WHERE m.tenant_id = t.id)::int AS users,
          (SELECT max(business_date)::text FROM ops.published_versions v WHERE v.tenant_id = t.id) AS last_close,
          (SELECT string_agg(s.status, ',') FROM app.connector_sources s WHERE s.tenant_id = t.id) AS sources,
          (SELECT coalesce(sum(a.truekens), 0)::float FROM app.ai_usage a WHERE a.tenant_id = t.id AND a.at >= $1::date AND a.at < $2::date) AS truekens,
          (SELECT coalesce(sum(coalesce(a.input_tokens, 0) + coalesce(a.output_tokens, 0)), 0)::bigint FROM app.ai_usage a WHERE a.tenant_id = t.id AND a.at >= $1::date AND a.at < $2::date) AS tokens,
          (SELECT count(*) FROM app.ai_usage a WHERE a.tenant_id = t.id AND a.at >= $1::date AND a.at < $2::date)::int AS questions,
          (SELECT count(*) FROM app.tickets k WHERE k.tenant_id = t.id AND k.status NOT IN ('resuelto', 'cerrado'))::int AS open_tickets
        FROM app.tenants t LEFT JOIN app.tenant_plans p ON p.tenant_id = t.id ORDER BY t.name`, [from, to, settings.defaultQuota])).rows;
      return {month, settings, tenants, modules: MODULES, skills: SKILLS};
    }, {readOnly: true});
  });
  route('GET', /^\/api\/platform\/usage$/, async ({req, query}) => {
    const user = await platformContext(req);
    const {month, from, to} = monthRange(query.mes);
    const p = [from, to];
    const t = isUuid(query.empresa) ? `AND a.tenant_id = $${p.push(query.empresa)}` : '';
    return ptx(user, async c => ({month, entries: (await c.query(`SELECT a.at, te.name AS tenant, coalesce(u.name, '—') AS user_name, u.email, a.page_id, a.question,
        a.provider, a.model, a.input_tokens, a.output_tokens, a.multiplier::float AS multiplier, a.truekens::float AS truekens
      FROM app.ai_usage a JOIN app.tenants te ON te.id = a.tenant_id LEFT JOIN app.users u ON u.id = a.user_id
     WHERE a.at >= $1::date AND a.at < $2::date ${t} ORDER BY a.at DESC LIMIT 1000`, p)).rows}), {readOnly: true});
  });
  route('PUT', /^\/api\/platform\/settings$/, async ({req}) => {
    requireCsrf(req);
    const user = await platformContext(req);
    const b = await readJson(req, 4096);
    const multiplier = Number(b.multiplier);
    if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 1000) throw new HttpError(400, 'Factor inválido (mayor que 0)');
    const quota = b.default_quota === null || b.default_quota === '' ? null : Number(b.default_quota);
    if (quota !== null && (!Number.isInteger(quota) || quota < 0)) throw new HttpError(400, 'Cuota inválida');
    return ptx(user, async c => {
      await c.query(`INSERT INTO app.platform_settings(key, value, updated_by, updated_at) VALUES ('truekens', $1, $2, now())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [JSON.stringify({multiplier, unit: 'token', label: 'Truekens'}), user.id]);
      await c.query(`INSERT INTO app.platform_settings(key, value, updated_by, updated_at) VALUES ('default_plan', $1, $2, now())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [JSON.stringify({trueken_quota: quota, modules: null, skills: []}), user.id]);
      return {ok: true};
    });
  });
  route('PUT', /^\/api\/platform\/tenants\/([0-9a-f-]{36})\/plan$/, async ({req, match}) => {
    requireCsrf(req);
    const user = await platformContext(req);
    const b = await readJson(req, 16 * 1024);
    const status = b.status === 'suspendida' ? 'suspendida' : 'activa';
    const quota = b.trueken_quota === null || b.trueken_quota === '' ? null : Number(b.trueken_quota);
    if (quota !== null && (!Number.isInteger(quota) || quota < 0)) throw new HttpError(400, 'Cuota inválida');
    const modules = b.modules === null ? null : Array.isArray(b.modules) ? b.modules.filter(m => MODULES.some(x => x.id === m)) : null;
    const skills = Array.isArray(b.skills) ? b.skills.filter(s => SKILLS.some(x => x.id === s)) : [];
    return ptx(user, async c => {
      const t = (await c.query('SELECT id FROM app.tenants WHERE id = $1', [match[1]])).rows[0];
      if (!t) throw new HttpError(404, 'Empresa inexistente');
      await c.query(`INSERT INTO app.tenant_plans(tenant_id, plan_name, status, trueken_quota, modules, skills, notes, updated_by, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now()) ON CONFLICT (tenant_id) DO UPDATE SET plan_name = EXCLUDED.plan_name, status = EXCLUDED.status,
            trueken_quota = EXCLUDED.trueken_quota, modules = EXCLUDED.modules, skills = EXCLUDED.skills, notes = EXCLUDED.notes,
            updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [match[1], str(b.plan_name, 60) || 'Estándar', status, quota, modules, skills, str(b.notes, 1000), user.id]);
      return {ok: true};
    }).then(async r => {
      // Audit in the company's own transaction (a failed statement inside the platform one would abort it).
      await tx({tenantId: match[1], userId: user.id}, c => c.query('INSERT INTO ops.audit_log(tenant_id, user_id, action, target, details) VALUES ($1, $2, $3, $4, $5)',
        [match[1], user.id, 'platform.plan', match[1], JSON.stringify({status, quota, modules: modules?.length ?? 'todos', skills: skills.length})]));
      return r;
    });
  });
  route('POST', /^\/api\/platform\/tenants$/, async ({req}) => {
    requireCsrf(req);
    const user = await platformContext(req);
    const b = await readJson(req, 8192);
    const name = str(b.name, 120, {required: true, name: 'nombre de la empresa'});
    const slug = (str(b.slug, 63) || name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 63);
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) throw new HttpError(400, 'Identificador inválido');
    const email = str(b.admin_email, 200, {required: true, name: 'correo del administrador'}).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Correo inválido');
    const adminName = str(b.admin_name, 120) || email.split('@')[0];
    const temp = newToken().slice(0, 14);
    const hash = await hashPassword(temp);
    return ptx(user, async c => {
      if ((await c.query('SELECT 1 FROM app.tenants WHERE slug = $1', [slug])).rows.length) throw new HttpError(409, 'Ya existe una empresa con ese identificador');
      const t = (await c.query('INSERT INTO app.tenants(slug, name) VALUES ($1, $2) RETURNING id', [slug, name])).rows[0];
      let u = (await c.query('SELECT id FROM app.users WHERE email = $1', [email])).rows[0];
      let password = null;
      if (!u) { u = (await c.query('INSERT INTO app.users(email, name, password_hash) VALUES ($1, $2, $3) RETURNING id', [email, adminName, hash])).rows[0]; password = temp; }
      await c.query(`INSERT INTO app.memberships(tenant_id, user_id, role) VALUES ($1, $2, 'owner')`, [t.id, u.id]);
      const def = await truekenSettings(c);
      await c.query(`INSERT INTO app.tenant_plans(tenant_id, plan_name, trueken_quota, updated_by) VALUES ($1, 'Estándar', $2, $3)`, [t.id, def.defaultQuota, user.id]);
      return {id: t.id, slug, admin_email: email, temporary_password: password}; // shown once
    });
  });
  route('POST', /^\/api\/platform\/tenants\/([0-9a-f-]{36})\/members$/, async ({req, match}) => {
    requireCsrf(req);
    const user = await platformContext(req);
    const b = await readJson(req, 4096);
    const email = str(b.email, 200, {required: true, name: 'correo'}).toLowerCase();
    const role = ['owner', 'admin', 'analyst', 'viewer'].includes(b.role) ? b.role : 'viewer';
    const temp = newToken().slice(0, 14);
    const hash = await hashPassword(temp);
    return ptx(user, async c => {
      let u = (await c.query('SELECT id FROM app.users WHERE email = $1', [email])).rows[0];
      let password = null;
      if (!u) { u = (await c.query('INSERT INTO app.users(email, name, password_hash) VALUES ($1, $2, $3) RETURNING id', [email, str(b.name, 120) || email.split('@')[0], hash])).rows[0]; password = temp; }
      await c.query(`INSERT INTO app.memberships(tenant_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role`, [match[1], u.id, role]);
      return {ok: true, email, role, temporary_password: password};
    });
  });
  route('GET', /^\/api\/platform\/tenants\/([0-9a-f-]{36})\/members$/, async ({req, match}) => {
    const user = await platformContext(req);
    return ptx(user, async c => ({members: (await c.query(`SELECT u.id, u.name, u.email, m.role, m.created_at FROM app.memberships m
        JOIN app.users u ON u.id = m.user_id WHERE m.tenant_id = $1 ORDER BY m.role, u.name`, [match[1]])).rows}), {readOnly: true});
  });
  route('POST', /^\/api\/platform\/tenants\/([0-9a-f-]{36})\/seed$/, async ({req, match}) => {
    requireCsrf(req);
    const user = await platformContext(req);
    return tx({tenantId: match[1], userId: user.id}, async c => {
      const pub = (await c.query('SELECT business_date::text AS d FROM ops.published_versions ORDER BY version DESC LIMIT 1')).rows[0];
      if (!pub) throw new HttpError(409, 'La empresa aún no tiene datos publicados.');
      return {ok: true, ...(await seedCompany(c, match[1], user.id, {cutoff: pub.d}))};
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
