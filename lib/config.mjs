// Validated runtime configuration. Secrets are read from the environment only
// (or a secret manager reference); nothing here is exposed to the browser.

function int(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} fuera de rango (${min}-${max})`);
  return n;
}

function list(name) {
  return (process.env[name] || '').split(',').map(s => s.trim()).filter(Boolean);
}

export function loadConfig(env = process.env) {
  const mode = env.APP_MODE === 'live' ? 'live' : 'demo';
  const role = env.NOVA_DB_ROLE ?? '';
  if (role && !/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error('NOVA_DB_ROLE inválido');
  return {
    mode,
    databaseUrl: env.DATABASE_URL || '',
    dbRole: role === 'none' ? '' : role,
    poolMax: int('PGPOOL_MAX', 5, 1, 50),
    statementTimeoutMs: int('PG_STATEMENT_TIMEOUT_MS', 15000, 1000, 600000),
    corsOrigins: list('NOVA_CORS_ORIGINS'),
    cookieSecure: env.NOVA_COOKIE_SECURE !== 'false',
    sessionHours: int('NOVA_SESSION_HOURS', 12, 1, 720),
    secretKey: env.NOVA_SECRET_KEY || '',
    allowInsecureSources: env.NOVA_ALLOW_INSECURE_SOURCES === 'true',
    sourceHostAllowlist: list('NOVA_SOURCE_HOST_ALLOWLIST'),
    workerConcurrency: int('NOVA_WORKER_CONCURRENCY', 2, 1, 32),
    workerPollSeconds: int('NOVA_WORKER_POLL_SECONDS', 60, 5, 3600),
    maxPartBytes: int('NOVA_MAX_PART_BYTES', 8 * 1024 * 1024, 1024, 64 * 1024 * 1024),
    maxRunParts: int('NOVA_MAX_RUN_PARTS', 20000, 1, 100000),
    port: int('PORT', 8787, 1, 65535),
  };
}
