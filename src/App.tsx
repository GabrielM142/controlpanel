import {useEffect,useMemo,useState,useRef,useCallback,type ComponentType} from 'react';
import {Activity,ArrowDownToLine,Bell,BriefcaseBusiness,ChartNoAxesCombined,ChevronDown,ChevronRight,Clock3,Coins,GraduationCap,House,Layers3,LayoutDashboard,LifeBuoy,ListChecks,ListTodo,Maximize2,Menu,Minimize2,Minus,Moon,Package,Play,RefreshCw,Search,Share2,ShieldAlert,ShoppingBag,SlidersHorizontal,Sparkles,Store,StickyNote,Sun,Truck,Users,Volume2,Wand2,X,type LucideIcon} from 'lucide-react';
import reportData from './data/report.json';
import type {Report,ReportPage} from './types';
import {NavigateContext,ReportNodes} from './components/Report';
import {TokensProvider} from './features/tokens/useTokens';
import {TokensChip} from './features/tokens/TokensChip';
import {AIDrawer} from './features/ai/AIDrawer';
import {AlertsDrawer,globalAlerts} from './features/alerts/AlertsDrawer';
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

const report=reportData as Report;

type VirtualPage={id:string;group:string;subgroup?:string;label:string;question:string;component:ComponentType;icon:LucideIcon;kicker?:string;paused?:boolean};
const virtualPages:VirtualPage[]=[
 {id:'tickets',group:'Soporte',subgroup:'Helpdesk',label:'Tickets Vigentes',question:'¿Cómo va la cola de soporte y qué casos requieren acción inmediata?',component:TicketsView,icon:LifeBuoy},
 {id:'tasks',group:'Espacio Personal',label:'Mis Tareas',question:'Mi tablero personal de tareas — el copiloto lo lee y sugiere próximos pasos.',component:TasksView,icon:ListTodo},
 {id:'notes',group:'Espacio Personal',label:'Mis Notas',question:'Anotaciones rápidas vinculadas a las vistas del panel.',component:NotesView,icon:StickyNote},
 {id:'trueque',group:'Factory',label:'Nueva Solicitud',question:'Chateá con Nova IA para describir el módulo que necesitás. Al finalizar lo enviamos al equipo Nova Business.',component:TruequeChat,icon:Wand2},
 {id:'trueque-list',group:'Factory',label:'Mis Solicitudes',question:'Historial de módulos solicitados a Nova Business con su estado actual.',component:TruequeList,icon:ListChecks},
];
const virtualIds=new Set(virtualPages.map(p=>p.id));
const virtualById=new Map(virtualPages.map(p=>[p.id,p]));

const icons:Record<string,LucideIcon>={nivel1:LayoutDashboard,comercial:ChartNoAxesCombined,financiero:Coins,compras:ShoppingBag,inventarios:Package,clientes:Users,logistica:Truck,marketing:Volume2,riesgos:ShieldAlert,mayoristahogar:House,mayoristaintorno:Layers3,retailjuj:Store,retailintorno:BriefcaseBusiness,tickets:LifeBuoy,trueque:Wand2,'trueque-list':ListChecks,tasks:ListTodo,notes:StickyNote};

// Sidebar taxonomy. Soporte and Espacio Personal join the main groups; Factory is a dedicated bottom block.
const groupOrder=['Ejecutivo','Centros de Inteligencia','Unidades de Negocio','Soporte','Espacio Personal'] as const;
const subGroups:Record<string,{label:string;ids:string[]}[]>={
 'Centros de Inteligencia':[
  {label:'Mercado',ids:['comercial','clientes','marketing']},
  {label:'Operaciones',ids:['compras','inventarios','logistica']},
  {label:'Finanzas & Riesgo',ids:['financiero','riesgos']},
 ],
 'Unidades de Negocio':[
  {label:'Mayorista',ids:['mayoristahogar','mayoristaintorno']},
  {label:'Retail',ids:['retailjuj','retailintorno']},
 ],
 'Soporte':[
  {label:'Helpdesk',ids:['tickets']},
 ],
};

const allValidIds=new Set([...report.pages.map(p=>p.id),...virtualPages.map(p=>p.id)]);
const getPage=()=>{const h=location.hash.slice(1);return allValidIds.has(h)?h:'nivel1';};
const findSub=(id:string,group:string)=>subGroups[group]?.find(sg=>sg.ids.includes(id))?.label;
const ls={get(k:string,f:string){try{return localStorage.getItem(k)??f;}catch{return f;}},set(k:string,v:string){try{localStorage.setItem(k,v);}catch{}}};

function AppShell(){
 const {active:activeTenant}=useTenants();
 const [pageId,setPageId]=useState(getPage);
 const [filters,setFilters]=useState(Object.fromEntries(Object.entries(report.filters).map(([k,v])=>[k,v.sel])));
 const [notice,setNotice]=useState('');
 const [menuOpen,setMenuOpen]=useState(false);
 const [theme,setTheme]=useState<'light'|'dark'>(()=>ls.get('nova.theme','light')==='dark'?'dark':'light');
 const [isFullscreen,setIsFullscreen]=useState(false);
 const [rulerOn,setRulerOn]=useState(()=>ls.get('nova.ruler','off')==='on');
 const [rulerY,setRulerY]=useState(0);
 const [aiOpen,setAiOpen]=useState(false);
 const [alertsOpen,setAlertsOpen]=useState(false);
 const [paletteOpen,setPaletteOpen]=useState(false);
 const [presentation,setPresentation]=useState(false);
 const [expanded,setExpanded]=useState<Set<string>>(()=>{try{const raw=localStorage.getItem('nova.nav');if(raw)return new Set(JSON.parse(raw));}catch{}return new Set(groupOrder.map(g=>`g:${g}`));});
 const drawer=useRef<HTMLDialogElement>(null);

 const isVirtual=virtualIds.has(pageId);
 const virtualPage=isVirtual?virtualById.get(pageId)!:null;
 const reportPage=!isVirtual?report.pages.find(p=>p.id===pageId)!:null;

 const pageGroup=virtualPage?virtualPage.group:reportPage!.group;
 const pageLabel=virtualPage?virtualPage.label:reportPage!.label;
 const pageQuestion=virtualPage?virtualPage.question:reportPage!.question;
 const pageFilters=virtualPage?[]:reportPage!.filters;
 const currentSub=virtualPage?virtualPage.subgroup:findSub(pageId,pageGroup);

 const navigate=useCallback((id:string)=>{if(!allValidIds.has(id))return;location.hash=id;setPageId(id);setMenuOpen(false);window.scrollTo({top:0,behavior:'instant'});},[]);

 useEffect(()=>{const handle=()=>{setPageId(getPage());setMenuOpen(false);};window.addEventListener('hashchange',handle);return()=>window.removeEventListener('hashchange',handle);},[]);
 useEffect(()=>{document.title=`${pageLabel} · Panel Analítico · ${activeTenant.name}`;},[pageLabel,activeTenant.name]);
 useEffect(()=>{if(menuOpen)drawer.current?.showModal();else drawer.current?.close();},[menuOpen]);
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),6000);return()=>clearTimeout(t);},[notice]);
 useEffect(()=>{const handler=(e:Event)=>setNotice((e as CustomEvent<string>).detail);window.addEventListener('report-notice',handler);return()=>window.removeEventListener('report-notice',handler);},[]);

 useEffect(()=>{setExpanded(prev=>{const next=new Set(prev);next.add(`g:${pageGroup}`);if(currentSub)next.add(`s:${pageGroup}::${currentSub}`);return next;});},[pageGroup,currentSub]);
 useEffect(()=>{ls.set('nova.nav',JSON.stringify([...expanded]));},[expanded]);

 useEffect(()=>{document.documentElement.dataset.theme=theme;ls.set('nova.theme',theme);},[theme]);
 useEffect(()=>{ls.set('nova.ruler',rulerOn?'on':'off');},[rulerOn]);
 useEffect(()=>{if(!rulerOn)return;const move=(e:MouseEvent)=>setRulerY(e.clientY);window.addEventListener('mousemove',move);return()=>window.removeEventListener('mousemove',move);},[rulerOn]);

 useEffect(()=>{const onFs=()=>setIsFullscreen(!!document.fullscreenElement);document.addEventListener('fullscreenchange',onFs);return()=>document.removeEventListener('fullscreenchange',onFs);},[]);
 const toggleFullscreen=useCallback(()=>{if(!document.fullscreenElement)document.documentElement.requestFullscreen?.().catch(()=>{});else document.exitFullscreen?.().catch(()=>{});},[]);

 useEffect(()=>{document.documentElement.dataset.presentation=presentation?'on':'off';},[presentation]);

 // Ctrl/Cmd+K opens the command palette.
 useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setPaletteOpen(v=>!v);}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[]);

 const toggleKey=useCallback((k:string)=>{setExpanded(prev=>{const next=new Set(prev);if(next.has(k))next.delete(k);else next.add(k);return next;});},[]);

 const shareView=useCallback(async()=>{
  try{await navigator.clipboard.writeText(location.href);setNotice('Enlace copiado al portapapeles. Compartilo con tu equipo.');}
  catch{setNotice('No se pudo copiar el enlace. Copialo desde la barra de direcciones.');}
 },[]);

 const paletteItems=useMemo<PaletteItem[]>(()=>[
  ...report.pages.map(p=>({id:p.id,label:p.label,group:p.group,subgroup:findSub(p.id,p.group),keywords:p.question})),
  ...virtualPages.map(p=>({id:p.id,label:p.label,group:p.group,subgroup:p.subgroup,keywords:p.question})),
 ],[]);

 const criticalAlerts=globalAlerts.filter(a=>a.severity==='r').length;

 function NavItem({p}:{p:ReportPage|VirtualPage}){const ItemIcon=icons[p.id]||LayoutDashboard;const paused=('paused' in p)&&p.paused;return <button key={p.id} aria-current={p.id===pageId?'page':undefined} onClick={()=>navigate(p.id)}><ItemIcon size={17} strokeWidth={1.65}/><span>{p.label}</span>{paused?<small className="badge-paused">En pausa</small>:p.id===pageId?<ChevronRight size={13}/>:null}</button>;}

 function Sidebar(){
  const truequePages=virtualPages.filter(p=>p.group==='Factory');
  return <>
   <TenantSwitcher/>
   <div className="brand-rule"/>
   <nav aria-label="Centros de inteligencia">{groupOrder.map(group=>{
    const gKey=`g:${group}`;const gOpen=expanded.has(gKey);const subs=subGroups[group];
    const rp=report.pages.filter(p=>p.group===group);
    const vp=virtualPages.filter(p=>p.group===group);
    const groupPages=[...rp,...vp];
    return <div className={`nav-group ${gOpen?'open':'closed'}`} key={group}>
     <button type="button" className="nav-group-header" aria-expanded={gOpen} onClick={()=>toggleKey(gKey)}><span>{group}</span><ChevronDown size={12} className={gOpen?'':'rotate-neg90'}/></button>
     {gOpen&&<div className="nav-group-body">{subs
      ?<>{subs.map(sg=>{
        const sKey=`s:${group}::${sg.label}`;const sOpen=expanded.has(sKey);
        const sgPages=sg.ids.map(id=>groupPages.find(p=>p.id===id)).filter(Boolean) as (ReportPage|VirtualPage)[];
        return <div className={`nav-sub ${sOpen?'open':'closed'}`} key={sg.label}>
         <button type="button" className="nav-sub-header" aria-expanded={sOpen} onClick={()=>toggleKey(sKey)}><ChevronRight size={11} className={sOpen?'rotate-90':''}/><span>{sg.label}</span></button>
         {sOpen&&sgPages.map(p=><NavItem key={p.id} p={p}/>)}
        </div>;
       })}
       {groupPages.filter(p=>!subs.some(sg=>sg.ids.includes(p.id))).map(p=><NavItem key={p.id} p={p}/>)}
      </>
      :groupPages.map(p=><NavItem key={p.id} p={p}/>)}
     </div>}
    </div>;
   })}
   <div className="nav-trueque">
    <div className="nav-trueque-head"><Sparkles size={12}/><span>Factory</span></div>
    {truequePages.map(p=><NavItem key={p.id} p={p}/>)}
    <div className="nav-trueque-foot">Powered by <b>Nova Business</b> · factoría de módulos a medida</div>
   </div>
   </nav>
   <SidebarFoot/>
  </>;
 }

 function SidebarFoot(){
  return <div className="sidebar-foot nova-foot">
   <div className="nova-mark" aria-hidden="true"><Sparkles size={14}/></div>
   <div><strong>Nova Business</strong><span>Dashboard · Soporte · Factory</span></div>
   <span className="foot-dot"/>
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
      <span>CONTROLPANEL</span>
      <ChevronRight size={12}/><span>{pageGroup}</span>
      {currentSub&&<><ChevronRight size={12}/><span className="crumb-sub">{currentSub}</span></>}
      <ChevronRight size={12}/><span className="crumb-current">{pageLabel}</span>
     </div>
     <div className="utility-right">
      <span className="odoo-chip hide-mobile" title="Datos de ejemplo · Odoo pendiente de conexión">
       <span className="odoo-dot"/><b>Odoo</b><em>· sync 07:58</em>
      </span>
      <TokensChip/>
      <button type="button" className="icon-button bell" aria-label={`Alertas (${globalAlerts.length})`} title="Alertas del negocio" onClick={()=>setAlertsOpen(true)}>
       <Bell size={17}/>
       {criticalAlerts>0&&<span className="bell-badge">{criticalAlerts}</span>}
      </button>
      <button type="button" className="icon-button hide-mobile" aria-label="Búsqueda rápida (Ctrl+K)" title="Búsqueda rápida (Ctrl+K)" onClick={()=>setPaletteOpen(true)}>
       <Search size={16}/>
      </button>
      <button type="button" className="icon-button hide-mobile" aria-label="Compartir esta vista" title="Compartir enlace de esta vista" onClick={shareView}>
       <Share2 size={15}/>
      </button>
      <button type="button" className="icon-button hide-mobile" aria-label="Iniciar tour de bienvenida" title="Repetir tour de bienvenida" onClick={()=>startTour()}>
       <GraduationCap size={16}/>
      </button>
      <div className="tool-buttons hide-mobile" role="group" aria-label="Herramientas de lectura">
       <button type="button" className={`tool-button ${rulerOn?'on':''}`} aria-pressed={rulerOn} aria-label="Regla de lectura" title="Regla de lectura" onClick={()=>setRulerOn(v=>!v)}><Minus size={16}/></button>
       <button type="button" className={`tool-button ${presentation?'on':''}`} aria-pressed={presentation} aria-label="Modo presentación" title="Modo presentación (oculta filtros y bordes)" onClick={()=>setPresentation(v=>!v)}><Play size={14}/></button>
       <button type="button" className="tool-button" aria-label={theme==='dark'?'Modo claro':'Modo oscuro'} title={theme==='dark'?'Modo claro':'Modo oscuro'} onClick={()=>setTheme(t=>t==='dark'?'light':'dark')}>{theme==='dark'?<Sun size={16}/>:<Moon size={16}/>}</button>
       <button type="button" className="tool-button" aria-label={isFullscreen?'Salir de pantalla completa':'Pantalla completa'} title={isFullscreen?'Salir de pantalla completa':'Pantalla completa'} onClick={toggleFullscreen}>{isFullscreen?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button>
      </div>
      <MoreMenu className="show-mobile" items={[
       {icon:Search,label:'Buscar vista',shortcut:'Ctrl+K',onClick:()=>setPaletteOpen(true)},
       {icon:Share2,label:'Compartir esta vista',onClick:shareView},
       {icon:GraduationCap,label:'Repetir tour',onClick:()=>startTour()},
       {icon:Minus,label:'Regla de lectura',active:rulerOn,onClick:()=>setRulerOn(v=>!v)},
       {icon:Play,label:'Modo presentación',active:presentation,onClick:()=>setPresentation(v=>!v)},
       {icon:theme==='dark'?Sun:Moon,label:theme==='dark'?'Modo claro':'Modo oscuro',onClick:()=>setTheme(t=>t==='dark'?'light':'dark')},
       {icon:isFullscreen?Minimize2:Maximize2,label:isFullscreen?'Salir de pantalla completa':'Pantalla completa',onClick:toggleFullscreen},
      ]}/>
      <span className="avatar hide-mobile-small">JUJ</span>
     </div>
    </div>
    <header className="page-header">
     <div className="page-heading">
      <div className="page-kicker"><span className="gold-line"/>{pageGroup}{currentSub?` · ${currentSub}`:''}</div>
      <h1>{pageLabel}</h1>
      <p>{pageQuestion}</p>
     </div>
     <div className="header-actions">
      <div className="updated-time"><Clock3 size={13}/><span>Última actualización: hoy 07:58</span></div>
      <div className="action-buttons">
       <button className="button secondary" onClick={()=>window.print()}><ArrowDownToLine size={15}/>Exportar</button>
       <button className="button primary" onClick={()=>setNotice('Vista de demostración. La conexión a Odoo se realizará en la siguiente etapa.')}><RefreshCw size={14}/>Actualizar</button>
      </div>
     </div>
    </header>
    {pageFilters.length>0&&<section className="filters" aria-label="Filtros del reporte">
     <div className="filter-label"><SlidersHorizontal size={14}/><span>Filtros</span></div>
     <div className="filter-controls">{pageFilters.map(key=><label className="filter" key={key}><span>{report.filters[key].label}</span><select aria-label={report.filters[key].label} value={filters[key]} onChange={e=>setFilters({...filters,[key]:e.target.value})}>{report.filters[key].options.map(o=><option key={o}>{o}</option>)}</select></label>)}</div>
    </section>}
    <div className="report-content" key={pageId}>
     {virtualPage?(()=>{const C=virtualPage.component;return <C/>;})():<ReportNodes nodes={reportPage!.nodes}/>}
     <div className="report-footer"><span>Análisis <i>/</i> {pageLabel}</span><span>José Ugalde Jerves · Control Empresarial</span></div>
    </div>
   </main>
  </div>
  {rulerOn&&<div className="reading-ruler" aria-hidden="true" style={{top:rulerY}}/>}
  {!aiOpen&&<button type="button" className="ai-bubble" onClick={()=>setAiOpen(true)} aria-label="Abrir copiloto de análisis con IA" title="Interpretar la pantalla con IA">
   <span className="ai-bubble-glow" aria-hidden="true"/>
   <Sparkles size={20}/>
   <span className="ai-bubble-label">Copiloto</span>
  </button>}
  <AIDrawer open={aiOpen} onClose={()=>setAiOpen(false)} pageId={pageId} pageLabel={pageLabel}/>
  <AlertsDrawer open={alertsOpen} onClose={()=>setAlertsOpen(false)} onNavigate={navigate}/>
  <CommandPalette open={paletteOpen} onClose={()=>setPaletteOpen(false)} items={paletteItems} onSelect={navigate}/>
  {(aiOpen||alertsOpen)&&<div className="drawer-scrim" onClick={()=>{setAiOpen(false);setAlertsOpen(false);}}/>}
  {notice&&<div className="toast" role="status"><Activity size={18}/><span>{notice}</span><button aria-label="Cerrar aviso" onClick={()=>setNotice('')}><X size={16}/></button></div>}
 </NavigateContext.Provider>;
}

export default function App(){return <TenantsProvider><TokensProvider><TasksProvider><NotesProvider><AppShell/><OnboardingTour/></NotesProvider></TasksProvider></TokensProvider></TenantsProvider>;}
