import {useEffect,useMemo,useState} from 'react';
import {Clock,Play,Signature,Sparkles,type LucideIcon} from 'lucide-react';
import type {ReportPayload,Widget} from '../../data/api';
import {cachedGet} from '../live/cache';
import {useLive,versionKey} from '../live/LiveData';
import {blocksOf,fmtMoney,kpisOf,pageById,parseNumber,tableRows} from '../omega/data';
import {useDecisions} from '../omega/useDecisions';
import {marketCatalog} from '../market/data';
import {activateSkill} from '../market/activate';
import type {Portal} from '../portals/portals';
import type {PortalItem} from '../portals/PortalPage';
import {useViewHistory} from './useViews';
import ContentRow from './ContentRow';
import PosterCard from './PosterCard';
import {LevelChip} from '../omega/AchievementToast';
import type {Motivation} from '../omega/useMotivation';

// Cartelera (Fase M4): inicio de la gerencia en escritorio, estilo plataforma de series.
// Todo sale de los hooks actuales: titular del briefing (mismo cálculo de Dirección), decisiones
// de useDecisions, historial de este navegador y el catálogo del Market. Nada se rotula "en vivo".
type Info={label:string;question:string;icon:LucideIcon};
type Props={live:boolean;tenantKey:string;userName:string;closeLabel:string;
 rows:{portal:Portal;items:PortalItem[]}[];info:(id:string)=>Info|null;onNavigate:(id:string)=>void;onAsk:(q:string)=>void;motivation?:Pick<Motivation,'xp'|'level'|'streak'>};

const ago=(t:number)=>{const m=Math.round((Date.now()-t)/60000);return m<1?'hace un momento':m<60?`hace ${m} min`:m<1440?`hace ${Math.round(m/60)} h`:`hace ${Math.round(m/1440)} d`;};
const statusTone=(s:PortalItem['status'])=>s==='atencion'?'loss':s==='revisar'?'goal':'brand';
const statusLabel={estable:'Estable',revisar:'Revisar',atencion:'Atención'} as const;


export default function Billboard({live,tenantKey,userName,closeLabel,rows,info,onNavigate,onAsk,motivation}:Props){
 const {tenantId,status}=useLive();const version=versionKey(status);
 const [widgets,setWidgets]=useState<Record<string,Widget>|null>(null);
 useEffect(()=>{if(!live||!tenantId)return;let off=false;
  cachedGet<ReportPayload>(tenantId,'/api/reports/nivel1',version).then(r=>{if(!off)setWidgets(r.widgets);}).catch(()=>{});return()=>{off=true;};},[live,tenantId,version]);
 const src=live?widgets:null;
 const kpis=useMemo(()=>kpisOf('nivel1',src),[src]);
 const by=(l:string)=>kpis.find(k=>k.label===l);
 const cumpl=by('Cumplimiento'),util=by('Utilidad'),ventas=by('Ventas');
 const c=cumpl?parseNumber(cumpl.value):null,u=util?parseNumber(util.value):null;
 const units=useMemo(()=>tableRows('nivel1','nivel1-07',src).filter(r=>r[0]&&!/total/i.test(r[0])),[src]);
 const unitBars=units.map(r=>({n:r[0],v:parseNumber(r[1]||'')})).filter((x):x is {n:string;v:number}=>x.v!==null&&x.v>0);
 const weakest=units.map(r=>({n:r[0],g:parseNumber(r[4]||'')})).filter(x=>x.g!==null).sort((a,b)=>(a.g||0)-(b.g||0))[0];
 const head1=c===null?'Tus cifras del cierre':c>=100?'Vendes por encima de lo previsto,':'Vendes por debajo de lo previsto,';
 const head2=u===null?'en una sola mirada.':u<0?'pero estás perdiendo margen.':'y la operación deja utilidad.';
 const page=pageById('nivel1');
 const minutes=page?Math.max(2,Math.round(blocksOf(page).length*20/60)):3;

 const {decisions}=useDecisions();
 const pending=decisions.filter(d=>d.status==='pendiente');
 const atStake=pending.reduce((s,d)=>s+(d.amount||0),0);
 const synopsis=[weakest?`La unidad más rezagada es ${weakest.n} (${(weakest.g||0)>0?'+':''}${weakest.g}% vs año anterior).`:'',
  ventas&&ventas.value!=='—'?`Ventas del período: ${ventas.value}${ventas.delta?` (${ventas.delta} ${ventas.deltaLabel.toLowerCase()})`:''}.`:'',
  pending.length?`${pending.length} decisiones esperan tu firma${atStake?` por ${fmtMoney(atStake)}`:''}.`:'No hay decisiones pendientes.'].filter(Boolean).join(' ');

 const history=useViewHistory(tenantKey);
 const seen=Object.entries(history).filter(([id])=>id!=='cartelera'&&!id.startsWith('portal-')&&info(id));
 const recent=[...seen].sort((a,b)=>b[1].at-a[1].at).slice(0,10);
 const top=[...seen].sort((a,b)=>b[1].opens-a[1].opens||b[1].at-a[1].at).slice(0,5);
 const skills=marketCatalog.filter(m=>m.category==='skills');
 const max=Math.max(...unitBars.map(b=>b.v),1);

 return <div className="bb">
  <section className="bb-hero" aria-label="Estreno de hoy">
   <div className="bb-hero-art" aria-hidden="true">
    {unitBars.length?<div className="bb-hero-bars">{unitBars.map(b=><span key={b.n} style={{['--h' as string]:`${Math.round(b.v/max*100)}%`}}><i/><small>{b.n}</small></span>)}</div>
     :<span className="bb-hero-omega">Ω</span>}
   </div>
   <div className="bb-hero-text">
    <div className="bb-kicker-row"><span className="mx-hud-title bb-kicker">ESTRENO DE HOY · {closeLabel}</span>{motivation&&<LevelChip m={motivation} compact/>}</div>
    <h1 className="bb-hero-title">{head1} <em className={u!==null&&u<0?'fin-loss':'fin-income'}>{head2}</em></h1>
    <p className="bb-hero-syn">{userName.split(' ')[0]}, {synopsis.charAt(0).toLowerCase()+synopsis.slice(1)}</p>
    <ul className="bb-tags" aria-label="Etiquetas">
     {units.slice(0,4).map(r=><li key={r[0]}>{r[0]}</li>)}
     <li><Clock size={12} aria-hidden="true"/> {minutes} min de lectura</li>
    </ul>
    <div className="bb-hero-cta">
     <button type="button" className="mx-btn-ai bb-play" onClick={()=>onAsk('Dame el resumen narrado del último cierre')}><Play size={16} aria-hidden="true"/>Ver resumen</button>
     <button type="button" className="mx-btn-ghost" onClick={()=>onNavigate('decisiones')}><Signature size={16} aria-hidden="true"/>{pending.length} {pending.length===1?'decisión':'decisiones'}</button>
     <button type="button" className="mx-btn-ghost" onClick={()=>onNavigate('nivel1')}>Abrir el centro de mando</button>
    </div>
    {unitBars.length>0&&<p className="bb-hero-cap">Gráfica: ventas por unidad del último cierre.</p>}
   </div>
  </section>

  <ContentRow title="Continúa revisando" meta="en este navegador" empty="Aún no abriste reportes. Lo que leas aparecerá aquí con tu avance.">
   {recent.map(([id,v])=>{const i=info(id)!;return <PosterCard key={id} title={i.label} sub={`${ago(v.at)} · ${v.progress}% leído`} icon={i.icon} progress={v.progress} onOpen={()=>onNavigate(id)}/>;})}
  </ContentRow>

  <ContentRow title="Decisiones para hoy" meta={pending.length?`${pending.length} pendientes`:undefined} empty="Todo resuelto. Omega te avisará cuando algo necesite tu firma.">
   {pending.slice(0,10).map(d=><PosterCard key={d.id} title={d.title} sub={d.age} icon={Signature} tone={d.kind==='reclamo'?'loss':'goal'}>
    {d.amount?<span className="bb-poster-amount">{fmtMoney(d.amount)}</span>:null}
    <span className="bb-poster-note">{d.recommendation}</span>
    <button type="button" className="bb-btn-brand bb-poster-cta" onClick={()=>onNavigate('decisiones')}>Resolver ahora</button>
   </PosterCard>)}
  </ContentRow>

  <ContentRow title="Lo más visto por ti" meta="sin datos del equipo todavía: solo tus aperturas" empty="Cuando abras reportes, aquí verás tu ranking.">
   {top.map(([id,v],n)=>{const i=info(id)!;return <PosterCard key={id} rank={n+1} title={i.label} sub={`${v.opens} ${v.opens===1?'apertura':'aperturas'}`} icon={i.icon} onOpen={()=>onNavigate(id)}/>;})}
  </ContentRow>

  <ContentRow title="Skills recomendados" meta="del Market">
   {skills.map(s=><PosterCard key={s.id} title={s.name} sub={s.tagline} icon={s.icon} tone="ai">
    <span className="bb-poster-note">{s.price?.label||'A cotizar'} · {s.delivery}</span>
    <button type="button" className="mx-btn-ghost is-ai bb-poster-cta" onClick={()=>activateSkill(s,onNavigate)}><Sparkles size={14} aria-hidden="true"/>Activar</button>
   </PosterCard>)}
  </ContentRow>

  {rows.filter(r=>r.items.length).map(({portal,items})=><ContentRow key={portal.id} title={portal.label} meta={portal.question}>
   {items.map(it=><PosterCard key={it.id} title={it.label} sub={it.question} icon={it.icon} tone={statusTone(it.status)} onOpen={()=>onNavigate(it.id)}>
    <span className={`bb-status tone-${statusTone(it.status)}`}>{statusLabel[it.status]}{it.badge?` · ${it.badge}`:''}</span>
   </PosterCard>)}
  </ContentRow>)}
 </div>;
}
