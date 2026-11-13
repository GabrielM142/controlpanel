import {useEffect,useState} from 'react';
import {ArrowRight,ShieldAlert,Sparkles} from 'lucide-react';
import type {ReportPayload,Widget} from '../../data/api';
import {cachedGet} from '../live/cache';
import {useLive,versionKey} from '../live/LiveData';

// Riesgos con datos reales: reúne los riesgos, oportunidades y alertas que cada reporte calcula
// con el último cierre publicado. Reemplaza en modo conectado a la narrativa de ejemplo.
type Item={t:string;d?:string;tone:'g'|'a'|'r'};
type ListW={kind:'list';items:Item[]};
type TableW={kind:'table';rows:string[][]};
const SOURCES:{page:string;label:string;blocks:{id:string;title:string}[]}[]=[
 {page:'nivel1',label:'Dirección',blocks:[{id:'nivel1-10',title:'Riesgos estratégicos'},{id:'nivel1-11',title:'Oportunidades'},{id:'nivel1-12',title:'Umbrales excedidos'}]},
 {page:'financiero',label:'Financiero',blocks:[{id:'financiero-34',title:'Alertas financieras'}]},
 {page:'clientes',label:'Clientes',blocks:[{id:'clientes-13',title:'Alertas de clientes'}]},
 {page:'compras',label:'Compras',blocks:[{id:'compras-18',title:'Alertas de compras'}]},
 {page:'logistica',label:'Logística',blocks:[{id:'logistica-17',title:'Alertas logísticas'}]},
];
const TONE:Record<string,string>={g:'var(--fin-income)',a:'var(--fin-risk)',r:'var(--fin-loss)'};

export default function RisksLive({onNavigate}:{onNavigate:(id:string)=>void}){
 const {tenantId,status}=useLive();
 const [w,setW]=useState<Record<string,Record<string,Widget>>|null>(null);
 const [err,setErr]=useState<string|null>(null);
 const version=versionKey(status);
 useEffect(()=>{
  if(!tenantId)return;let off=false;
  Promise.all(SOURCES.map(s=>cachedGet<ReportPayload>(tenantId,`/api/reports/${s.page}`,version).then(r=>[s.page,r.widgets] as const)))
   .then(all=>{if(!off)setW(Object.fromEntries(all));}).catch(e=>{if(!off)setErr((e as Error).message);});
  return()=>{off=true;};
 },[tenantId,version]);
 if(err)return <section className="panel"><div className="panel-body"><p className="legend-note om-ai-error" role="alert">{err}</p></div></section>;
 if(!w)return <section className="panel" aria-busy="true"><div className="panel-body"><p className="legend-note">Reuniendo los riesgos de cada área con el último cierre…</p></div></section>;
 const all=SOURCES.flatMap(s=>s.blocks.map(b=>({...b,page:s.page,area:s.label,w:w[s.page]?.[b.id] as unknown as {kind:string;reason?:string}|undefined})));
 const items=all.flatMap(b=>b.w?.kind==='list'?(b.w as unknown as ListW).items.map(i=>({...i,area:b.area})):[]);
 const critical=items.filter(i=>i.tone==='r').length,attention=items.filter(i=>i.tone==='a').length,good=items.filter(i=>i.tone==='g').length;
 const potential=w.clientes?.['clientes-14'] as unknown as TableW|undefined;
 const centers=w.nivel1?.['nivel1-13'] as unknown as TableW|undefined;
 return <div className="om-risks">
  <div className="grid g-4">
   <article className={`panel kpi tone-${critical?'r':'g'}`}><div className="kpi-label"><span>Riesgos críticos</span><span className={`status-dot ${critical?'r':'g'}`}/></div><div className="kpi-value">{critical}</div><p className="block-note">En todas las áreas, último cierre</p></article>
   <article className="panel kpi tone-a"><div className="kpi-label"><span>De atención</span><span className="status-dot a"/></div><div className="kpi-value">{attention}</div><p className="block-note">Vigilar esta semana</p></article>
   <article className="panel kpi tone-g"><div className="kpi-label"><span>Oportunidades y señales buenas</span><span className="status-dot g"/></div><div className="kpi-value">{good}</div><p className="block-note">Para empujar</p></article>
   <article className="panel metric"><div className="kpi-label">Estado por centro</div><div className="om-risk-centers">{centers?.kind==='table'?centers.rows.map(r=><span key={r[0]} className={`tag ${r[1]==='Bueno'?'g':r[1]==='Crítico'?'r':'a'}`}>{r[0]}: {r[1]}</span>):<span className="legend-note">Sin dato</span>}</div></article>
  </div>
  <div className="grid g-2">{all.map(b=><section key={b.id} className="panel" aria-labelledby={`rk-${b.id}`}>
   <header className="panel-heading"><h2 id={`rk-${b.id}`}>{b.area} · {b.title}</h2><button type="button" className="link-button" onClick={()=>onNavigate(b.page)}>Ver reporte <ArrowRight size={12}/></button></header>
   <div className="panel-body">{b.w?.kind==='list'?<div className="insight-list">{(b.w as unknown as ListW).items.map((i,k)=><div className="insight" key={k}><span className="insight-accent" style={{background:TONE[i.tone]||TONE.a}}/><div><strong>{i.t}</strong>{i.d&&<p>{i.d}</p>}</div></div>)}</div>
    :<p className="block-missing"><ShieldAlert size={13}/>{b.w?.kind==='missing'?b.w.reason:'Sin dato publicado.'}</p>}</div></section>)}</div>
  {potential?.kind==='table'&&potential.rows.length>0&&<section className="panel table-panel"><header className="panel-heading"><h2>Clientes en riesgo de perderse</h2><Sparkles size={15} aria-hidden="true"/></header>
   <div className="panel-body"><div className="table-scroll"><table><thead><tr><th>Cliente</th><th>Situación</th></tr></thead><tbody>{potential.rows.map((r,i)=><tr key={i}><td>{r[0]}</td><td>{r[1]}</td></tr>)}</tbody></table></div></div></section>}
  <p className="legend-note">Reunido de los reportes de Dirección, Financiero, Clientes, Compras y Logística con el cierre publicado. Ninguna cifra es estimada por IA.</p>
 </div>;
}
