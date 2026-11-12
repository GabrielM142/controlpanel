// Minimal MCP (JSON-RPC 2.0) tool surface over NOVA's analytical API. Tools
// only read published, tenant-scoped data through the same authorization as
// the UI; tenant comes from the caller's memberships (re-checked per call).
// No SQL, no Odoo ORM, no writes. Tool output is data: text found in
// documents is never executed as instructions.
import {METRICS} from '../lib/metrics.mjs';

const PROTOCOL = '2025-06-18';

const TOOLS = [
  {name: 'list_tenants', description: 'Tenants a los que el usuario autenticado tiene acceso.', inputSchema: {type: 'object', properties: {}, additionalProperties: false}},
  {name: 'get_data_freshness', description: 'Corte de negocio, intervalo de captura y estado de fuentes de un tenant.',
    inputSchema: {type: 'object', required: ['tenant_id'], additionalProperties: false, properties: {tenant_id: {type: 'string', format: 'uuid'}}}},
  {name: 'get_dashboard', description: 'Widgets calculados de un reporte (mismo corte y filtros que la UI).',
    inputSchema: {type: 'object', required: ['tenant_id', 'page'], additionalProperties: false, properties: {
      tenant_id: {type: 'string', format: 'uuid'}, page: {type: 'string'},
      filters: {type: 'object', additionalProperties: {type: 'string', maxLength: 120}, maxProperties: 12}}}},
  {name: 'get_metric_definition', description: 'Fórmula, fuente, versión y estado de aprobación de una métrica.',
    inputSchema: {type: 'object', required: ['metric'], additionalProperties: false, properties: {metric: {type: 'string'}}}},
];

const ok = (id, result) => ({jsonrpc: '2.0', id, result});
const fail = (id, code, message) => ({jsonrpc: '2.0', id: id ?? null, error: {code, message}});
const text = data => ({content: [{type: 'text', text: JSON.stringify(data)}], structuredContent: data});

export async function handleMcp(body, ctx) {
  if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') return fail(body?.id, -32600, 'Solicitud inválida');
  const {id, method, params = {}} = body;
  if (method === 'initialize') return ok(id, {protocolVersion: PROTOCOL, capabilities: {tools: {}}, serverInfo: {name: 'nova-analytics', version: '0.1.0'}});
  if (method === 'tools/list') return ok(id, {tools: TOOLS});
  if (method !== 'tools/call') return fail(id, -32601, 'Método no soportado');
  const args = params.arguments || {};
  try {
    switch (params.name) {
      case 'list_tenants':
        return ok(id, text({tenants: (await ctx.memberships()).map(m => ({tenant_id: m.tenant_id, name: m.name, role: m.role}))}));
      case 'get_data_freshness':
        return ok(id, text(await ctx.status(String(args.tenant_id))));
      case 'get_dashboard': {
        if (!ctx.pages.includes(args.page)) return fail(id, -32602, 'Reporte inexistente');
        const filters = Object.fromEntries(Object.entries(args.filters || {}).slice(0, 12).map(([k, v]) => [String(k).slice(0, 30), String(v).slice(0, 120)]));
        const data = await ctx.report(String(args.tenant_id), args.page, filters);
        return ok(id, text({page: args.page, published: data.published, filters: data.filters, widgets: data.widgets,
          note: 'Cifras calculadas por NOVA sobre el último lote publicado; "missing" indica dato no disponible (no inventar).'}));
      }
      case 'get_metric_definition': {
        const def = METRICS[args.metric];
        if (!def) return fail(id, -32602, 'Métrica desconocida');
        return ok(id, text({metric: args.metric, ...def}));
      }
      default:
        return fail(id, -32602, 'Herramienta desconocida');
    }
  } catch (error) {
    return ok(id, {isError: true, content: [{type: 'text', text: error.status === 403 ? 'Sin acceso a este tenant' : 'Error al consultar NOVA'}]});
  }
}
