import {useCallback,useContext,useEffect,useState,type FormEvent} from 'react';
import {ArrowUpRight,Bookmark,BookmarkCheck,Clock3,Database,Send} from 'lucide-react';
import {NavigateContext} from '../../components/Report';
import {type ReportPayload,type Widget} from '../../data/api';
import {useLive,versionKey} from '../live/LiveData';
import {cachedGet} from '../live/cache';
import {useTokens} from '../tokens/useTokens';
import {blocksOf,kpisOf,pageById,pageReading} from './data';
import {useDecisions} from './useDecisions';
import {Chip,Eyebrow,OmegaGlyph} from './ui';

// Intent → report page. Deterministic and read-only: Omega answers ONLY from the published data of
// the matched report and cites it. The LLM backend (F7 of the NOVA mission) is still pending.
const INTENTS:[RegExp,string][]=[
 [/margen|utilidad|rentab|ganancia|p[eé]rdid/i,'nivel1'],[/financ|caja|liquidez|ebitda|deuda|gasto/i,'financiero'],
 [/venta|vend|factur|ticket|comercial/i,'comercial'],[/compra|proveedor|abastec/i,'compras'],
 [/inventar|stock|bodega|rotaci/i,'inventarios'],[/client|cartera|fideli/i,'clientes'],
 [/log[ií]st|despach|entreg|otif/i,'logistica'],[/campa|marketing|roi/i,'marketing'],
 [/mayorista hogar/i,'mayoristahogar'],[/mayorista intorno/i,'mayoristaintorno'],[/retail juj/i,'retailjuj'],[/retail intorno/i,'retailintorno'],
 [/riesgo|empresa|general|directorio/i,'nivel1'],
];
const SUGGESTED=['¿Dónde estoy perdiendo margen?','¿Cómo van las ventas frente al año anterior?','¿Qué riesgos hay en inventario?','¿Cómo está Retail Intorno?'];

type Answer={id:string;q:string;at:string;pageId:string;conclusion:string;figures:{label:string;value:string;note:string}[];why:string[];suggestion:string|null;sources:string[];cut:string};
const HKEY='nova.omega.history',SKEY='nova.omega.saved';
const load=(k:string):Answer[]=>{try{const v=JSON.parse(localStorage.getItem(k)||'[]');return Array.isArray(v)?v:[];}catch{return [];}};

function buildAnswer(q:string,pageId:string,widgets:Record<string,Widget>|null,cut:string,version?:number):Answer{
 const page=pageById(pageId)!;
 const kpis=kpisOf(pageId,widgets).filter(k=>k.value&&k.value!=='—');
 const lists=widgets?[]:blocksOf(page).filter(b=>b.node.kind==='list').flatMap(b=>b.node.kind==='list'?b.node.items:[]);
 const why=lists.length?lists.slice(0,3).map(i=>`${i.t}${i.d?`: ${i.d}`:''}`)
  :kpis.filter(k=>k.tone!=='g').slice(0,3).map(k=>`${k.label} en ${k.value}${k.deltaLabel?` (${k.deltaLabel})`:''}`);
 const red=lists.find(i=>/red/.test(i.c))||null;
 const worstKpi=kpis.find(k=>k.tone==='r');
 const suggestion=red?`Asignar responsable y plan para: ${red.t}.`:worstKpi?`Revisar ${worstKpi.label.toLowerCase()} con el responsable del área esta semana.`:null;
 return {id:`a-${Date.now()}`,q,at:new Date().toISOString(),pageId,conclusion:pageReading(pageId,widgets),
  figures:kpis.slice(0,3).map(k=>({label:k.label,value:k.value,note:k.delta?`${k.delta} ${k.deltaLabel}`.trim():k.deltaLabel})),
  why:why.length?why:['No hay hallazgos registrados para esta vista.'],suggestion,
  sources:[`Reporte «${page.label}» (${widgets?`API NOVA · versión publicada ${version??'—'}`:'datos de demostración · report.json'})`,...kpis.slice(0,3).map(k=>`Bloque ${k.id} · ${k.label}`)],cut};
}

export default function AskOmegaView(){
 const navigate=useContext(NavigateContext);
 const live=useLive();
 const tokens=useTokens();
 const {addFromOmega}=useDecisions();
 const [q,setQ]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [history,setHistory]=useState<Answer[]>(()=>load(HKEY));
 const [saved,setSaved]=useState<Answer[]>(()=>load(SKEY));
 const [current,setCurrent]=useState<Answer|null>(()=>load(HKEY)[0]||null);
 const [sent,setSent]=useState<string|null>(null);
 useEffect(()=>{try{localStorage.setItem(HKEY,JSON.stringify(history.slice(0,20)));}catch{}},[history]);
 useEffect(()=>{try{localStorage.setItem(SKEY,JSON.stringify(saved.slice(0,20)));}catch{}},[saved]);

 const ask=useCallback(async(question:string)=>{
  const text=question.trim();if(!text||busy)return;
  setError(null);
  if(!tokens.spend(7,`Omega · ${text.slice(0,40)}`)){setError('Sin consumo disponible en el plan de este período.');return;}
  setBusy(true);
  try{
   const pageId=INTENTS.find(([re])=>re.test(text))?.[1]||'nivel1';
   let widgets:Record<string,Widget>|null=null;let cut='Datos de demostración (sin conexión a Odoo)';let version:number|undefined;
   if(live.live&&live.tenantId){
    const r=await cachedGet<ReportPayload>(live.tenantId,`/api/reports/${pageId}`,versionKey(live.status));
    widgets=r.widgets;version=r.published?.version;cut=r.published?`Cierre ${r.published.business_date} · versión ${r.published.version}`:'Sin datos publicados';
   }
   const a=buildAnswer(text,pageId,widgets,cut,version);
   setCurrent(a);setHistory(h=>[a,...h].slice(0,20));setQ('');setSent(null);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 },[busy,live.live,live.tenantId,live.status,tokens]);

 useEffect(()=>{let pre:string|null=null;try{pre=sessionStorage.getItem('nova.omega.prefill');sessionStorage.removeItem('nova.omega.prefill');}catch{}if(pre)ask(pre);},[]); // eslint-disable-line react-hooks/exhaustive-deps

 const submit=(e:FormEvent)=>{e.preventDefault();ask(q);};
 const isSaved=current&&saved.some(s=>s.q===current.q);

 return <div className="om-ask">
  <aside className="om-card om-ask-side" aria-label="Historial">
   <Eyebrow>Consultas guardadas</Eyebrow>
   {saved.length?<ul>{saved.map(s=><li key={s.id}><button type="button" onClick={()=>ask(s.q)}><BookmarkCheck size={13}/>{s.q}</button></li>)}</ul>:<p className="om-muted">Guarda una respuesta para repetirla con datos nuevos.</p>}
   <Eyebrow>Historial</Eyebrow>
   {history.length?<ul>{history.slice(0,10).map(h=><li key={h.id}><button type="button" onClick={()=>setCurrent(h)}><Clock3 size={13}/>{h.q}</button></li>)}</ul>:<p className="om-muted">Aún no preguntaste nada.</p>}
  </aside>

  <section className="om-ask-main">
   <form className="om-card om-ask-form" onSubmit={submit}>
    <label htmlFor="om-q" className="om-sr">Pregúntale a Omega</label>
    <OmegaGlyph className="om-ask-glyph"/>
    <input id="om-q" value={q} onChange={e=>setQ(e.target.value)} placeholder="Pregúntale a Omega: “¿dónde estoy perdiendo margen?”" autoComplete="off"/>
    <button type="submit" className="om-btn om-btn--gold" disabled={busy||!q.trim()} aria-busy={busy}><Send size={14} className={busy?'om-spin':''}/>{busy?'Pensando…':'Preguntar'}</button>
   </form>
   <div className="om-suggest">{SUGGESTED.map(s=><button key={s} type="button" className="om-pill" onClick={()=>ask(s)}>{s}</button>)}</div>
   {error&&<p className="legend-note" role="alert">{error}</p>}
   {busy&&<div className="om-card om-answer" aria-live="polite"><span className="om-thinking"><span className="om-d1"/><span className="om-d2"/><span className="om-d3"/>Omega está pensando…</span><span className="om-skel" style={{height:28,width:'70%'}}/><span className="om-skel" style={{height:14,width:'100%'}}/><span className="om-skel" style={{height:14,width:'55%'}}/></div>}

   {!busy&&current?<article className="om-card om-answer om-rise" aria-live="polite">
    <header className="om-answer-head"><Eyebrow><OmegaGlyph/> Omega responde · {current.q}</Eyebrow>
     <button type="button" className="om-btn om-btn--ghost" onClick={()=>setSaved(s=>isSaved?s.filter(x=>x.q!==current.q):[current,...s])}>{isSaved?<BookmarkCheck size={14}/>:<Bookmark size={14}/>}{isSaved?'Guardada':'Guardar consulta'}</button></header>
    <h2 className="om-headline om-headline--sm">{current.conclusion}</h2>
    {current.figures.length>0&&<div className="om-figs">{current.figures.map(f=><div key={f.label}><Eyebrow>{f.label}</Eyebrow><strong className="om-figure">{f.value}</strong><span>{f.note}</span></div>)}</div>}
    <Eyebrow>Por qué</Eyebrow>
    <ol className="om-why">{current.why.map(w=><li key={w}>{w}</li>)}</ol>
    {current.suggestion&&<div className="om-reco"><Eyebrow>Decisión sugerida</Eyebrow><p>{current.suggestion}</p>
     <button type="button" className="om-btn om-btn--gold" disabled={sent===current.id} onClick={()=>{addFromOmega({title:current.suggestion!,detail:`Desde la consulta «${current.q}». ${current.conclusion}`,recommendation:current.suggestion!,pageId:current.pageId});setSent(current.id);}}>{sent===current.id?'Llevada a decisiones':'Llevar a decisiones'}</button>
     {sent===current.id&&<button type="button" className="om-link" onClick={()=>navigate('decisiones')}>Abrir la bandeja<ArrowUpRight size={13}/></button>}
    </div>}
    <footer className="om-sources"><Eyebrow><Database size={12}/> Fuentes</Eyebrow><ul>{current.sources.map(s=><li key={s}>{s}</li>)}</ul>
     <p className="om-muted">Solo lectura · {current.cut} · <button type="button" className="om-link" onClick={()=>navigate(current.pageId)}>Abrir el reporte<ArrowUpRight size={12}/></button></p>
     {!live.live&&<Chip tone="warn">Demo: consulta guiada sobre los datos de ejemplo; el modelo de lenguaje se conecta en una fase posterior.</Chip>}</footer>
   </article>:!busy&&<div className="om-card om-empty-state"><OmegaGlyph className="om-big-glyph"/><h2 className="om-headline om-headline--sm">La última palabra en tus datos.</h2><p>Pregunta como hablas. Omega responde con las cifras del último cierre y te dice de dónde salen.</p></div>}
  </section>
 </div>;
}
