import {useEffect,useMemo,useState} from 'react';
import {CheckCircle2,AlertTriangle,LifeBuoy,Sparkles} from 'lucide-react';
import SwipeDeck from './SwipeDeck';
import {useVoice} from './useVoice';
import {marketCatalog} from '../market/data';
import {activateSkill} from '../market/activate';
import type {ReportPayload,Widget} from '../../data/api';
import {api} from '../../data/api';
import {cachedGet} from '../live/cache';
import {useLive,versionKey} from '../live/LiveData';
import {kpisOf,pageReading,parseNumber,seriesOf,type Kpi} from './data';
import {useDecisions} from './useDecisions';
import {useDecisionFlow} from './DireccionHero';
import {useNotifications} from '../notifications/useNotifications';
import {useThresholds} from '../thresholds/useThresholds';
import {demoTickets} from '../tickets/TicketsView';
import ArcReactor from './ArcReactor';
import OrbitNodes,{type OrbitNode} from './OrbitNodes';
import MissionCard from './MissionCard';
import OmegaOrb from './OmegaOrb';
import NewsTicker,{type NewsItem} from './NewsTicker';
import {LevelChip} from './AchievementToast';
import type {Motivation} from './useMotivation';

// Centro de mando (Fase M3): Dirección presentada como el HUD del copiloto. Solo datos de los
// hooks y la API actuales; en modo demo, los del fixture. Nada se rotula "en vivo": todo es del
// cierre publicado y la cinta se llama "Novedades".
type Props={widgets:Record<string,Widget>|null;live:boolean;tenantName:string;userName:string;onNavigate:(id:string)=>void;onAsk:(q:string)=>void;
 motivation?:Pick<Motivation,'xp'|'level'|'streak'|'xpFor'>};
type Viewport='phone'|'tablet'|'desktop';
const vpNow=():Viewport=>typeof window==='undefined'?'desktop':window.innerWidth<768?'phone':window.innerWidth<1280?'tablet':'desktop';
/** Fase M6: diseño por breakpoint (teléfono < 768, tableta 768–1279, escritorio y TV ≥ 1280). */
function useViewport(){const [v,setV]=useState(vpNow);useEffect(()=>{const on=()=>setV(vpNow());window.addEventListener('resize',on);return()=>window.removeEventListener('resize',on);},[]);return v;}
const hhmm=(d:Date)=>d.toLocaleTimeString('es-EC',{hour:'2-digit',minute:'2-digit'});
const short=(k?:Kpi)=>!k||k.value==='—'?'sin dato publicado':[k.delta,k.deltaLabel].filter(Boolean).join(' ').toLowerCase().slice(0,40);

/** Serie de un bloque de barras: demo del fixture; conectado, del widget (mismo id de bloque). */
function seriesFrom(page:string,block:string,widgets:Record<string,Widget>|null,live:boolean):number[]{
 if(!live)return seriesOf(page,block,null).map(r=>r.v);
 const w=widgets?.[block];return w&&w.kind==='bars'?w.rows.map(r=>r.v):[];
}

export default function CommandCenter({widgets,live,tenantName,userName,onNavigate,onAsk,motivation}:Props){
 const {tenantId,status}=useLive();
 const version=versionKey(status);
 const published=status?.published||null;
 const [fin,setFin]=useState<Record<string,Widget>|null>(null);
 const [tk,setTk]=useState<{open:number;late:number;at_risk:number;solved_today:number}|null>(null);
 useEffect(()=>{if(!live||!tenantId)return;let off=false;
  cachedGet<ReportPayload>(tenantId,'/api/reports/financiero',version).then(r=>{if(!off)setFin(r.widgets);}).catch(()=>{});
  api<{kpis:{open:number;late:number;at_risk:number;solved_today:number}}>('/api/tickets',{tenant:tenantId}).then(r=>{if(!off)setTk(r.kpis);}).catch(()=>{});
  return()=>{off=true;};},[live,tenantId,version]);
 const [now,setNow]=useState(()=>new Date());
 useEffect(()=>{const t=setInterval(()=>setNow(new Date()),30000);return()=>clearInterval(t);},[]);

 const src=live?widgets:null,finSrc=live?fin:null;
 const k=useMemo(()=>kpisOf('nivel1',src),[src]);const f=useMemo(()=>kpisOf('financiero',finSrc),[finSrc]);
 const by=(list:Kpi[],label:string)=>list.find(x=>x.label===label);
 const ventas=by(k,'Ventas'),cumpl=by(k,'Cumplimiento'),util=by(k,'Utilidad'),ise=by(k,'ISE General');
 const caja=by(f,'Flujo de Caja Disponible'),gastos=by(f,'Gastos Totales');
 const pulse=ise?parseNumber(ise.value.split('/')[0]):null;
 const tickets=live?tk:{open:demoTickets.filter(t=>t.status!=='resuelto'&&t.status!=='cerrado').length,late:demoTickets.filter(t=>t.sla>=100&&t.status!=='resuelto'&&t.status!=='cerrado').length,at_risk:demoTickets.filter(t=>t.sla>=80&&t.sla<100).length,solved_today:demoTickets.filter(t=>t.status==='resuelto').length};
 const utilNeg=util?(parseNumber(util.value)??0)<0:false;

 const nodes:OrbitNode[]=[
  {id:'ingresos',label:'INGRESOS',value:ventas?.value||'—',delta:short(ventas),fin:'income',angle:-90},
  {id:'meta',label:'META',value:cumpl?.value||'—',delta:cumpl&&cumpl.value!=='—'?'vs presupuesto':'sin presupuesto',fin:'goal',angle:-30},
  {id:'caja',label:'CAJA',value:caja?.value||'—',delta:caja&&caja.value!=='—'?'flujo del período':'sin dato publicado',fin:'cash',angle:30},
  {id:'soporte',label:'SOPORTE',value:tickets?String(tickets.open):'—',delta:tickets?(tickets.late?`${tickets.late} vencidos`:tickets.at_risk?`${tickets.at_risk} por vencer`:'al día'):'sin datos',fin:'ai',angle:90},
  {id:'utilidad',label:'UTILIDAD',value:util?.value||'—',delta:short(util),fin:utilNeg?'loss':'income',angle:150},
  {id:'costos',label:'COSTOS',value:gastos?.value||'—',delta:gastos&&gastos.value!=='—'?'gastos totales':'sin dato publicado',fin:'cost',angle:210},
 ];
 const [sel,setSel]=useState('ingresos');
 // KPI de origen de cada nodo: cuando no hay serie mensual, Enfoque compara con su referencia real.
 const focusKpi:Record<string,Kpi|undefined>={ingresos:ventas,meta:cumpl,caja,utilidad:util,costos:gastos};
 const focusNode=nodes.find(n=>n.id===sel)!;
 const focusSeries=sel==='utilidad'?seriesFrom('financiero','financiero-30',finSrc,live):sel==='caja'?seriesFrom('financiero','financiero-32',finSrc,live):[];
 const focusText=sel==='soporte'?(tickets?`${tickets.open} tickets abiertos${tickets.late?`, ${tickets.late} con el SLA vencido`:''}${tickets.solved_today?`; ${tickets.solved_today} resueltos hoy`:''}.`:'Sin datos de soporte.')
  :sel==='caja'||sel==='costos'?pageReading('financiero',finSrc):pageReading('nivel1',src);

 const {decisions}=useDecisions();
 const flow=useDecisionFlow();
 const pending=decisions.filter(d=>d.status==='pendiente');
 const [touched,setTouched]=useState<string[]>([]);
 const missions=[...decisions.filter(d=>touched.includes(d.id)),...pending.filter(d=>!touched.includes(d.id))].slice(0,3);
 const act=(id:string,ok:boolean)=>{const d=decisions.find(x=>x.id===id);if(!d)return;setTouched(t=>[...new Set([...t,id])]);flow.request(d,ok?'aprobada':'rechazada');};

 const c=cumpl?parseNumber(cumpl.value):null,u=util?parseNumber(util.value):null;
 const first=pending[0];
 const line1=c===null?'estas son tus cifras del cierre.':c>=100?'vendes por encima de lo previsto':'vendes por debajo de lo previsto';
 const line2=u===null?'':u<0?', pero la utilidad es negativa':', y la operación deja utilidad';
 const greeting=`${userName.split(' ')[0]}, ${line1}${line2}.`;

 const {data:notes}=useNotifications();
 const {activeAlerts}=useThresholds();
 const news=useMemo<NewsItem[]>(()=>{
  const out:NewsItem[]=[];
  if(live&&published)out.push({id:'cierre',text:`Cierre ${published.business_date} publicado`,when:hhmm(new Date(published.published_at)),fin:'cash'});
  if(!live)out.push({id:'demo',text:'Datos de demostración',when:'desde el cierre',fin:'cash'});
  for(const n of (notes?.items||[]).filter(n=>!n.read_at).slice(0,6))out.push({id:`n${n.id}`,text:n.title,when:hhmm(new Date(n.created_at)),fin:n.severity==='critica'?'loss':n.severity==='atencion'?'goal':'ai'});
  for(const d of decisions.filter(d=>d.status!=='pendiente').slice(0,4))out.push({id:`d${d.id}`,text:`Decisión ${d.status}: ${d.title}`,when:'hoy',fin:d.status==='aprobada'?'income':'ai'});
  if(tickets?.solved_today)out.push({id:'tk',text:`${tickets.solved_today} ticket${tickets.solved_today>1?'s':''} resuelto${tickets.solved_today>1?'s':''} hoy`,when:'hoy',fin:'income'});
  if(!live)for(const a of activeAlerts.slice(0,4))out.push({id:`a${a.id}`,text:`${a.label} excedido`,when:'desde el cierre',fin:a.tone==='r'?'loss':'goal'});
  return out;
 },[live,published,notes,decisions,tickets,activeAlerts]);

 const closeAt=published?new Date(Object.values(published.sources)[0]?.observed_to||published.published_at):null;
 const stale=!!published?.business_date&&(Date.now()-new Date(`${published.business_date}T23:59:59`).getTime())>2*86400000;
 const voice=useVoice(text=>onAsk(text));
 const vp=useViewport();
 const [tab,setTab]=useState<'misiones'|'soporte'|'skills'>('misiones');
 const pulseTone=pulse===null?'goal':pulse>=80?'income':pulse>=60?'goal':'loss';
 const missionsPanel=<>
  {missions.length?missions.map(d=><MissionCard key={d.id} d={d} onExecute={()=>act(d.id,true)} onDismiss={()=>act(d.id,false)} xp={motivation?{ok:motivation.xpFor('ok'),no:motivation.xpFor('no')}:undefined}/>)
   :<p className="mx-empty">No hay decisiones pendientes. Omega te avisará cuando algo necesite tu firma.</p>}
  <button type="button" className="mx-link" onClick={()=>onNavigate('decisiones')}>Ver toda la bandeja →</button>
 </>;
 const omegaPanel=<div className="mx-panel mx-omega">
  <OmegaOrb listening={voice.listening} label={voice.listening?(voice.interim||'Te escucho… habla con naturalidad'):voice.error||(voice.supported?'Toca el micrófono y pregunta en voz alta':'Toca para escribir tu pregunta')}
   onPress={()=>voice.supported?voice.toggle():onAsk('')}/>
  <p className="mx-omega-msg">{greeting}{first?<> ¿Ejecuto <strong>{first.title}</strong>{first.amount?` (${first.amount.toLocaleString('es-EC',{style:'currency',currency:'USD',maximumFractionDigits:0})})`:''}?</>:' No hay decisiones pendientes.'}</p>
  <div className="mx-omega-actions">
   {first&&<button type="button" className="mx-btn-ai" onClick={()=>act(first.id,true)}>Sí, hazlo</button>}
   <button type="button" className="mx-btn-ghost is-ai" onClick={()=>onAsk('Explícame los números del último cierre')}>Explícame los números</button>
  </div>
 </div>;
 const statusText=live?(published?`Datos al cierre del ${published.business_date}${closeAt?` · ${hhmm(closeAt)}`:''}${stale?' · desactualizado':''}`:'Sin datos publicados todavía'):'Datos de demostración · sin conexión a Odoo';

 // Teléfono: cabina HUD. Reactor al centro con los 6 indicadores alrededor (arriba y abajo),
 // Enfoque del indicador tocado, Omega por voz, misiones deslizables y novedades.
 if(vp==='phone'){
  const byId=(id:string)=>nodes.find(n=>n.id===id)!;
  const top=['costos','ingresos','meta'].map(byId),bottom=['utilidad','soporte','caja'].map(byId);
  const node=(n:OrbitNode)=><button key={n.id} type="button" className={`mx-ph-node fin-${n.fin}${sel===n.id?' is-on':''}`} aria-pressed={sel===n.id}
   aria-label={`${n.label}: ${n.value}, ${n.delta}`} onClick={()=>setSel(n.id)}>
   <span className="mx-ph-node-label">{n.label}</span><strong>{n.value}</strong><span className="mx-ph-node-delta">{n.delta}</span></button>;
  return <div className="mx-cmd mx-phone">
   <header className="mx-ph-head">
    <span className="mx-cmd-mark" aria-hidden="true">Ω</span>
    <div className="mx-ph-id"><span className="mx-hud-title">CENTRO DE MANDO</span><span className="mx-muted">{tenantName}</span></div>
    <time className="mx-ph-clock" dateTime={now.toISOString()}>{hhmm(now)}</time>
   </header>
   <div className="mx-ph-chips">
    <span className={`mx-ph-status${stale?' is-stale':''}`}><i aria-hidden="true"/>{statusText}</span>
    {motivation&&<LevelChip m={motivation} compact/>}
   </div>
   <section className="mx-ph-cockpit" aria-label="Pulso de la empresa e indicadores del cierre">
    <div className="mx-ph-row">{top.map(node)}</div>
    <div className="mx-ph-core">
     <svg className="mx-ph-links" viewBox="0 0 300 300" aria-hidden="true" preserveAspectRatio="none">
      <path d="M50 0 L110 92"/><path d="M150 0 L150 52"/><path d="M250 0 L190 92"/>
      <path d="M50 300 L110 208"/><path d="M150 300 L150 248"/><path d="M250 300 L190 208"/>
     </svg>
     <ArcReactor value={pulse} size={300} delta={ise&&ise.value!=='—'?(ise.deltaLabel||'').slice(0,32).toLowerCase():undefined} tone={pulseTone}/>
    </div>
    <div className="mx-ph-row">{bottom.map(node)}</div>
   </section>
   <div className="mx-panel mx-focus mx-ph-focus" aria-live="polite">
    <span className="mx-hud-title mx-muted">ENFOQUE · toca un indicador</span>
    <strong className={`mx-focus-title fin-${focusNode.fin}`}>{focusNode.label} · {focusNode.value}</strong>
    <FocusVisual values={focusSeries} fin={focusNode.fin} kpi={focusKpi[sel]} meta={sel==='meta'}/>
    <p className="mx-focus-text">{focusText}</p>
   </div>
   {omegaPanel}
   <section className="mx-ph-missions" aria-label="Misiones de hoy">
    <div className="mx-panel-head"><span className="mx-hud-title">MISIONES DE HOY</span><span className="mx-muted">{pending.length?`${pending.length} por resolver`:'Todo resuelto'}</span></div>
    <SwipeDeck decisions={decisions} live={live} onDecide={(d,ok)=>act(d.id,ok)} xpFor={motivation?.xpFor}/>
   </section>
   <NewsTicker items={news}/>
   {flow.dialog}{flow.toast}
  </div>;
 }

 // Tableta: reactor con 4 indicadores en 2×2 y pestañas Misiones / Soporte / Skills.
 if(vp==='tablet'){
  const tiles=[{n:nodes[0],to:'comercial'},{n:nodes[1],to:'presupuesto'},{n:nodes[2],to:'flujo'},{n:nodes[4],to:'financiero'}];
  return <div className="mx-cmd mx-tablet">
   <header className="mx-cmd-head">
    <span className="mx-cmd-mark" aria-hidden="true">Ω</span>
    <div><div className="mx-hud-title mx-cmd-title">OMEGA · CENTRO DE MANDO</div><div className="mx-cmd-sub">{tenantName}</div></div>
    <span className="mx-cmd-spacer"/>
    {motivation&&<LevelChip m={motivation} compact/>}
    <span className={`mx-cmd-status${stale?' is-stale':''}`}>{statusText}</span>
   </header>
   <div className="mx-tab-grid">
    <section className="mx-panel mx-tab-reactor" aria-label="Pulso de la empresa">
     <ArcReactor value={pulse} size={300} delta={ise&&ise.value!=='—'?(ise.deltaLabel||'').slice(0,40).toLowerCase():undefined} tone={pulseTone}/>
     <div className="mx-tiles">{tiles.map(({n,to})=><button type="button" key={n.id} className="mx-tile om-hover-grow" onClick={()=>onNavigate(to)}>
      <span className="mx-hud-title mx-muted">{n.label}</span><strong className={`fin-${n.fin}`}>{n.value}</strong><span className="mx-muted">{n.delta}</span></button>)}</div>
    </section>
    <section className="mx-panel mx-tabs-panel">
     <div className="mx-tabs" role="tablist" aria-label="Centro de mando" onKeyDown={e=>{const order=['misiones','soporte','skills'] as const;const i=order.indexOf(tab);
      const n=e.key==='ArrowRight'?order[(i+1)%3]:e.key==='ArrowLeft'?order[(i+2)%3]:e.key==='Home'?order[0]:e.key==='End'?order[2]:null;
      if(n){e.preventDefault();setTab(n);document.getElementById(`mx-tab-${n}`)?.focus();}}}>
      {([['misiones',`Misiones${pending.length?` · ${pending.length}`:''}`],['soporte','Soporte'],['skills','Skills']] as const).map(([id,l])=>
       <button key={id} type="button" role="tab" id={`mx-tab-${id}`} aria-selected={tab===id} aria-controls={tab===id?`mx-tabp-${id}`:undefined} tabIndex={tab===id?0:-1} className={`mx-tab${tab===id?' is-on':''}`} onClick={()=>setTab(id)}>{l}</button>)}
     </div>
     <div role="tabpanel" id={`mx-tabp-${tab}`} aria-labelledby={`mx-tab-${tab}`} className="mx-tabpanel">
      {tab==='misiones'&&missionsPanel}
      {tab==='soporte'&&<>
       <div className="mx-tiles">
        <div className="mx-tile"><span className="mx-hud-title mx-muted">ABIERTOS</span><strong className="fin-ai">{tickets?tickets.open:'—'}</strong></div>
        <div className="mx-tile"><span className="mx-hud-title mx-muted">SLA VENCIDO</span><strong className={tickets?.late?'fin-loss':''}>{tickets?tickets.late:'—'}</strong></div>
        <div className="mx-tile"><span className="mx-hud-title mx-muted">POR VENCER</span><strong className={tickets?.at_risk?'fin-risk':''}>{tickets?tickets.at_risk:'—'}</strong></div>
        <div className="mx-tile"><span className="mx-hud-title mx-muted">RESUELTOS HOY</span><strong className="fin-income">{tickets?tickets.solved_today:'—'}</strong></div>
       </div>
       <button type="button" className="mx-link" onClick={()=>onNavigate('tickets')}><LifeBuoy size={14} aria-hidden="true"/> Abrir Tickets Vigentes →</button>
      </>}
      {tab==='skills'&&<ul className="mx-skill-list">{marketCatalog.filter(m=>m.category==='skills').map(s=><li key={s.id}>
       <div><strong>{s.name}</strong><span className="mx-muted">{s.tagline} · {s.price?.label||'A cotizar'}</span></div>
       <button type="button" className="mx-btn-ghost is-ai" onClick={()=>activateSkill(s,onNavigate)}><Sparkles size={14} aria-hidden="true"/> Activar</button></li>)}</ul>}
     </div>
    </section>
    {omegaPanel}
   </div>
   <NewsTicker items={news}/>
   {flow.dialog}{flow.toast}
  </div>;
 }

 return <div className="mx-cmd">
  <header className="mx-cmd-head">
   <span className="mx-cmd-mark" aria-hidden="true">Ω</span>
   <div><div className="mx-hud-title mx-cmd-title">OMEGA · CENTRO DE MANDO</div><div className="mx-cmd-sub">{tenantName}</div></div>
   <span className="mx-cmd-spacer"/>
   {motivation&&<LevelChip m={motivation}/>}
   <span className={`mx-cmd-status${stale?' is-stale':''}`}>{live
    ?(published?<>{stale?<AlertTriangle size={14} aria-hidden="true"/>:<CheckCircle2 size={14} aria-hidden="true"/>}Datos al cierre del {published.business_date}{closeAt?` · ${hhmm(closeAt)}`:''}{stale?' · desactualizado':''}</>:'Sin datos publicados todavía')
    :'Datos de demostración · sin conexión a Odoo'}</span>
   <time className="mx-cmd-clock" dateTime={now.toISOString()}>{hhmm(now)}</time>
  </header>

  <div className="mx-cmd-grid">
   <section className="mx-col mx-panel" aria-label="Misiones de hoy">
    <div className="mx-panel-head"><span className="mx-hud-title">MISIONES DE HOY</span><span className="mx-muted">{pending.length?`${pending.length} por resolver`:'Todo resuelto. Excelente día.'}</span></div>
    {missionsPanel}
   </section>

   <section className="mx-reactor-wrap" aria-label="Pulso de la empresa">
    <div className="mx-reactor-stage">
     <ArcReactor value={pulse} delta={ise&&ise.value!=='—'?(ise.deltaLabel||'').slice(0,40).toLowerCase():undefined} tone={pulseTone}/>
     <OrbitNodes nodes={nodes} selected={sel} onSelect={setSel}/>
    </div>
   </section>

   <section className="mx-col" aria-label="Omega">
    {omegaPanel}
    <div className="mx-panel mx-focus" aria-live="polite">
     <span className="mx-hud-title mx-muted">ENFOQUE</span>
     <strong className={`mx-focus-title fin-${focusNode.fin}`}>{focusNode.label} · {focusNode.value}</strong>
     <FocusVisual values={focusSeries} fin={focusNode.fin} kpi={focusKpi[sel]} meta={sel==='meta'}/>
     <p className="mx-focus-text">{focusText}</p>
    </div>
   </section>
  </div>
  <NewsTicker items={news}/>
  {flow.dialog}{flow.toast}
 </div>;
}

function MiniPulse({value,tone}:{value:number|null;tone:string}){
 const r=26,c=2*Math.PI*r,f=value===null?0:Math.max(0,Math.min(100,value))/100;
 return <svg className="mx-mini-pulse" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={value===null?'Pulso pendiente':`Pulso ${value} de 100`}>
  <circle cx="32" cy="32" r={r} className="mx-ring-track"/>
  <circle cx="32" cy="32" r={r} className={`mx-mini-arc fin-${tone}`} strokeDasharray={`${(c*f).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 32 32)"/>
  <text x="32" y="38" textAnchor="middle" className="mx-mini-num">{value===null?'—':value}</text>
 </svg>;
}

/** Enfoque: serie mensual si existe; si no, una lectura visual con el mismo dato del KPI
 *  (cumplimiento contra la meta, o período actual contra su referencia), nunca cifras inventadas. */
function FocusVisual({values,fin,kpi,meta}:{values:number[];fin:string;kpi?:Kpi;meta:boolean}){
 if(values.length>=2)return <Spark values={values} fin={fin}/>;
 const cur=kpi&&kpi.value!=='—'?parseNumber(kpi.value):null;
 if(kpi&&cur!==null&&meta){
  const scale=150,fill=Math.max(0,Math.min(scale,cur))/scale*100;
  return <div className={`mx-gauge fin-${fin}`} role="img" aria-label={`Cumplimiento de ${kpi.value} sobre la meta`}>
   <div className="mx-gauge-track"><span className="mx-gauge-fill" style={{width:`${fill}%`}}/><span className="mx-gauge-mark" style={{left:`${100/scale*100}%`}}/></div>
   <div className="mx-gauge-legend"><span>0%</span><span className="mx-gauge-goal">Meta 100%</span><span>{scale}%</span></div>
  </div>;
 }
 const m=kpi?/([+−-]?\d+(?:[.,]\d+)?)\s*%/.exec(kpi.delta||''):null;
 if(kpi&&cur!==null&&m){
  const p=parseFloat(m[1].replace('−','-').replace(',','.'))/100;
  if(p>-1&&p!==0){
   const prev=cur/(1+p),max=Math.max(Math.abs(cur),Math.abs(prev))||1;
   const ref=/presup/i.test(kpi.deltaLabel)?'Presupuesto':/año|ant/i.test(kpi.deltaLabel)?'Año anterior':'Referencia';
   const fmt=(v:number)=>kpi.value.trim().startsWith('$')||kpi.value.includes('$')?`${v<0?'−':''}$${Math.round(Math.abs(v)).toLocaleString('es-EC')}`:Math.round(v).toLocaleString('es-EC');
   const rows:[string,number,boolean][]=[[ref,prev,false],['Este período',cur,true]];
   return <div className={`mx-compare fin-${fin}`} role="img" aria-label={`${ref}: ${fmt(prev)}. Este período: ${kpi.value} (${kpi.delta})`}>
    {rows.map(([l,v,now])=><div key={l} className={`mx-compare-row${now?' is-now':''}`}>
     <span className="mx-compare-label">{l}</span>
     <span className="mx-compare-track"><span className="mx-compare-fill" style={{width:`${Math.max(4,Math.abs(v)/max*100)}%`}}/></span>
     <strong className="mx-compare-value">{now?kpi.value:fmt(v)}</strong>
    </div>)}
    <span className="mx-compare-delta">{kpi.delta} {kpi.deltaLabel.toLowerCase()}</span>
   </div>;
  }
 }
 return <p className="mx-empty mx-spark-empty">Sin serie mensual publicada para este indicador.</p>;
}

function Spark({values,fin}:{values:number[];fin:string}){
 if(values.length<2)return <p className="mx-empty mx-spark-empty">Sin serie mensual publicada para este indicador.</p>;
 const mn=Math.min(...values),mx=Math.max(...values);const py=(v:number)=>140-(v-mn)/((mx-mn)||1)*120,px=(i:number)=>i*(400/(values.length-1));
 const line=values.map((v,i)=>`${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
 return <svg className={`mx-spark fin-${fin}`} width="100%" height="150" viewBox="0 0 400 150" preserveAspectRatio="none" aria-hidden="true">
  <path d={`M${values.map((v,i)=>`${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(' L')} L400 150 L0 150 Z`} className="mx-spark-area"/>
  <polyline points={line} className="mx-spark-line" vectorEffect="non-scaling-stroke"/>
 </svg>;
}
