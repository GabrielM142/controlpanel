import {useMemo,useState} from 'react';
import {ArrowUpRight,Forward,UserRoundCog,X} from 'lucide-react';
import {useContext} from 'react';
import {NavigateContext} from '../../components/Report';
import {fmtMoney} from './data';
import {useDecisionFlow} from './DireccionHero';
import {useDecisions,type Decision} from './useDecisions';
import {Chip,Eyebrow,OmegaGlyph} from './ui';
import {useLive} from '../live/LiveData';

const TABS=[
 {id:'pendiente',label:'Pendientes'},{id:'compra',label:'Compras'},{id:'descuento',label:'Descuentos'},
 {id:'reclamo',label:'Reclamos y tickets'},{id:'umbral',label:'Umbrales'},{id:'omega',label:'Desde Omega'},{id:'resuelta',label:'Resueltas'},
] as const;
const kindLabel:Record<Decision['kind'],string>={compra:'Compra',descuento:'Descuento',reclamo:'Reclamo',umbral:'Umbral',omega:'Omega'};
const statusLabel:Record<Decision['status'],string>={pendiente:'Pendiente',aprobada:'Aprobada',rechazada:'Rechazada',escalada:'Escalada',reasignada:'Reasignada'};

/** "Lo que espera tu decisión": tickets + umbrales + aprobaciones en una sola bandeja (TicketsView se conserva aparte). */
export default function DecisionsView(){
 const {decisions}=useDecisions();
 const navigate=useContext(NavigateContext);
 const flow=useDecisionFlow();
 const [tab,setTab]=useState<(typeof TABS)[number]['id']>('pendiente');
 const [openId,setOpenId]=useState<string|null>(null);

 const rows=useMemo(()=>decisions.filter(d=>tab==='pendiente'?d.status==='pendiente':tab==='resuelta'?d.status!=='pendiente':d.kind===tab&&d.status==='pendiente')
  .sort((a,b)=>({alta:0,media:1,baja:2}[a.priority]-{alta:0,media:1,baja:2}[b.priority])||(b.amount||0)-(a.amount||0)),[decisions,tab]);
 const pending=decisions.filter(d=>d.status==='pendiente');
 const slaRisk=pending.filter(d=>(d.sla||0)>=80).length;
 const atStake=pending.reduce((s,d)=>s+(d.amount||0),0);
 const resolved=decisions.filter(d=>d.status!=='pendiente').length;
 const current=decisions.find(d=>d.id===openId)||null;
 const {live}=useLive();
 const decErr=useDecisions().error;

 return <div className="om-decisions">
  <section className="om-kpis" aria-label="Resumen de la bandeja">
   <article className="om-card om-kpi om-kpi--ai"><Eyebrow>Abiertas</Eyebrow><strong className="om-figure">{pending.length}</strong><div className="om-kpi-foot"><span>esperan tu decisión</span></div></article>
   <article className="om-card om-kpi om-kpi--risk"><Eyebrow>SLA en riesgo</Eyebrow><strong className={`om-figure${slaRisk?' om-bad':''}`}>{slaRisk}</strong><div className="om-kpi-foot"><span>80% o más del plazo usado</span></div></article>
   <article className="om-card om-kpi om-kpi--goal"><Eyebrow>Dinero en juego</Eyebrow><strong className="om-figure">{fmtMoney(atStake)}</strong><div className="om-kpi-foot"><span>en decisiones con monto</span></div></article>
   <article className="om-card om-kpi om-kpi--income"><Eyebrow>{live?'Resueltas':'Resueltas hoy'}</Eyebrow><strong className="om-figure">{resolved}</strong><div className="om-kpi-foot"><span>{live?'guardadas para tu empresa, con quién y cuándo':'en este navegador (demo)'}</span></div></article>
  </section>

  <div className="segmented om-tabs" role="tablist" aria-label="Tipo de decisión">
   {TABS.map(t=><button key={t.id} role="tab" aria-selected={tab===t.id} onClick={()=>setTab(t.id)}>{t.label}</button>)}
  </div>

  <section className="om-card om-flush" aria-label="Decisiones">
   {rows.length===0?<p className="om-empty">{tab==='resuelta'?'Aún no resolviste ninguna decisión.':'Todo firmado. Omega te avisará si algo cambia.'}</p>:
   <ul className="om-dec-list">{rows.map(d=><li key={d.id}>
    <button type="button" className="om-dec-row" onClick={()=>setOpenId(d.id)} aria-haspopup="dialog">
     <span className={`om-prio om-prio--${d.priority}`} aria-label={`Prioridad ${d.priority}`}/>
     <span className="om-dec-main">
      <span className="om-dec-top"><Chip tone={d.kind==='compra'?'info':d.kind==='descuento'?'warn':d.kind==='umbral'?'gold':d.kind==='omega'?'ai':'bad'}>{kindLabel[d.kind]}</Chip><span className="om-muted">{d.source} · {d.age}</span>{d.status!=='pendiente'&&<Chip tone={d.status==='aprobada'?'good':d.status==='rechazada'?'bad':'neutral'}>{statusLabel[d.status]}</Chip>}</span>
      <strong>{d.title}</strong>
      {d.sla!==undefined&&<span className="om-sla" aria-label={`SLA usado ${d.sla}%`}><i style={{width:`${Math.min(100,d.sla)}%`}} className={d.sla>=90?'om-bad-bg':d.sla>=70?'om-warn-bg':'om-good-bg'}/></span>}
     </span>
     <span className="om-dec-amount">{d.amount?fmtMoney(d.amount):''}</span>
    </button>
   </li>)}</ul>}
  </section>
  {decErr&&<p className="legend-note om-ai-error" role="alert">{decErr}</p>}
  <p className="legend-note">{live?'Las decisiones vienen de Omega y de los umbrales excedidos del último cierre; cada aprobación queda registrada en el servidor con quién decidió y cuándo. No se firma nada en Odoo.':'Demo: las aprobaciones de ejemplo, tickets y umbrales provienen de los datos de demostración y tus decisiones se guardan solo en este navegador. No se firma nada en el ERP.'}</p>

  {current&&<>
   <div className="drawer-scrim" onClick={()=>setOpenId(null)}/>
   <aside className="om-drawer" role="dialog" aria-modal="true" aria-labelledby="om-dec-title">
    <header><div><Eyebrow>{kindLabel[current.kind]} · {current.source}</Eyebrow><h2 id="om-dec-title">{current.title}</h2></div>
     <button type="button" className="icon-button" aria-label="Cerrar detalle" onClick={()=>setOpenId(null)}><X size={18}/></button></header>
    {current.amount&&<p className="om-figure">{fmtMoney(current.amount)}</p>}
    <p>{current.detail}</p>
    <div className="om-reco"><Eyebrow><OmegaGlyph/> Omega recomienda</Eyebrow><p>{current.recommendation}</p></div>
    <dl className="om-meta"><dt>Responsable</dt><dd>{current.owner||'—'}</dd><dt>Prioridad</dt><dd>{current.priority}</dd><dt>Estado</dt><dd>{statusLabel[current.status]}</dd></dl>
    {current.status==='pendiente'?<div className="om-drawer-actions">
     <button type="button" className="om-btn om-btn--good" onClick={()=>{flow.request(current,'aprobada');setOpenId(null);}}>Aprobar</button>
     <button type="button" className="om-btn om-btn--ghost" onClick={()=>{flow.request(current,'rechazada');setOpenId(null);}}>Rechazar</button>
     <button type="button" className="om-btn om-btn--ghost" onClick={()=>{flow.request(current,'reasignada');setOpenId(null);}}><UserRoundCog size={14}/>Reasignar</button>
     <button type="button" className="om-btn om-btn--ghost" onClick={()=>{flow.request(current,'escalada');setOpenId(null);}}><Forward size={14}/>Escalar</button>
    </div>:<p className="om-muted">Ya resuelta: {statusLabel[current.status]}.</p>}
    {current.pageId&&<button type="button" className="om-link" onClick={()=>{setOpenId(null);navigate(current.pageId!);}}>Ver el reporte relacionado<ArrowUpRight size={13}/></button>}
   </aside>
  </>}
  {flow.dialog}{flow.toast}
 </div>;
}
