import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseFragment} from 'parse5';
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const reference=readFileSync(new URL('../reference/client-original.html',import.meta.url),'utf8');
const script=reference.match(/<script>([\s\S]*?)<\/script>/)[1];
const source=script.slice(0,script.indexOf('const navScroll'))+script.slice(script.indexOf('function viz'),script.lastIndexOf("selectPage('nivel1');"));
const context=vm.createContext({window:{}});vm.runInContext(source,context,{timeout:2000});
const report=JSON.parse(readFileSync(new URL('../src/data/report.json',import.meta.url),'utf8'));
const names=['pageNivel1','pageComercial','pageFinanciero','pageCompras','pageInventarios','pageClientes','pageLogistica','pageMarketing','pageRiesgos'];
function text(node){if(node.nodeName==='#text')return node.value;const cls=node.attrs?.find(a=>a.name==='class')?.value||'';if(node.tagName==='svg'||cls.includes('ise-explain')||cls==='eyebrow')return '';return (node.childNodes||[]).map(text).join(' ');}
const normalize=s=>s.replace(/[⛶⋯▾›\s]/gu,'');
test('all 13 React reports preserve the original visible content, order and values',async()=>{
 const server=await createServer({server:{middlewareMode:true},appType:'custom'});
 try{const {ReportNodes}=await server.ssrLoadModule('/src/components/Report.tsx');
 assert.equal(report.pages.length,13);
 for(const [i,page] of report.pages.entries()){
 const expected=normalize(text(parseFragment(vm.runInContext(i<9?`${names[i]}()`:`pageUnidad('${page.id}')`,context))));
 const actual=normalize(text(parseFragment(renderToStaticMarkup(createElement(ReportNodes,{nodes:page.nodes})))));
 assert.equal(actual,expected,page.id);
 }
 }finally{await server.close();}
});
test('all original filters and options are preserved',()=>{
 const original=JSON.parse(vm.runInContext('JSON.stringify(FILTER_DEFS)',context));assert.deepEqual(report.filters,original);
 const pages=JSON.parse(vm.runInContext('JSON.stringify(PAGES)',context));assert.deepEqual(report.pages.map(({nodes,question,...p})=>p),pages);
});

