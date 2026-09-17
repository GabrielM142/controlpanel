import {readFileSync,writeFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseFragment} from 'parse5';
const original=readFileSync(new URL('../reference/client-original.html',import.meta.url),'utf8');
const script=original.match(/<script>([\s\S]*?)<\/script>/)[1];
const config=script.slice(0,script.indexOf('const navScroll'));
const pages=script.slice(script.indexOf('function pageNivel1'),script.lastIndexOf("selectPage('nivel1');"));
const blocks=[];
const helpers=['viz','kpiCard','kpi2','barListViz','tableViz','listBlock','iseCard','toggleViz','semaphoreMatrix','geoNav'];
const context=vm.createContext(Object.fromEntries(helpers.map(kind=>[kind,(...args)=>{const id=blocks.length;blocks.push({kind,args});return `<report-block data-id="${id}"></report-block>`;}])));
vm.runInContext(config+'\n'+pages+'\nglobalThis.report={filters:FILTER_DEFS,pages:PAGES,questions:QUESTIONS};',context,{timeout:2000});
const names=['pageNivel1','pageComercial','pageFinanciero','pageCompras','pageInventarios','pageClientes','pageLogistica','pageMarketing','pageRiesgos'];
function rich(s){return typeof s==='string'?parse(s):[{kind:'text',text:String(s??'')}];}
function parse(html){return parseFragment(html).childNodes.map(convert).filter(Boolean);}
function convert(n){
 if(n.nodeName==='#text')return {kind:'text',text:n.value};
 if(n.nodeName==='#comment')return null;
 if(n.tagName==='report-block')return block(blocks[Number(n.attrs.find(a=>a.name==='data-id').value)]);
 const attrs=Object.fromEntries((n.attrs||[]).map(a=>[a.name,a.value]));const action=attrs.onclick?.match(/selectPage\('([^']+)'\)/)?.[1];delete attrs.onclick;
 return {kind:'element',tag:n.tagName,attrs,...(action?{navigate:action}:{}),children:(n.childNodes||[]).map(convert).filter(Boolean)};
}
function block({kind,args:a}){
 switch(kind){
 case 'viz':return {kind:'panel',title:a[0],children:parse(a[1]),span:a[2]?.span};
 case 'kpiCard':return {kind:'kpi',label:a[0],value:rich(a[1]),deltas:a[2].map(d=>({label:d[0],value:rich(d[1]),tone:d[2]})),tone:a[3]};
 case 'kpi2':return {kind:'metric',label:a[0],value:rich(a[1]),sub:a[2]};
 case 'barListViz':return {kind:'bars',title:a[0],rows:a[1],max:a[2]};
 case 'tableViz':return {kind:'table',title:a[0],headers:a[1],rows:a[2].map(r=>r.map(rich)),span:a[3]?.span};
 case 'listBlock':return {kind:'list',title:a[0],items:a[1]};
 case 'iseCard':return {kind:'ise',id:a[0],score:a[1],status:a[2],color:a[3],components:a[4],formula:a[5]};
 case 'toggleViz':return {kind:'toggle',id:a[0],title:a[1],options:a[2],defaultOption:a[3],data:a[4]};
 case 'semaphoreMatrix':return {kind:'matrix',rows:a[0]};
 case 'geoNav':return {kind:'geo',id:a[0]};
 default:throw Error(kind);
 }
}
const report=JSON.parse(JSON.stringify(context.report));
report.pages=report.pages.map((pg,i)=>({...pg,question:report.questions[pg.id],nodes:parse(vm.runInContext(i<9?`${names[i]}()`:`pageUnidad('${pg.id}')`,context,{timeout:2000}))}));delete report.questions;
writeFileSync(new URL('../src/data/report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(`Migrated ${report.pages.length} pages and ${blocks.length} report components.`);
