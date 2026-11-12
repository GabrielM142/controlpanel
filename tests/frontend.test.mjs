import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {enumerateBlocks} from '../lib/blocks.mjs';
import {termsCanonical} from '../scripts/admin.mjs';

const report = JSON.parse(readFileSync(new URL('../src/data/report.json', import.meta.url), 'utf8'));

test('frontend live mode: same 166 block ids as server, values from API, never demo numbers', async () => {
  const server = await createServer({server: {middlewareMode: true}, appType: 'custom', logLevel: 'error'});
  try {
    const {ReportNodes, blockIds} = await server.ssrLoadModule('/src/components/Report.tsx');
    const {WidgetsContext} = await server.ssrLoadModule('/src/features/live/LiveData.tsx');
    let total = 0;
    for (const page of report.pages) {
      const ids = blockIds(page.id, page.nodes);
      const server = enumerateBlocks(page);
      total += server.length;
      for (const b of server) assert.equal(ids.get(b.node), b.id);
    }
    assert.equal(total, 166);
    const page = report.pages.find(p => p.id === 'comercial');
    const ids = blockIds(page.id, page.nodes);
    const widgets = {'comercial-01': {kind: 'kpi', value: '$370', raw: '370.00', deltas: [{label: 'vs año anterior', value: '+5.0%', tone: 'g'}]},
      'comercial-02': {kind: 'missing', reason: 'Sin presupuesto cargado'}};
    const html = renderToStaticMarkup(createElement(WidgetsContext.Provider, {value: {live: true, loading: false, widgets, ids}},
      createElement(ReportNodes, {nodes: page.nodes})));
    assert.match(html, /\$370/);
    assert.match(html, /Sin presupuesto cargado/);
    assert.match(html, /data-block="comercial-18"/);
    const demo = renderToStaticMarkup(createElement(ReportNodes, {nodes: page.nodes}));
    const demoKpi = /<div class="kpi-value">(.*?)<\/div>/.exec(demo)[1].replace(/<[^>]+>/g, '');
    assert.ok(demoKpi.length > 0);
    assert.ok(!html.includes(`<div class="kpi-value">${demoKpi}`), 'demo KPI value must not leak into live mode');
    assert.ok((html.match(/Sin dato publicado/g) || []).length >= 10, 'unbound blocks show explicit missing state');
    const {termsCanonical: tsCanonical} = await server.ssrLoadModule('/src/data/terms.ts');
    const terms = JSON.parse(readFileSync(new URL('../src/data/terms.json', import.meta.url), 'utf8'));
    assert.equal(tsCanonical(terms), termsCanonical(terms), 'browser and server hash the same terms text');
    assert.match(createHash('sha256').update(termsCanonical(terms)).digest('hex'), /^[0-9a-f]{64}$/);
  } finally { await server.close(); }
});
