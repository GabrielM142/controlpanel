// OMEGA · IA dentro de cada reporte.
// 1) buildReportContext: todo lo que la pantalla muestra (KPIs, series, tablas, hallazgos, pendientes) + filtros activos.
//    Demo: report.json. En vivo: widgets de la API NOVA (mismos IDs de bloque). Nunca se mezclan.
// 2) interpretReport: lectura determinista que solo usa ese contexto y cita cada bloque.
// 3) askReportAI: si el servidor expone /api/ai/report (VITE_NOVA_AI=1), le envía el mismo contexto;
//    si no está disponible responde el intérprete local. Contrato en docs/AI_REPORTS.md.
import {api,type Widget} from '../../data/api';
import {blocksOf,kpisOf,pageById,parseNumber,richText,type Kpi} from './data';

export type ReportFilter={key:string;label:string;value:string;isDefault:boolean};
export type Series={id:string;title:string;rows:{n:string;v:number;vt:string}[]};
export type Table={id:string;title:string;headers:string[];rows:string[][]};
export type Insight={id:string;title:string;t:string;d:string;tone:'g'|'a'|'r'};
export type ReportContext={
 pageId:string;label:string;question:string;mode:'demo'|'live';cut:string;
 filters:ReportFilter[];kpis:Kpi[];series:Series[];tables:Table[];insights:Insight[];
 missing:{id:string;title:string;reason:string}[];
};
export type ReportAnswer={
 id:string;q:string;at:string;headline:string;points:{text:string;tone:'g'|'a'|'r'|'n';source:string}[];
 suggestion:string|null;caveats:string[];sources:string[];filtersKey:string;engine:'local'|'llm';
};

const toneOf=(c:string):'g'|'a'|'r'=>/red|#e|ff5|loss|bad/i.test(c)?'r':/green|good|income/i.test(c)?'g':'a';
const nodeTitle=(n:{kind:string}&Record<string,unknown>)=>String(n.title||n.label||(n.kind==='matrix'?'Matriz Comercial':n.kind==='ise'?'Índice de Salud Empresarial':n.kind==='geo'?'Cobertura Comercial':''));

export function filtersKey(filters:ReportFilter[]){return filters.map(f=>`${f.key}=${f.value}`).join('&');}

export function buildReportContext(pageId:string,widgets:Record<string,Widget>|null,filters:ReportFilter[],cut:string):ReportContext|null{
 const page=pageById(pageId);if(!page)return null;
 const live=!!widgets;
 const ctx:ReportContext={pageId,label:page.label,question:page.question||'',mode:live?'live':'demo',cut,filters,
  kpis:kpisOf(pageId,widgets),series:[],tables:[],insights:[],missing:[]};
 for(const {id,node} of blocksOf(page)){
  const title=nodeTitle(node as never);
  if(live){
   const w=widgets![id];
   if(!w||w.kind==='missing'){if(node.kind!=='panel')ctx.missing.push({id,title,reason:w&&w.kind==='missing'?w.reason:'Sin dato publicado.'});continue;}
   if(w.kind==='bars')ctx.series.push({id,title,rows:w.rows});
   else if(w.kind==='toggle')for(const [opt,rows] of Object.entries(w.data))ctx.series.push({id,title:`${title} · ${opt}`,rows});
   else if(w.kind==='table'&&node.kind==='table')ctx.tables.push({id,title,headers:node.headers.map(h=>h.t),rows:w.rows});
   else if(w.kind==='geo')ctx.series.push({id,title,rows:w.rows.map(r=>({n:r.n,v:r.v,vt:`${r.v}%`}))});
   continue;
  }
  if(node.kind==='bars')ctx.series.push({id,title,rows:node.rows.map(r=>({n:r.n,v:r.v,vt:r.vt}))});
  else if(node.kind==='toggle')for(const opt of node.options)ctx.series.push({id,title:`${title} · ${opt}`,rows:(node.data[opt]||[]).map(r=>({n:r.n,v:r.v,vt:r.vt}))});
  else if(node.kind==='table')ctx.tables.push({id,title,headers:node.headers.map(h=>h.t),rows:node.rows.map(r=>r.map(c=>richText(c)))});
  else if(node.kind==='matrix')ctx.tables.push({id,title,headers:['Dimensión','Mejor resultado','Mayor riesgo'],rows:node.rows});
  else if(node.kind==='list')for(const it of node.items)ctx.insights.push({id,title,t:it.t,d:it.d,tone:toneOf(it.c)});
 }
 ctx.series=ctx.series.filter(s=>s.rows.length);
 return ctx;
}

/** Plain-text digest of the context, the same one sent to the LLM. */
export function contextDigest(c:ReportContext){
 const f=c.filters.map(x=>`${x.label}: ${x.value}`).join(' · ');
 const k=c.kpis.filter(x=>x.value!=='—').map(x=>`${x.label} ${x.value}${x.delta?` (${x.delta} ${x.deltaLabel})`:''}`).join('; ');
 return `${c.label} — ${c.question}\nCorte: ${c.cut}\nFiltros: ${f||'sin filtros'}\nKPIs: ${k||'sin cifras'}\n`+
  c.series.map(s=>`${s.title}: ${s.rows.slice(0,12).map(r=>`${r.n} ${r.vt}`).join(', ')}`).join('\n')+'\n'+
  c.tables.map(t=>`${t.title} [${t.headers.join(' | ')}]: ${t.rows.slice(0,10).map(r=>r.join(' | ')).join(' / ')}`).join('\n')+'\n'+
  c.insights.map(i=>`${i.title}: ${i.t}${i.d?` — ${i.d}`:''}`).join('\n')+
  (c.missing.length?`\nPendientes: ${c.missing.map(m=>`${m.title} (${m.reason})`).join('; ')}`:'');
}

const norm=(s:string)=>s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
const words=(s:string)=>norm(s).split(/[^a-z0-9%]+/).filter(w=>w.length>2);
const STOP=new Set(['que','como','esta','estan','cual','cuales','por','para','los','las','del','con','una','uno','sus','mas','este','esta','hay','donde','vamos','van']);

function extremes(s:Series){
 const sorted=[...s.rows].sort((a,b)=>b.v-a.v);
 return {top:sorted[0],bottom:sorted[sorted.length-1],total:s.rows.reduce((a,r)=>a+Math.abs(r.v),0),sorted};
}

export function interpretReport(c:ReportContext,question:string):ReportAnswer{
 const q=norm(question);const qWords=words(question).filter(w=>!STOP.has(w));
 const points:ReportAnswer['points']=[];const sources=new Set<string>();
 const add=(text:string,tone:ReportAnswer['points'][number]['tone'],source:string)=>{if(points.length<6&&!points.some(p=>p.text===text)){points.push({text,tone,source});sources.add(source);}};
 const kpis=c.kpis.filter(k=>k.value&&k.value!=='—');
 const intent={
  bad:/riesgo|peor|cae|caida|baja|pierd|perdi|problema|alerta|mal|preocup|negativ|margen/.test(q),
  good:/mejor|crece|sube|gana|positiv|bien|fuerte|lider/.test(q),
  compare:/compar|vs|versus|anterior|presupuesto|meta|objetivo|variaci/.test(q),
  concentration:/concentr|top|principal|mayor|depend|peso|particip/.test(q),
  decide:/decid|recomend|accion|hacer|sugier|plan|priori/.test(q),
 };
 const summary=!Object.values(intent).some(Boolean);

 // 1. Direct mentions: a KPI label or a row (unit, brand, province, client...) named in the question.
 const mentionedKpis=qWords.length?kpis.filter(k=>words(k.label).some(w=>qWords.includes(w))):[];
 for(const k of mentionedKpis.slice(0,3))add(`${k.label}: ${k.value}${k.delta?` · ${k.delta} ${k.deltaLabel.toLowerCase()}`:''}.`,k.tone==='g'?'g':k.tone==='r'?'r':'a',`Bloque ${k.id}`);
 const rowHits:{text:string;source:string;tone:'n'|'r'|'g'}[]=[];
 for(const s of c.series)for(const r of s.rows)if(qWords.some(w=>norm(r.n).includes(w)&&w.length>3))rowHits.push({text:`${r.n} en «${s.title}»: ${r.vt}.`,source:`Bloque ${s.id}`,tone:r.v<0?'r':'n'});
 for(const t of c.tables)for(const r of t.rows)if(r[0]&&qWords.some(w=>norm(r[0]).includes(w)&&w.length>3))rowHits.push({text:`${r[0]} en «${t.title}»: ${r.slice(1).map((v,i)=>`${t.headers[i+1]||''} ${v}`.trim()).filter(Boolean).join(' · ')}.`,source:`Bloque ${t.id}`,tone:'n'});
 for(const h of rowHits.slice(0,4))add(h.text,h.tone,h.source);

 // 2. Intent-driven reading over the whole screen.
 const badKpis=kpis.filter(k=>k.tone==='r');const goodKpis=kpis.filter(k=>k.tone==='g');
 const redInsights=c.insights.filter(i=>i.tone==='r');const greenInsights=c.insights.filter(i=>i.tone==='g');
 const negSeries=c.series.flatMap(s=>s.rows.filter(r=>r.v<0).map(r=>({s,r})));
 if(intent.bad||summary){
  for(const k of badKpis.slice(0,2))add(`Para revisar: ${k.label.toLowerCase()} en ${k.value}${k.delta?` (${k.delta} ${k.deltaLabel.toLowerCase()})`:''}.`,'r',`Bloque ${k.id}`);
  for(const {s,r} of negSeries.slice(0,2))add(`${r.n} está en negativo en «${s.title}»: ${r.vt}.`,'r',`Bloque ${s.id}`);
  for(const i of redInsights.slice(0,2))add(`${i.t}${i.d?`: ${i.d}`:''}`,'r',`Bloque ${i.id}`);
  if(!badKpis.length&&!negSeries.length&&!redInsights.length&&c.series[0]){const e=extremes(c.series[0]);add(`El valor más bajo de «${c.series[0].title}» es ${e.bottom.n} (${e.bottom.vt}).`,'a',`Bloque ${c.series[0].id}`);}
 }
 if(intent.good||summary){
  for(const k of goodKpis.slice(0,2))add(`A favor: ${k.label.toLowerCase()} en ${k.value}${k.delta?` (${k.delta} ${k.deltaLabel.toLowerCase()})`:''}.`,'g',`Bloque ${k.id}`);
  for(const i of greenInsights.slice(0,1))add(`${i.t}${i.d?`: ${i.d}`:''}`,'g',`Bloque ${i.id}`);
  if(c.series[0]){const e=extremes(c.series[0]);add(`Lidera «${c.series[0].title}»: ${e.top.n} (${e.top.vt}).`,'g',`Bloque ${c.series[0].id}`);}
 }
 if(intent.compare){
  for(const k of kpis.filter(k=>k.delta).slice(0,4))add(`${k.label}: ${k.value}, ${k.delta} ${k.deltaLabel.toLowerCase()}.`,k.tone==='g'?'g':k.tone==='r'?'r':'a',`Bloque ${k.id}`);
  if(!kpis.some(k=>k.delta))add('Esta vista no trae comparación contra presupuesto ni año anterior para estos filtros.','a','Indicadores de la vista');
 }
 if(intent.concentration){
  for(const s of c.series.slice(0,2)){const e=extremes(s);if(!e.total)continue;const top3=e.sorted.slice(0,3);const share=top3.reduce((a,r)=>a+Math.abs(r.v),0)/e.total*100;
   add(`En «${s.title}» los 3 primeros (${top3.map(r=>r.n).join(', ')}) suman el ${share.toFixed(0)}% del total mostrado.`,share>=60?'r':'a',`Bloque ${s.id}`);}
 }
 if(intent.bad&&!badKpis.length&&!negSeries.length&&!redInsights.length)add('Con estos filtros no hay indicadores en rojo ni valores negativos en la pantalla.','g','Indicadores de la vista');
 if(!points.length&&kpis[0])add(`${kpis[0].label}: ${kpis[0].value}${kpis[0].delta?` (${kpis[0].delta} ${kpis[0].deltaLabel.toLowerCase()})`:''}.`,'n',`Bloque ${kpis[0].id}`);

 // 3. Headline, decision and honesty notes.
 const lead=kpis[0];
 const worst=badKpis[0]||null;const worstInsight=redInsights[0]||null;const worstRow=negSeries[0]||null;
 const headline=!kpis.length&&!c.series.length&&!c.tables.length
  ?(c.mode==='live'?'Aún no hay cifras publicadas para esta vista con estos filtros: Omega no inventa lecturas.':'Esta vista todavía no tiene indicadores.')
  :mentionedKpis[0]?`${mentionedKpis[0].label}: ${mentionedKpis[0].value}${mentionedKpis[0].delta?`, ${mentionedKpis[0].delta} ${mentionedKpis[0].deltaLabel.toLowerCase()}`:''}.`
  :rowHits[0]?rowHits[0].text
  :intent.bad&&(worst||worstRow||worstInsight)?`Lo más delicado: ${worst?`${worst.label.toLowerCase()} en ${worst.value}`:worstRow?`${worstRow.r.n} en ${worstRow.r.vt}`:worstInsight!.t}.`
  :lead?`${lead.label}: ${lead.value}${lead.delta?` (${lead.delta} ${lead.deltaLabel.toLowerCase()})`:''}${worst?`; para revisar ${worst.label.toLowerCase()} en ${worst.value}`:''}.`
  :'Lectura de la pantalla con las series y tablas visibles.';
 const suggestion=worstInsight?`Asignar responsable y plan para: ${worstInsight.t}.`
  :worst?`Revisar ${worst.label.toLowerCase()} con el responsable del área esta semana.`
  :worstRow?`Pedir explicación de ${worstRow.r.n} (${worstRow.r.vt}) en la próxima reunión.`
  :intent.decide&&c.series[0]?`Proteger lo que funciona: dar seguimiento a ${extremes(c.series[0]).top.n}.`:null;
 // The headline already states it: do not repeat it as the first point.
 const strip=(t:string)=>norm(t).replace(/[^a-z0-9]/g,'');
 for(let i=points.length-1;i>=0;i--)if(strip(headline).includes(strip(points[i].text).slice(0,40))&&points.length>1)points.splice(i,1);
 const caveats:string[]=[];
 if(c.mode==='demo')caveats.push('Modo demo: las cifras son de ejemplo y no se recalculan al cambiar los filtros.');
 if(c.missing.length)caveats.push(`${c.missing.length} indicador${c.missing.length>1?'es':''} pendiente${c.missing.length>1?'s':''} de fuente (${c.missing.slice(0,3).map(m=>m.title).join(', ')}${c.missing.length>3?'…':''}). No entran en la lectura.`);
 const active=c.filters.filter(f=>!f.isDefault);
 caveats.push(active.length?`Filtros aplicados: ${active.map(f=>`${f.label} ${f.value}`).join(' · ')}.`:'Sin filtros adicionales: lectura del total de la vista.');
 return {id:`r-${Date.now()}`,q:question,at:new Date().toISOString(),headline,points,suggestion,caveats,
  sources:[`Reporte «${c.label}» · ${c.cut}`,...sources],filtersKey:filtersKey(c.filters),engine:'local'};
}

export const AI_BACKEND=import.meta.env.VITE_NOVA_AI==='1';

/** LLM over the same context when the server offers it; otherwise the local reading. Never sends Odoo credentials. */
export async function askReportAI(c:ReportContext,question:string,tenant:string|null):Promise<ReportAnswer>{
 const local=interpretReport(c,question);
 if(!AI_BACKEND||c.mode!=='live'||!tenant)return local;
 try{
  const r=await api<{headline:string;points?:{text:string;tone?:string;source?:string}[];suggestion?:string|null;sources?:string[];missing_data?:string[]}>('/api/ai/report',
   {tenant,method:'POST',body:{page_id:c.pageId,question,filters:Object.fromEntries(c.filters.map(f=>[f.key,f.value])),cut:c.cut,context:contextDigest(c)}});
  return {...local,engine:'llm',headline:r.headline||local.headline,
   points:(r.points||[]).map(p=>({text:p.text,tone:(['g','a','r'].includes(p.tone||'')?p.tone:'n') as 'g'|'a'|'r'|'n',source:p.source||'Omega IA'})),
   suggestion:r.suggestion??local.suggestion,sources:r.sources?.length?r.sources:local.sources,
   caveats:[...(r.missing_data?.length?[`Para responder mejor falta: ${r.missing_data.join('; ')}.`]:[]),...local.caveats.filter(x=>!/^Modo demo/.test(x))]};
 }catch{return {...local,caveats:[...local.caveats,'El modelo de lenguaje no respondió: lectura calculada con las cifras de la pantalla.']};}
}

/** Numbers parsed from KPI values, for callers that need them. */
export const kpiNumber=(k:Kpi)=>parseNumber(k.value);
