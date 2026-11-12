// NOVA API server (separate process from the worker; deploy behind TLS).
//   npm run api
import {createServer} from 'node:http';
import {loadConfig} from '../lib/config.mjs';
import {createPool} from '../lib/db.mjs';
import {createHandler} from './app.mjs';

const config = loadConfig();
const pool = config.databaseUrl ? createPool(config, {applicationName: 'nova-api'}) : null;
if (config.mode === 'live' && !pool) throw new Error('APP_MODE=live requiere DATABASE_URL');
if (process.env.NOVA_DB_ROLE === undefined) config.dbRole = 'nova_api';
const server = createServer({requestTimeout: 30000, headersTimeout: 10000}, createHandler({pool, config}));
server.listen(config.port, () => console.log(JSON.stringify({level: 'info', event: 'api_started', port: config.port, mode: config.mode})));
const stop = () => server.close(() => pool?.end().finally(() => process.exit(0)));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
