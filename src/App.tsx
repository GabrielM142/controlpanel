import {useEffect,useMemo,useState,useRef,useCallback,type ComponentType,type ReactNode} from 'react';
import {Activity,ArrowDownToLine,Signature,Palette,Database,FileSpreadsheet,LogOut,Bell,BriefcaseBusiness,ChartNoAxesCombined,ChevronDown,ChevronRight,Clock3,Coins,Command,Gauge,GraduationCap,House,Layers3,LayoutDashboard,LifeBuoy,ListChecks,ListTodo,Maximize2,Menu,Minimize2,Minus,Moon,Package,Play,RefreshCw,Search,Share2,ShieldAlert,ShoppingBag,SlidersHorizontal,Sparkles,Store,StickyNote,Sun,Truck,Users,Volume2,Wand2,Wrench,X,Zap,type LucideIcon} from 'lucide-react';
import reportData from './data/report.json';
import type {Report,ReportPage} from './types';
import {NavigateContext,ReportNodes,blockIds} from './components/Report';
import {LiveProvider,useLive,useReportData,versionKey,WidgetsContext} from './features/live/LiveData';
import {cachedGet} from './features/live/cache';
import DataSourcesView from './features/live/DataSourcesView';
import ThemeView from './features/theme/ThemeView';
import {BrandThemeProvider,useBrandTheme} from './features/theme/useBrandTheme';
import DireccionHero from './features/omega/DireccionHero';
import DecisionsView from './features/omega/DecisionsView';
import AskOmegaView from './features/omega/AskOmegaView';
import {DecisionsProvider,useDecisions} from './features/omega/useDecisions';
import {pageReading} from './features/omega/data';
import {buildReportContext} from './features/omega/reportAI';
import {ReportAssistant} from './features/omega/ReportAssistant';
import {demoTickets} from './features/tickets/TicketsView';
import LoginView from './features/live/LoginView';
import {download} from './data/api';
import {TokensProvider} from './features/tokens/useTokens';
import {TokensChip} from './features/tokens/TokensChip';
import {AIDrawer} from './features/ai/AIDrawer';
import {AlertsDrawer,businessAlerts} from './features/alerts/AlertsDrawer';
import {CommandPalette,type PaletteItem} from './features/palette/CommandPalette';
import TicketsView from './features/tickets/TicketsView';
import TruequeChat from './features/trueque/TruequeChat';
import TruequeList from './features/trueque/TruequeList';
import {TasksProvider} from './features/tasks/useTasks';
import TasksView from './features/tasks/TasksView';
import {NotesProvider} from './features/notes/useNotes';
import NotesView from './features/notes/NotesView';
import {TenantsProvider,useTenants} from './features/tenants/useTenants';
import {TenantSwitcher} from './features/tenants/TenantSwitcher';
import {OnboardingTour,startTour} from './features/tour/OnboardingTour';
import {MoreMenu} from './features/topbar/MoreMenu';
import {ThresholdsProvider,useThresholds} from './features/thresholds/useThresholds';
import ThresholdsView from './features/thresholds/ThresholdsView';
import {MarketAll,MarketOdoo,MarketSkills,MarketAutomations,MarketServices} from './features/market/wrappers';

const report=reportData as Report;
const MONTHS=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const LIVE_FILTERS=new Set(['anio','mes','canal','unidad','marca','categoria','provincia','vendedor']);

type VirtualPage={id:string;group:string;subgroup?:string;label:string;question:string;component:ComponentType;icon:LucideIcon;kicker?:string;paused?:boolean};
const virtualPages:VirtualPage[]=[
 {id:'decisiones',group:'Gestión',label:'Decisiones',question:'¿Qué espera tu decisión hoy?',component:DecisionsView,icon:Signature},
 {id:'omega',group:'Omega',label:'Pregúntale a Omega',question:'Pregunta como hablas: Omega responde con las cifras del último cierre y cita sus fuentes.',component:AskOmegaView,icon:Sparkles},
 {id:'tickets',group:'Soporte',subgroup:'Helpdesk',label:'Tickets Vigentes',question:'¿Cómo va la cola de soporte y qué casos requieren acción inmediata?',component:TicketsView,icon:LifeBuoy},
 {id:'control',group:'Ajustes',label:'Panel de Control',question:'Configura los umbrales de indicadores. Cada umbral dispara alertas en la campana superior y alimenta al copiloto.',component:ThresholdsView,icon:Gauge},
 {id:'tema',group:'Ajustes',label:'Tema de la empresa',question:'¿Cómo se ve OMEGA para tu empresa? Elige tu color de marca; los colores financieros no cambian.',component:ThemeView,icon:Palette},
 {id:'sources',group:'Ajustes',label:'Fuentes de datos',question:'Conexiones Odoo, lotes nocturnos recibidos, corte publicado y errores por fuente.',component:DataSourcesView,icon:Database},
 {id:'market',group:'Market',subgroup:'Catálogo',label:'Todo el catálogo',question:'Catálogo completo de OMEGA — módulos Odoo, skills, automatizaciones y servicios.',component:MarketAll,icon:Store},
 {id:'market-odoo',group:'Market',subgroup:'Catálogo',label:'Módulos Odoo',question:'Extensiones certificadas para tu instancia de Odoo. Precio de referencia o “a cotizar”.',component:MarketOdoo,icon:Package},
 {id:'market-skills',group:'Market',subgroup:'Catálogo',label:'Skills',question:'Paquetes de expertise y consultoría con nuestro equipo especializado.',component:MarketSkills,icon:Sparkles},
 {id:'market-automations',group:'Market',subgroup:'Catálogo',label:'Automatizaciones',question:'Bots, integraciones y flujos automáticos que ahorran horas al mes.',component:MarketAutomations,icon:Zap},
 {id:'market-services',group:'Market',subgroup:'Catálogo',label:'Servicios',question:'Retainers, auditorías y paquetes de acompañamiento continuo.',component:MarketServices,icon:Wrench},
 {id:'tasks',group:'Espacio Personal',label:'Mis Tareas',question:'Mi tablero personal de tareas — el copiloto lo lee y sugiere próximos pasos.',component:TasksView,icon:ListTodo},
 {id:'notes',group:'Espacio Personal',label:'Mis Notas',question:'Anotaciones rápidas vinculadas a las vistas del panel.',component:NotesView,icon:StickyNote},
 {id:'trueque',group:'Factory',label:'Nueva Solicitud',question:'Chatea con Omega IA para describir el módulo que necesitas. Al finalizar lo enviamos al equipo OMEGA.',component:TruequeChat,icon:Wand2},
 {id:'trueque-list',group:'Factory',label:'Mis Solicitudes',question:'Historial de módulos solicitados a OMEGA con su estado actual.',component:TruequeList,icon:ListChecks},
];
const virtualIds=new Set(virtualPages.map(p=>p.id));
const virtualById=new Map(virtualPages.map(p=>[p.id,p]));

const icons:Record<string,LucideIcon>={nivel1:LayoutDashboard,comercial:ChartNoAxesCombined,financiero:Coins,compras:ShoppingBag,inventarios:Package,clientes:Users,logistica:Truck,marketing:Volume2,riesgos:ShieldAlert,mayoristahogar:House,mayoristaintorno:Layers3,retailjuj:Store,retailintorno:BriefcaseBusiness,tickets:LifeBuoy,trueque:Wand2,'trueque-list':ListChecks,tasks:ListTodo,notes:StickyNote,control:Gauge,sources:Database,decisiones:Signature,omega:Sparkles,tema:Palette,market:Store,'market-odoo':Package,'market-skills':Sparkles,'market-automations':Zap,'market-services':Wrench};

// OMEGA navigation (REDISENO_OMEGA.md §4): display grouping only. Every report and auxiliary view keeps
// its id, label and route; nothing is removed. Factory keeps its own block at the bottom.
type NavSub={label:string;ids:string[]};
type NavSection={label:string;subs:NavSub[]};
// Grouped by the question a manager asks (results -> operation -> units -> action -> setup).
// The 13 reports and every auxiliary view stay; only their grouping changes.
const NAV:NavSection[]=[
 {label:'Ejecutivo',subs:[
  {label:'Dirección',ids:['nivel1']},
  {label:'Ventas',ids:['comercial','clientes','marketing']},
  {label:'Finanzas y riesgo',ids:['financiero','riesgos']},
 ]},
 {label:'Operación',subs:[
  {label:'Compras',ids:['compras']},
  {label:'Inventarios',ids:['inventarios']},
  {label:'Logística',ids:['logistica']},
 ]},
 {label:'Unidades',subs:[
  {label:'Mayorista',ids:['mayoristahogar','mayoristaintorno']},
  {label:'Retail',ids:['retailjuj','retailintorno']},
 ]},
 {label:'Gestión',subs:[
  {label:'Decisiones',ids:['decisiones']},
  {label:'Tickets de soporte',ids:['tickets']},
  {label:'Tareas y notas',ids:['tasks','notes']},
 ]},
 {label:'Configuración',subs:[
  {label:'Fuentes de datos',ids:['sources']},
  {label:'Umbrales',ids:['control']},
  {label:'Tema de la empresa',ids:['tema']},
  {label:'Mercado',ids:['market','market-odoo','market-skills','market-automations','market-services']},
 ]},
];
const ROLE_LABEL:Record<string,string>={owner:'Propietario',admin:'Administrador',analyst:'Analista',viewer:'Lectura'};
function locate(id:string):{section:string;sub?:string}{
 if(id==='omega')return {section:'Pregúntale a Omega'};
 for(const sec of NAV)for(const sub of sec.subs)if(sub.ids.includes(id))return {section:sec.label,sub:sub.ids.length>1?sub.label:undefined};
 return {section:'Factory'};
}
const findSub=(id:string,_group?:string)=>locate(id).sub;

const allValidIds=new Set([...report.pages.map(p=>p.id),...virtualPages.map(p=>p.id)]);
const getPage=()=>{const h=location.hash.slice(1);return allValidIds.has(h)?h:'nivel1';};
const ls={get(k:string,f:string){try{return localStorage.getItem(k)??f;}catch{return f;}},set(k:string,v:string){try{localStorage.setItem(k,v);}catch{}}};

function AppShell(){
 const {active:activeTenant}=useTenants();
 const live=useLive();
 const [liveOptions,setLiveOptions]=useState<Record<string,string[]>>({});
 const [pageId,setPageId]=useState(getPage);
 const [filters,setFilters]=useState(Object.fromEntries(Object.entries(report.filters).map(([k,v])=>[k,v.sel])));
 const [notice,setNotice]=useState('');
 const [menuOpen,setMenuOpen]=useState(false);
 // Light/dark is a mode of the company theme (useBrandTheme); the header toggle keeps working.
 const brandTheme=useBrandTheme();
 const theme:'light'|'dark'=brandTheme.theme.mode==='light'?'light':'dark';
 const [isFullscreen,setIsFullscreen]=useState(false);
 const [rulerOn,setRulerOn]=useState(()=>ls.get('nova.ruler','off')==='on');
 const [rulerY,setRulerY]=useState(0);
 const [aiOpen,setAiOpen]=useState(false);
 const [alertsOpen,setAlertsOpen]=useState(false);
 const [paletteOpen,setPaletteOpen]=useState(false);
 const [presentation,setPresentation]=useState(false);
 const [expanded,setExpanded]=useState<Set<string>>(()=>{const all=NAV.map(n=>`sec:${n.label}`);try{const raw=localStorage.getItem('nova.nav');if(raw){const saved=new Set<string>(JSON.parse(raw));if([...saved].some(k=>k.startsWith('sec:')))return saved;}}catch{}return new Set(all);});
 const drawer=useRef<HTMLDialogElement>(null);

 const isVirtual=virtualIds.has(pageId);
 const virtualPage=isVirtual?virtualById.get(pageId)!:null;
 const reportPage=!isVirtual?report.pages.find(p=>p.id===pageId)!:null;

 const pageLabel=virtualPage?virtualPage.label:reportPage!.label;
 const pageQuestion=virtualPage?virtualPage.question:reportPage!.question;
 const pageFilters=virtualPage?[]:reportPage!.filters;
 // Live mode only shows filters the API really applies (others would silently do nothing).
 const shownFilters=live.live?pageFilters.filter(k=>LIVE_FILTERS.has(k)):pageFilters;
 const filterQuery=useMemo(()=>Object.fromEntries(pageFilters.filter(k=>LIVE_FILTERS.has(k)).map(k=>[k,filters[k]])),[pageFilters,filters]);
 const reportState=useReportData(live.live&&reportPage?reportPage.id:null,filterQuery);
 const ids=useMemo(()=>reportPage?blockIds(reportPage.id,reportPage.nodes):new WeakMap<object,string>(),[reportPage]);
 const widgetsValue=useMemo(()=>({live:live.live,loading:reportState.loading,widgets:reportState.data?.widgets||null,ids}),[live.live,reportState,ids]);
 const published=live.status?.published||null;
 const stale=!!published?.business_date&&(Date.now()-new Date(`${published.business_date}T23:59:59`).getTime())>2*86400000;
 // Live without a publication yet: anchor the period to today instead of the demo fixture month.
 const cutDate=published?.business_date||(live.live&&live.status?new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10):null);
 const optionsFor=(key:string)=>{const base=report.filters[key].options;
  // Live: the month list follows the published close (data is deferred to the previous cut, not to the demo fixture).
  if(live.live&&key==='mes'&&cutDate){const n=Number(cutDate.slice(5,7));const y=cutDate.slice(0,4);const months=filters.anio===y?MONTHS.slice(0,n):MONTHS;return [base[0],...months];}
  const extra=liveOptions[key];if(!live.live||!extra)return base;return [base[0],...extra.filter(v=>v!==base[0])];};
 const reportCtx=useMemo(()=>{
  if(!reportPage)return null;
  if(live.live&&(reportState.loading||!reportState.data))return null;
  const cut=live.live?(reportState.data?.published?`Cierre ${reportState.data.published.business_date} · versión ${reportState.data.published.version}`:'Sin datos publicados'):'Datos de demostración (sin conexión a Odoo)';
  const fl=shownFilters.map(k=>({key:k,label:report.filters[k].label,value:filters[k],isDefault:filters[k]===report.filters[k].options[0]}));
  return buildReportContext(reportPage.id,live.live?reportState.data?.widgets||{}:null,fl,cut);
 },[reportPage,live.live,reportState,shownFilters,filters]);
 const touched=useRef(new Set<string>());
 useEffect(()=>{if(!live.live||!cutDate)return;const y=cutDate.slice(0,4);const m=MONTHS[Number(cutDate.slice(5,7))-1];
  setFilters(f=>({...f,...(touched.current.has('anio')?{}:{anio:y}),...(touched.current.has('mes')?{}:{mes:m})}));},[live.live,cutDate]);
 const loc=locate(pageId);
 const currentSub=loc.sub;

 const navigate=useCallback((id:string)=>{if(!allValidIds.has(id))return;location.hash=id;setPageId(id);setMenuOpen(false);window.scrollTo({top:0,behavior:'instant'});},[]);

 useEffect(()=>{const handle=()=>{setPageId(getPage());setMenuOpen(false);};window.addEventListener('hashchange',handle);return()=>window.removeEventListener('hashchange',handle);},[]);
 useEffect(()=>{document.title=`${pageLabel} · OMEGA · ${activeTenant.name}`;},[pageLabel,activeTenant.name]);
 const liveVersion=versionKey(live.status);
 useEffect(()=>{if(!live.live||!live.tenantId){setLiveOptions({});return;}if(liveVersion===null)return;let off=false;cachedGet<Record<string,string[]>>(live.tenantId,'/api/filters',liveVersion).then(o=>{if(!off)setLiveOptions(o);}).catch(()=>{});return()=>{off=true;};},[live.live,live.tenantId,liveVersion]);
 useEffect(()=>{if(menuOpen)drawer.current?.showModal();else drawer.current?.close();},[menuOpen]);
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),6000);return()=>clearTimeout(t);},[notice]);
 useEffect(()=>{const handler=(e:Event)=>setNotice((e as CustomEvent<string>).detail);window.addEventListener('report-notice',handler);return()=>window.removeEventListener('report-notice',handler);},[]);

 useEffect(()=>{setExpanded(prev=>{const next=new Set(prev);next.add(`sec:${loc.section}`);if(currentSub)next.add(`sub:${loc.section}::${currentSub}`);return next;});},[loc.section,currentSub]);
 useEffect(()=>{ls.set('nova.nav',JSON.stringify([...expanded]));},[expanded]);

 useEffect(()=>{ls.set('nova.ruler',rulerOn?'on':'off');},[rulerOn]);
 useEffect(()=>{if(!rulerOn)return;const move=(e:MouseEvent)=>setRulerY(e.clientY);window.addEventListener('mousemove',move);return()=>window.removeEventListener('mousemove',move);},[rulerOn]);

 useEffect(()=>{const onFs=()=>setIsFullscreen(!!document.fullscreenElement);document.addEventListener('fullscreenchange',onFs);return()=>document.removeEventListener('fullscreenchange',onFs);},[]);
 const toggleFullscreen=useCallback(()=>{if(!document.fullscreenElement)document.documentElement.requestFullscreen?.().catch(()=>{});else document.exitFullscreen?.().catch(()=>{});},[]);

 useEffect(()=>{document.documentElement.dataset.presentation=presentation?'on':'off';},[presentation]);

 // Ctrl/Cmd+K opens the command palette.
 useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setPaletteOpen(v=>!v);}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[]);

 const askOmega=useCallback((q:string)=>{try{sessionStorage.setItem('nova.omega.prefill',q);}catch{}navigate('omega');},[navigate]);
 useEffect(()=>{const onKey=(e:KeyboardEvent)=>{const t=e.target as HTMLElement|null;if(t&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))return;if(e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.key==='Escape'){setPresentation(false);return;}
  if(e.key==='d'||e.key==='D'){navigate('decisiones');}else if(e.key==='p'||e.key==='P'){setPresentation(v=>!v);}else if(e.key==='?'){setNotice('Atajos: Ctrl K buscar o preguntar · D decisiones · P presentar al directorio · Esc salir de presentación.');}};
  window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[navigate]);
 const toggleKey=useCallback((k:string)=>{setExpanded(prev=>{const next=new Set(prev);if(next.has(k))next.delete(k);else next.add(k);return next;});},[]);

 const [syncing,setSyncing]=useState(false);
 const [refreshedAt,setRefreshedAt]=useState<number|null>(null);
 const refresh=useCallback(async()=>{
  if(syncing)return;
  setSyncing(true);
  const minVisual=new Promise(r=>setTimeout(r,700)); // visual only: the existing refresh is unchanged
  try{
   if(live.live)await live.refreshStatus();
   await minVisual;
   setRefreshedAt(Date.now());
   setNotice(live.live?'Se consultó la última publicación de NOVA. Los datos se cargan cada noche desde Odoo; este botón no lanza extracciones al ERP.':'Vista de demostración. La conexión a Odoo se realizará en la siguiente etapa.');
  }finally{setSyncing(false);}
 },[live,syncing]);
 const exportCsv=useCallback(async()=>{
  if(!live.tenantId||!reportPage)return;
  const q=new URLSearchParams(Object.entries(filterQuery).filter(([,v])=>v)).toString();
  try{await download(`/api/reports/${reportPage.id}/export.csv?${q}`,live.tenantId,`nova-${reportPage.id}.csv`);}catch(e){setNotice((e as Error).message);}
 },[live.tenantId,reportPage,filterQuery]);

 const shareView=useCallback(async()=>{
  try{await navigator.clipboard.writeText(location.href);setNotice('Enlace copiado al portapapeles. Compartilo con tu equipo.');}
  catch{setNotice('No se pudo copiar el enlace. Copialo desde la barra de direcciones.');}
 },[]);

 const paletteItems=useMemo<PaletteItem[]>(()=>[
  ...report.pages.map(p=>({id:p.id,label:p.label,group:p.group,subgroup:findSub(p.id,p.group),keywords:p.question})),
  ...virtualPages.map(p=>({id:p.id,label:p.label,group:p.group,subgroup:p.subgroup,keywords:p.question})),
 ],[]);

 const {activeAlerts}=useThresholds();
 const criticalAlerts=useMemo(()=>{const dyn=activeAlerts.filter(r=>r.tone==='r').length;const stat=businessAlerts(live.live).filter(a=>a.severity==='r').length;return dyn+stat;},[activeAlerts,live.live]);
 const bellTotal=useMemo(()=>businessAlerts(live.live).length+activeAlerts.length,[activeAlerts,live.live]);

 const {pending:pendingDecisions}=useDecisions();
 const openTickets=live.live?0:demoTickets.filter(t=>t.status!=='resuelto'&&t.status!=='cerrado').length;
 const badgeFor=(id:string)=>id==='decisiones'&&pendingDecisions?<small className="om-badge om-badge--gold">{pendingDecisions}</small>:id==='tickets'&&openTickets?<small className="om-badge om-badge--bad">{openTickets}</small>:null;
 function NavItem({p}:{p:ReportPage|VirtualPage}){const ItemIcon=icons[p.id]||LayoutDashboard;const paused=('paused' in p)&&p.paused;return <button key={p.id} aria-current={p.id===pageId?'page':undefined} onClick={()=>navigate(p.id)}><ItemIcon size={17} strokeWidth={1.7}/><span>{p.label}</span>{paused?<small className="badge-paused">En pausa</small>:badgeFor(p.id)||(p.id===pageId?<ChevronRight size={13}/>:null)}</button>;}

 function Sidebar(){
  const truequePages=virtualPages.filter(p=>p.group==='Factory');
  const byId=(id:string)=>report.pages.find(p=>p.id===id)||virtualById.get(id);
  return <>
   <div className="omega-brand">
    <span className="omega-mark" aria-hidden="true">Ω</span>
    <div><strong>OMEGA</strong><small>La última palabra en tus datos</small></div>
    {brandTheme.theme.logo&&<img className="omega-co-logo" src={brandTheme.theme.logo} alt={`Logo de ${activeTenant.name}`}/>}
   </div>
   <TenantSwitcher/>
   <nav aria-label="Menú principal" className="omega-nav">
    <button type="button" className="omega-ask-nav" aria-current={pageId==='omega'?'page':undefined} onClick={()=>navigate('omega')}><span className="omega-glyph" aria-hidden="true">Ω</span><span>Pregúntale a Omega</span></button>
    {NAV.map(sec=>{
     const secKey=`sec:${sec.label}`;const open=expanded.has(secKey);
     return <div key={sec.label}>
      <div className={`nav-group omega-section ${open?'open':'closed'}${loc.section===sec.label?' is-active':''}`}>
       <button type="button" className="nav-group-header omega-section-head" aria-expanded={open} onClick={()=>toggleKey(secKey)}><span>{sec.label}</span><ChevronDown size={12} className={open?'':'rotate-neg90'}/></button>
       {open&&<div className="nav-group-body">{sec.subs.map(sub=>{
        const pages=sub.ids.map(byId).filter(Boolean) as (ReportPage|VirtualPage)[];
        if(pages.length===1)return <NavItem key={sub.label} p={pages[0]}/>;
        const subKey=`sub:${sec.label}::${sub.label}`;const subOpen=expanded.has(subKey)||sub.ids.includes(pageId);
        return <div className={`nav-sub ${subOpen?'open':'closed'}`} key={sub.label}>
         <button type="button" className="nav-sub-header" aria-expanded={subOpen} onClick={()=>toggleKey(subKey)}><ChevronRight size={11} className={subOpen?'rotate-90':''}/><span>{sub.label}</span></button>
         {subOpen&&pages.map(p=><NavItem key={p.id} p={p}/>)}
        </div>;
       })}</div>}
      </div>
     </div>;
    })}
    <div className="nav-trueque">
     <div className="nav-trueque-head"><Sparkles size={12}/><span>Factory</span></div>
     {truequePages.map(p=><NavItem key={p.id} p={p}/>)}
     <div className="nav-trueque-foot">Módulos a medida para tu ERP</div>
    </div>
   </nav>
   <SidebarFoot/>
  </>;
 }

 function SidebarFoot(){
  return <div className="sidebar-foot nova-foot omega-foot">
   <span className="omega-avatar" aria-hidden="true">{live.live&&live.user?live.user.name.trim().slice(0,2).toUpperCase():activeTenant.monogram}</span>
   <div><strong>{live.live&&live.user?live.user.name:activeTenant.name}</strong><span>{live.live?(ROLE_LABEL[live.membership?.role||'']||''):'Demo · datos de ejemplo'}</span></div>
  </div>;
 }

 return <NavigateContext.Provider value={navigate}>
  <a className="skip-link" href="#main" onClick={e=>{e.preventDefault();document.getElementById("main")?.focus();}}>Ir al reporte</a>
  <div className="app-shell">
   <aside className="sidebar"><Sidebar/></aside>
   <dialog className="mobile-drawer" ref={drawer} onCancel={()=>setMenuOpen(false)} onClick={e=>{if(e.target===drawer.current)setMenuOpen(false);}}>
    <button className="drawer-close" aria-label="Cerrar menú" onClick={()=>setMenuOpen(false)}><X size={20}/></button>
    <Sidebar/>
   </dialog>
   <main id="main" className="workspace" tabIndex={-1}>
    <div className="utility-bar">
     <div className="breadcrumbs">
      <button className="mobile-menu icon-button" aria-label="Abrir menú" onClick={()=>setMenuOpen(true)}><Menu size={21}/></button>
      <span>OMEGA</span>
      {loc.section!==pageLabel&&<><ChevronRight size={12}/><span>{loc.section}</span></>}
      {currentSub&&<><ChevronRight size={12}/><span className="crumb-sub">{currentSub}</span></>}
      <ChevronRight size={12}/><span className="crumb-current">{pageLabel}</span>
     </div>
     <div className="utility-right">
      {live.live
       ?<span className={`odoo-chip hide-mobile ${!published||stale?'is-stale':''}`} title={published?`Versión ${published.version} · consistencia: intervalo capturado (no fotografía exacta a las 00:00)`:'Aún no hay datos publicados'}>
         <span className="odoo-dot"/><b>Cierre</b><em>{published?` ${published.business_date}${stale?' · desactualizado':` · sincronizado ${new Date(Object.values(published.sources)[0]?.observed_to||published.published_at).toLocaleTimeString('es-EC',{hour:'2-digit',minute:'2-digit'})}`}`:' sin publicación'}</em>
        </span>
       :<span className="odoo-chip hide-mobile is-demo" title="Datos de ejemplo · Odoo pendiente de conexión">
         <span className="odoo-dot"/><b>Demo</b><em>· datos de ejemplo</em>
        </span>}
      <TokensChip/>
      <button type="button" className="icon-button bell" aria-label={`${criticalAlerts>0?`${criticalAlerts} `:''}Alertas: ${bellTotal} en total`} title="Alertas del negocio y umbrales configurados" onClick={()=>setAlertsOpen(true)}>
       <Bell size={17}/>
       {criticalAlerts>0&&<span className="bell-badge">{criticalAlerts}</span>}
      </button>
      <button type="button" className="omega-ask hide-mobile" onClick={()=>setPaletteOpen(true)} aria-label="Pregúntale a Omega o busca una vista (Ctrl+K)">
       <span className="omega-glyph" aria-hidden="true">Ω</span>
       <span className="omega-ask-text">Pregúntale a Omega o busca una vista</span>
       <kbd>Ctrl K</kbd>
      </button>
      <button type="button" className="icon-button omega-tucked" aria-label="Compartir esta vista" title="Compartir enlace de esta vista" onClick={shareView}>
       <Share2 size={15}/>
      </button>
      <button type="button" className="icon-button omega-tucked" aria-label="Iniciar tour de bienvenida" title="Repetir tour de bienvenida" onClick={()=>startTour()}>
       <GraduationCap size={16}/>
      </button>
      <div className="tool-buttons omega-tucked" role="group" aria-label="Herramientas de lectura">
       <button type="button" className={`tool-button ${rulerOn?'on':''}`} aria-pressed={rulerOn} aria-label="Regla de lectura" title="Regla de lectura" onClick={()=>setRulerOn(v=>!v)}><Minus size={16}/></button>
       <button type="button" className={`tool-button ${presentation?'on':''}`} aria-pressed={presentation} aria-label="Modo presentación" title="Modo presentación (oculta filtros y bordes)" onClick={()=>setPresentation(v=>!v)}><Play size={14}/></button>
       <button type="button" className="tool-button" aria-label={theme==='dark'?'Modo claro':'Modo oscuro'} title={theme==='dark'?'Modo claro':'Modo oscuro'} onClick={()=>brandTheme.toggleMode()}>{theme==='dark'?<Sun size={16}/>:<Moon size={16}/>}</button>
       <button type="button" className="tool-button" aria-label={isFullscreen?'Salir de pantalla completa':'Pantalla completa'} title={isFullscreen?'Salir de pantalla completa':'Pantalla completa'} onClick={toggleFullscreen}>{isFullscreen?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button>
      </div>
      <MoreMenu className="omega-more" items={[
       {icon:Search,label:'Buscar vista',shortcut:'Ctrl+K',onClick:()=>setPaletteOpen(true)},
       {icon:Share2,label:'Compartir esta vista',onClick:shareView},
       {icon:GraduationCap,label:'Repetir tour',onClick:()=>startTour()},
       {icon:Minus,label:'Regla de lectura',active:rulerOn,onClick:()=>setRulerOn(v=>!v)},
       {icon:Play,label:'Modo presentación',active:presentation,onClick:()=>setPresentation(v=>!v)},
       {icon:theme==='dark'?Sun:Moon,label:theme==='dark'?'Modo claro':'Modo oscuro',onClick:()=>brandTheme.toggleMode()},
       {icon:isFullscreen?Minimize2:Maximize2,label:isFullscreen?'Salir de pantalla completa':'Pantalla completa',onClick:toggleFullscreen},
      ]}/>
      <button type="button" className="omega-present hide-mobile" aria-pressed={presentation} onClick={()=>setPresentation(v=>!v)}><Play size={14}/>{presentation?'Salir de presentación':'Presentar al directorio'}</button>
      {live.user?<button type="button" className="avatar hide-mobile-small" title={`${live.user.name} · cerrar sesión`} aria-label="Cerrar sesión" onClick={()=>live.logout()}>{live.user.name.slice(0,2).toUpperCase()}<LogOut size={10}/></button>:<span className="avatar hide-mobile-small">JUJ</span>}
     </div>
    </div>
    <header className="page-header">
     <div className="page-heading">
      <div className="page-kicker"><span className="gold-line"/>{loc.section}{currentSub?` · ${currentSub}`:''}</div>
      <h1>{pageLabel}</h1>
      <p>{pageQuestion}</p>
     </div>
     <div className="header-actions">
      {(syncing||refreshedAt)&&<div className="om-sync-chip" role="status">{syncing?<><RefreshCw size={12} className="om-spin" aria-hidden="true"/>Consultando la última publicación…</>:<><span className="odoo-dot om-dot-income" aria-hidden="true" style={{width:7,height:7,borderRadius:999,display:'inline-block'}}/>Actualizado hace un momento</>}</div>}
      <div className="updated-time"><Clock3 size={13}/><span>{live.live
       ?(published?`Corte de negocio ${published.business_date} · capturado ${new Date(Object.values(published.sources)[0]?.observed_to||published.published_at).toLocaleString('es-EC',{dateStyle:'short',timeStyle:'short'})} · publicado ${new Date(published.published_at).toLocaleString('es-EC',{dateStyle:'short',timeStyle:'short'})}`:'Sin datos publicados todavía')
       :'Datos de demostración · sin conexión a Odoo'}</span></div>
      <div className="action-buttons">
       <button className="button secondary" onClick={()=>window.print()}><ArrowDownToLine size={15}/>Exportar</button>
       {live.live&&reportPage&&<button className="button secondary" onClick={exportCsv}><FileSpreadsheet size={15}/>CSV</button>}
       <button className="button primary" onClick={refresh} aria-busy={syncing} disabled={syncing}><RefreshCw size={14} className={syncing?'om-spin':''}/>{syncing?'Consultando…':'Actualizar'}</button>
      </div>
     </div>
    </header>
    {shownFilters.length>0&&<section className="filters" aria-label="Filtros del reporte">
     <div className="filter-label"><SlidersHorizontal size={14}/><span>Filtros</span></div>
     <div className="filter-controls">{shownFilters.map(key=><label className="filter" key={key}><span>{report.filters[key].label}</span><select aria-label={report.filters[key].label} value={filters[key]} onChange={e=>{touched.current.add(key);setFilters({...filters,[key]:e.target.value});}}>{optionsFor(key).map(o=><option key={o}>{o}</option>)}</select></label>)}</div>
    </section>}
    <div className={`report-content${syncing||(live.live&&reportState.loading)?' is-syncing':''}`} key={pageId}>
     {live.live&&reportPage&&reportState.error&&<p className="legend-note" role="alert">No se pudo cargar el reporte: {reportState.error}. Se mantiene el último corte publicado en el servidor.</p>}
     {live.live&&reportPage&&!reportState.loading&&reportState.data&&!reportState.data.published&&<p className="legend-note">Aún no hay datos publicados para esta empresa. Configura la fuente en <b>Configuración · Fuentes de datos</b>.</p>}
     {reportPage&&reportPage.id==='nivel1'&&<DireccionHero widgets={reportState.data?.widgets||null} live={live.live} onNavigate={navigate} onAsk={askOmega}/>}
     {reportPage&&reportPage.id!=='nivel1'&&<section className="om-lead" aria-label="Lectura de Omega">
      <span className="omega-glyph" aria-hidden="true">Ω</span>
      <div><span className="om-eyebrow">Lectura de Omega</span><p>{live.live&&reportState.loading?'Leyendo el último cierre…':pageReading(reportPage.id,live.live?reportState.data?.widgets||null:null)}</p></div>
      <button type="button" className="om-btn om-btn--ai" onClick={()=>askOmega(`¿Qué está pasando en ${reportPage.label}?`)}>Preguntar a Omega</button>
     </section>}
     {reportPage&&(reportCtx?<ReportAssistant key={reportPage.id} ctx={reportCtx} tenant={live.tenantId} onOpenChat={()=>setAiOpen(true)} onNavigate={navigate}/>:live.live&&<section className="om-card om-rassist" aria-busy="true"><span className="om-thinking"><span className="om-d1"/><span className="om-d2"/><span className="om-d3"/>Preparando a Omega con el último cierre…</span></section>)}
     {reportPage&&reportPage.id==='nivel1'&&<h2 className="section-label om-detail-label"><span>Detalle del reporte</span><i/></h2>}
     {virtualPage?(()=>{const C=virtualPage.component;return <C/>;})():<WidgetsContext.Provider value={widgetsValue}><ReportNodes nodes={reportPage!.nodes}/></WidgetsContext.Provider>}
     <div className="report-footer"><span>Análisis <i>/</i> {pageLabel}</span><span>{live.live?`${live.membership?.name||''} · Control Empresarial`:`${activeTenant.subtitle} · Control Empresarial`}</span></div>
    </div>
   </main>
  </div>
  {presentation&&<button type="button" className="om-present-exit" onClick={()=>setPresentation(false)}>Salir de presentación · Esc</button>}
  {rulerOn&&<div className="reading-ruler" aria-hidden="true" style={{top:rulerY}}/>}
  {!aiOpen&&<button type="button" className="ai-bubble" onClick={()=>setAiOpen(true)} aria-label="Pregúntale a Omega sobre esta vista" title="Pregúntale a Omega">
   <span className="ai-bubble-glow" aria-hidden="true"/>
   <span className="omega-glyph" aria-hidden="true">Ω</span>
   <span className="ai-bubble-label">Omega</span>
  </button>}
  <AIDrawer open={aiOpen} onClose={()=>setAiOpen(false)} pageId={pageId} pageLabel={pageLabel} ctx={reportCtx} tenant={live.tenantId}/>
  <AlertsDrawer open={alertsOpen} onClose={()=>setAlertsOpen(false)} onNavigate={navigate}/>
  <CommandPalette open={paletteOpen} onClose={()=>setPaletteOpen(false)} items={paletteItems} onSelect={navigate}/>
  {(aiOpen||alertsOpen)&&<div className="drawer-scrim" onClick={()=>{setAiOpen(false);setAlertsOpen(false);}}/>}
  {notice&&<div className="toast" role="status"><Activity size={18}/><span>{notice}</span><button aria-label="Cerrar aviso" onClick={()=>setNotice('')}><X size={16}/></button></div>}
 </NavigateContext.Provider>;
}

// Re-applies the company theme whenever the active company changes (TenantSwitcher).
function BrandFromTenant({children}:{children:ReactNode}){const {active}=useTenants();return <BrandThemeProvider tenantId={active.id||'demo'}>{children}</BrandThemeProvider>;}

function Gate(){
 const live=useLive();
 if(live.live&&live.loading)return <main className="login-shell"><p className="legend-note">Cargando sesión…</p></main>;
 if(live.live&&!live.user)return <LoginView/>;
 return <TenantsProvider><BrandFromTenant><ThresholdsProvider><DecisionsProvider><TokensProvider><TasksProvider><NotesProvider><AppShell/><OnboardingTour/></NotesProvider></TasksProvider></TokensProvider></DecisionsProvider></ThresholdsProvider></BrandFromTenant></TenantsProvider>;
}

export default function App(){return <LiveProvider><Gate/></LiveProvider>;}
