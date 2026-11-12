import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowUpRight,Database,Loader2,MessageSquareText,RefreshCw,Send,SlidersHorizontal} from 'lucide-react';
import {useTokens} from '../tokens/useTokens';
import {useDecisions} from './useDecisions';
import {askReportAI,filtersKey,type ReportAnswer,type ReportContext} from './reportAI';
import {Eyebrow,OmegaGlyph} from './ui';

const QUICK=['Interpreta esta pantalla','¿Qué está peor y por qué?','¿Qué está mejor?','¿Cómo va contra el año anterior y el presupuesto?','¿Dónde hay concentración?','¿Qué decido esta semana?'];
const KEY='nova.omega.report.';

/** Omega dentro del reporte: lee las cifras y los filtros que tienes en pantalla. */
export function ReportAssistant({ctx,tenant,onOpenChat,onNavigate}:{ctx:ReportContext;tenant:string|null;onOpenChat:()=>void;onNavigate:(id:string)=>void}){
 const tokens=useTokens();
 const {addFromOmega}=useDecisions();
 const [q,setQ]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [answer,setAnswer]=useState<ReportAnswer|null>(()=>{try{return JSON.parse(sessionStorage.getItem(KEY+ctx.pageId)||'null');}catch{return null;}});
 const [sent,setSent]=useState<string|null>(null);
 const inputRef=useRef<HTMLInputElement>(null);
 useEffect(()=>{try{sessionStorage.setItem(KEY+ctx.pageId,JSON.stringify(answer));}catch{}},[answer,ctx.pageId]);

 const currentKey=filtersKey(ctx.filters);
 const stale=!!answer&&answer.filtersKey!==currentKey;
 const active=ctx.filters.filter(f=>!f.isDefault);
 const counts=[ctx.kpis.filter(k=>k.value!=='—').length&&`${ctx.kpis.filter(k=>k.value!=='—').length} indicadores`,ctx.series.length&&`${ctx.series.length} gráficos`,ctx.tables.length&&`${ctx.tables.length} tablas`,ctx.insights.length&&`${ctx.insights.length} hallazgos`].filter(Boolean).join(' · ');

 async function ask(text:string){
  const question=text.trim();if(!question||busy)return;
  setError(null);
  if(!tokens.spend(7,`Omega · ${ctx.label} · ${question.slice(0,30)}`)){setError('Sin consumo disponible en el plan de este período.');return;}
  setBusy(true);
  try{const a=await askReportAI(ctx,question,tenant);await new Promise(r=>setTimeout(r,350));setAnswer(a);setQ('');setSent(null);}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 const submit=(e:FormEvent)=>{e.preventDefault();ask(q);};

 return <section className="om-card om-rassist" aria-label={`Pregúntale a Omega sobre ${ctx.label}`}>
  <header className="om-rassist-head">
   <div className="om-rassist-title"><OmegaGlyph className="om-rassist-glyph"/><div><Eyebrow>Omega en este reporte</Eyebrow><h2>Pregúntale sobre lo que estás viendo</h2></div></div>
   <button type="button" className="om-btn om-btn--ghost" onClick={onOpenChat}><MessageSquareText size={14} aria-hidden="true"/>Abrir chat</button>
  </header>
  <p className="om-rassist-reads"><Database size={13} aria-hidden="true"/><span>Omega lee: {counts||'sin cifras publicadas'} · {ctx.cut}{ctx.missing.length?` · ${ctx.missing.length} pendientes de fuente`:''}</span></p>
  <p className="om-rassist-reads"><SlidersHorizontal size={13} aria-hidden="true"/><span>{active.length?<>Filtros: {active.map(f=><b key={f.key}>{f.label} {f.value}</b>)}</>:'Sin filtros adicionales: total de la vista.'}</span></p>

  <form className="om-rassist-form" onSubmit={submit}>
   <label htmlFor={`rq-${ctx.pageId}`} className="om-sr">Pregunta sobre {ctx.label}</label>
   <input ref={inputRef} id={`rq-${ctx.pageId}`} value={q} onChange={e=>setQ(e.target.value)} placeholder={`Ej.: ${ctx.question||'¿qué está pasando aquí?'}`} autoComplete="off"/>
   <button type="submit" className="om-btn om-btn--gold" disabled={busy||!q.trim()} aria-busy={busy}>{busy?<Loader2 size={14} className="om-spin" aria-hidden="true"/>:<Send size={14} aria-hidden="true"/>}{busy?'Leyendo…':'Preguntar'}</button>
  </form>
  <div className="om-suggest" role="group" aria-label="Preguntas sugeridas">{QUICK.map(s=><button key={s} type="button" className="om-pill" disabled={busy} onClick={()=>ask(s)}>{s}</button>)}</div>
  {error&&<p className="legend-note" role="alert">{error}</p>}

  <div aria-live="polite">
   {busy&&<div className="om-rassist-answer"><span className="om-thinking"><span className="om-d1"/><span className="om-d2"/><span className="om-d3"/>Omega está leyendo {ctx.label} con tus filtros…</span><span className="om-skel" style={{height:22,width:'70%'}}/><span className="om-skel" style={{height:12,width:'95%'}}/></div>}
   {!busy&&answer&&<article className="om-rassist-answer om-rise">
    <Eyebrow><OmegaGlyph/> {answer.q}{answer.engine==='llm'?' · IA':''}</Eyebrow>
    {stale&&<p className="om-rassist-stale" role="status">Cambiaste los filtros después de esta respuesta. <button type="button" className="om-link" onClick={()=>ask(answer.q)}><RefreshCw size={12} aria-hidden="true"/>Volver a interpretar</button></p>}
    <h3 className="om-rassist-headline">{answer.headline}</h3>
    {answer.points.length>0&&<ul className="om-rassist-points">{answer.points.map(p=><li key={p.text} className={`is-${p.tone}`}><i aria-hidden="true"/><span>{p.text}<small>{p.source}</small></span></li>)}</ul>}
    {answer.suggestion&&<div className="om-reco"><Eyebrow>Decisión sugerida</Eyebrow><p>{answer.suggestion}</p>
     <button type="button" className="om-btn om-btn--gold" disabled={sent===answer.id} onClick={()=>{addFromOmega({title:answer.suggestion!,detail:`Desde ${ctx.label} («${answer.q}»). ${answer.headline}`,recommendation:answer.suggestion!,pageId:ctx.pageId});setSent(answer.id);}}>{sent===answer.id?'Guardada en tu bandeja de decisiones':'Guardar como decisión pendiente (opcional)'}</button>
     {sent===answer.id&&<button type="button" className="om-link" onClick={()=>onNavigate('decisiones')}>Ver en Decisiones<ArrowUpRight size={13} aria-hidden="true"/></button>}
    </div>}
    <footer className="om-rassist-foot">
     <ul>{answer.caveats.map(c=><li key={c}>{c}</li>)}</ul>
     <p><Database size={12} aria-hidden="true"/> Fuentes: {answer.sources.join(' · ')}</p>
    </footer>
   </article>}
  </div>
 </section>;
}
