import {useEffect,useMemo,useState} from 'react';
import {CheckCircle2,AlertTriangle} from 'lucide-react';
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
 const [listening,setListening]=useState(false);

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
    {missions.length?missions.map(d=><MissionCard key={d.id} d={d} onExecute={()=>act(d.id,true)} onDismiss={()=>act(d.id,false)} xp={motivation?{ok:motivation.xpFor('ok'),no:motivation.xpFor('no')}:undefined}/>)
     :<p className="mx-empty">No hay decisiones pendientes. Omega te avisará cuando algo necesite tu firma.</p>}
    <button type="button" className="mx-link" onClick={()=>onNavigate('decisiones')}>Ver toda la bandeja →</button>
   </section>

   <section className="mx-reactor-wrap" aria-label="Pulso de la empresa">
    <div className="mx-reactor-stage">
     <ArcReactor value={pulse} delta={ise&&ise.value!=='—'?(ise.deltaLabel||'').slice(0,40).toLowerCase():undefined} tone={pulse===null?'goal':pulse>=80?'income':pulse>=60?'goal':'loss'}/>
     <OrbitNodes nodes={nodes} selected={sel} onSelect={setSel}/>
    </div>
   </section>

   <section className="mx-col" aria-label="Omega">
    <div className="mx-panel mx-omega">
     <OmegaOrb listening={listening} label={listening?'Te escucho…':'Toca el micrófono o escribe tu pregunta'} onPress={()=>{setListening(false);onAsk('');}}/>
     <p className="mx-omega-msg">{greeting}{first?<> ¿Ejecuto <strong>{first.title}</strong>{first.amount?` (${first.amount.toLocaleString('es-EC',{style:'currency',currency:'USD',maximumFractionDigits:0})})`:''}?</>:' No hay decisiones pendientes.'}</p>
     <div className="mx-omega-actions">
      {first&&<button type="button" className="mx-btn-ai" onClick={()=>act(first.id,true)}>Sí, hazlo</button>}
      <button type="button" className="mx-btn-ghost is-ai" onClick={()=>onAsk('Explícame los números del último cierre')}>Explícame los números</button>
     </div>
    </div>
    <div className="mx-panel mx-focus" aria-live="polite">
     <span className="mx-hud-title mx-muted">ENFOQUE</span>
     <strong className={`mx-focus-title fin-${focusNode.fin}`}>{focusNode.label} · {focusNode.value}</strong>
     <Spark values={focusSeries} fin={focusNode.fin}/>
     <p className="mx-focus-text">{focusText}</p>
    </div>
   </section>
  </div>
  <NewsTicker items={news}/>
  {flow.dialog}{flow.toast}
 </div>;
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
