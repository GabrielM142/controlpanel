// Generates docs/BLOCKS_MATRIX.md: every one of the 166 report blocks with its
// source, metric, filters, capability, REAL state (computed by running the
// report builder over the fixture batches) and missing data. No block is omitted.
//   npm run docs:blocks
import {readFileSync, writeFileSync} from 'node:fs';
import {enumerateBlocks} from '../lib/blocks.mjs';
import {withTransaction} from '../lib/db.mjs';
import {buildReport, METRICS, parseFilters} from '../lib/metrics.mjs';
import {createWorld} from '../tests/helpers/world.mjs';

const report = JSON.parse(readFileSync(new URL('../src/data/report.json', import.meta.url), 'utf8'));
const LIVE_FILTERS = new Set(['anio', 'mes', 'canal', 'unidad', 'marca', 'categoria', 'provincia', 'vendedor']);
const TYPE = {kpi: 'KPI', table: 'Tabla', panel: 'Panel', list: 'Lista de hallazgos', ise: 'ISE', toggle: 'Gráfico alternable',
  geo: 'Exploración geográfica', matrix: 'Matriz comercial', metric: 'Métrica', bars: 'Barras'};
const SOURCE = {
  sales: 'mart.sales_day / core.fact_sales_line ← account_move(_line), pos_order(_line)',
  orders: 'core.fact_order_line ← sale_order(_line)',
  inventory: 'mart.inventory_day ← stock_quant, stock_valuation_layer',
};
const SOURCE_BY_METRIC = {sales_net: 'sales', gross_profit: 'sales', gross_margin_pct: 'sales', customers_invoiced: 'sales', ticket_avg: 'sales',
  orders_pending_invoice: 'orders', backorder_value: 'orders', pending_age_days: 'orders', orders_pending_15d: 'orders',
  inventory_value: 'inventory', sku_active: 'inventory'};
const esc = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

const w = await createWorld();
w.transports.juj.setVisible(3);
await w.ingest('juj');
const rows = [];
const counts = {implemented: 0, missing: 0};
for (const page of report.pages) {
  const blocks = enumerateBlocks(page);
  const widgets = await withTransaction(w.pool, {role: 'nova_api', tenantId: w.tenantA, readOnly: true}, c =>
    buildReport(c, page.id, parseFilters({anio: '2026', mes: 'Todos'}, page.id, '2026-11-11'), {blocks}));
  const applied = page.filters.filter(f => LIVE_FILTERS.has(f));
  const ignored = page.filters.filter(f => !LIVE_FILTERS.has(f));
  for (const b of blocks) {
    const wd = widgets[b.id];
    const ok = wd && wd.kind !== 'missing';
    counts[ok ? 'implemented' : 'missing'] += 1;
    const metric = wd?.metric || (ok ? (b.kind === 'table' || b.kind === 'toggle' || b.kind === 'geo' || b.kind === 'bars' ? 'agregación de venta/inventario' : '') : '');
    const src = ok ? SOURCE[SOURCE_BY_METRIC[wd.metric] || (page.id === 'inventarios' ? 'inventory' : 'sales')] : '—';
    rows.push(`| ${b.id} | ${TYPE[b.kind]} | ${esc(b.label || '—')} | ${ok ? 'Implementado · probado con fixtures · pendiente validar con cliente' : 'Sin fuente / pendiente'} | ${esc(src)} | ${esc(metric && METRICS[metric] ? `${metric} v${METRICS[metric].version} (${METRICS[metric].status})` : metric || '—')} | ${applied.join(', ') || '—'}${ignored.length ? ` (no aplicados aún: ${ignored.length})` : ''} | ${ok ? 'Live: API' : 'No'} | ${esc(ok ? (wd.note || '') : wd?.reason || '')} |`);
  }
}
await w.pool.end();

const md = `# Matriz de los 166 bloques de reportes

Generada por \`npm run docs:blocks\` ejecutando el constructor de reportes sobre los **lotes fixture**
(datos de prueba etiquetados, no del cliente). "Implementado" significa que el bloque se calcula desde
los marts de NOVA y responde a filtros; **no** significa validado con JUJ ni con su Odoo.
Un bloque "Sin fuente" se muestra en modo real como "Sin dato" con su motivo: nunca con la cifra demo.

Resumen: **${counts.implemented}** bloques implementados, **${counts.missing}** sin fuente/pendientes, total **${counts.implemented + counts.missing}**.

Filtros aplicados por la API: ${[...LIVE_FILTERS].join(', ')}. Los demás filtros del diseño (cantón, zona, subcategoría,
proveedor, bodega, etc.) se ocultan en modo real hasta tener dato y regla.

| Bloque | Tipo | Título | Estado real | Fuente | Métrica (versión, estado) | Filtros | Capability | Dato faltante / nota |
|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}
`;
writeFileSync(new URL('../docs/BLOCKS_MATRIX.md', import.meta.url), md);
console.log(`docs/BLOCKS_MATRIX.md: ${counts.implemented} implementados, ${counts.missing} pendientes`);
