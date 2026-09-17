import {useEffect,useState,useRef,useCallback} from 'react';
import {Activity,ArrowDownToLine,BriefcaseBusiness,ChartNoAxesCombined,ChevronDown,ChevronRight,Clock3,Coins,House,Layers3,LayoutDashboard,Maximize2,Menu,Minimize2,Minus,Moon,Package,RefreshCw,ShieldAlert,ShoppingBag,SlidersHorizontal,Store,Sun,Truck,Users,Volume2,X,type LucideIcon} from 'lucide-react';
import reportData from './data/report.json';
import type {Report,ReportPage} from './types';
import {NavigateContext,ReportNodes} from './components/Report';

const report=reportData as Report;
const icons:Record<string,LucideIcon>={nivel1:LayoutDashboard,comercial:ChartNoAxesCombined,financiero:Coins,compras:ShoppingBag,inventarios:Package,clientes:Users,logistica:Truck,marketing:Volume2,riesgos:ShieldAlert,mayoristahogar:House,mayoristaintorno:Layers3,retailjuj:Store,retailintorno:BriefcaseBusiness};

// Sidebar taxonomy: which pages nest under which subgroup, per top-level group.
const groupOrder=['Ejecutivo','Centros de Inteligencia','Unidades de Negocio'] as const;
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
};

const getPage=()=>report.pages.some(p=>p.id===location.hash.slice(1))?location.hash.slice(1):'nivel1';
const findSub=(id:string,group:string)=>subGroups[group]?.find(sg=>sg.ids.includes(id))?.label;
const ls={get(k:string,f:string){try{return localStorage.getItem(k)??f;}catch{return f;}},set(k:string,v:string){try{localStorage.setItem(k,v);}catch{}}};

export default function App(){
 const [pageId,setPageId]=useState(getPage);
 const [filters,setFilters]=useState(Object.fromEntries(Object.entries(report.filters).map(([k,v])=>[k,v.sel])));
 const [notice,setNotice]=useState('');
 const [menuOpen,setMenuOpen]=useState(false);
 const [theme,setTheme]=useState<'light'|'dark'>(()=>ls.get('side.theme','light')==='dark'?'dark':'light');
 const [isFullscreen,setIsFullscreen]=useState(false);
 const [rulerOn,setRulerOn]=useState(()=>ls.get('side.ruler','off')==='on');
 const [rulerY,setRulerY]=useState(0);
 const [expanded,setExpanded]=useState<Set<string>>(()=>{try{const raw=localStorage.getItem('side.nav');if(raw)return new Set(JSON.parse(raw));}catch{}return new Set(groupOrder.map(g=>`g:${g}`));});
 const drawer=useRef<HTMLDialogElement>(null);

 const page=report.pages.find(p=>p.id===pageId)!;
 const currentSub=findSub(page.id,page.group);

 const navigate=useCallback((id:string)=>{if(!report.pages.some(p=>p.id===id))return;location.hash=id;setPageId(id);setMenuOpen(false);window.scrollTo({top:0,behavior:'instant'});},[]);

 useEffect(()=>{const handle=()=>{setPageId(getPage());setMenuOpen(false);};window.addEventListener('hashchange',handle);return()=>window.removeEventListener('hashchange',handle);},[]);
 useEffect(()=>{document.title=`${page.label} · SIDE / JUJ`;},[page.label]);
 useEffect(()=>{if(menuOpen)drawer.current?.showModal();else drawer.current?.close();},[menuOpen]);
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),6000);return()=>clearTimeout(t);},[notice]);
 useEffect(()=>{const handler=(e:Event)=>setNotice((e as CustomEvent<string>).detail);window.addEventListener('report-notice',handler);return()=>window.removeEventListener('report-notice',handler);},[]);

 useEffect(()=>{setExpanded(prev=>{const next=new Set(prev);next.add(`g:${page.group}`);if(currentSub)next.add(`s:${page.group}::${currentSub}`);return next;});},[page.group,currentSub]);
 useEffect(()=>{ls.set('side.nav',JSON.stringify([...expanded]));},[expanded]);

 useEffect(()=>{document.documentElement.dataset.theme=theme;ls.set('side.theme',theme);},[theme]);

 useEffect(()=>{ls.set('side.ruler',rulerOn?'on':'off');},[rulerOn]);
 useEffect(()=>{if(!rulerOn)return;const move=(e:MouseEvent)=>setRulerY(e.clientY);window.addEventListener('mousemove',move);return()=>window.removeEventListener('mousemove',move);},[rulerOn]);

 useEffect(()=>{const onFs=()=>setIsFullscreen(!!document.fullscreenElement);document.addEventListener('fullscreenchange',onFs);return()=>document.removeEventListener('fullscreenchange',onFs);},[]);
 const toggleFullscreen=useCallback(()=>{if(!document.fullscreenElement)document.documentElement.requestFullscreen?.().catch(()=>{});else document.exitFullscreen?.().catch(()=>{});},[]);

 const toggleKey=useCallback((k:string)=>{setExpanded(prev=>{const next=new Set(prev);if(next.has(k))next.delete(k);else next.add(k);return next;});},[]);

 function NavItem({p}:{p:ReportPage}){const ItemIcon=icons[p.id];return <button key={p.id} aria-current={p.id===pageId?'page':undefined} onClick={()=>navigate(p.id)}><ItemIcon size={17} strokeWidth={1.65}/><span>{p.label}</span>{p.paused?<small className="badge-paused">En pausa</small>:p.id===pageId?<ChevronRight size={13}/>:null}</button>;}

 function Sidebar(){return <>
  <div className="brand"><div className="brand-symbol"><Layers3 size={26} strokeWidth={1.5}/></div><div><strong>SIDE<span>®</span></strong><small>José Ugalde Jerves</small></div></div>
  <div className="brand-rule"/>
  <nav aria-label="Centros de inteligencia">{groupOrder.map(group=>{
   const gKey=`g:${group}`;const gOpen=expanded.has(gKey);const subs=subGroups[group];const groupPages=report.pages.filter(p=>p.group===group);
   return <div className={`nav-group ${gOpen?'open':'closed'}`} key={group}>
    <button type="button" className="nav-group-header" aria-expanded={gOpen} onClick={()=>toggleKey(gKey)}><span>{group}</span><ChevronDown size={12} className={gOpen?'':'rotate-neg90'}/></button>
    {gOpen&&<div className="nav-group-body">{subs
     ?<>{subs.map(sg=>{
       const sKey=`s:${group}::${sg.label}`;const sOpen=expanded.has(sKey);
       const sgPages=sg.ids.map(id=>report.pages.find(p=>p.id===id)).filter((p):p is ReportPage=>!!p);
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
  })}</nav>
  <div className="sidebar-foot"><div className="client-monogram">J</div><div><strong>JUJ</strong><span>Dirección empresarial</span></div><span className="foot-dot"/></div>
 </>;}

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
      <ChevronRight size={12}/><span>{page.group}</span>
      {currentSub&&<><ChevronRight size={12}/><span className="crumb-sub">{currentSub}</span></>}
      <ChevronRight size={12}/><span className="crumb-current">{page.label}</span>
     </div>
     <div className="utility-right">
      <div className="tool-buttons" role="group" aria-label="Herramientas de lectura">
       <button type="button" className={`tool-button ${rulerOn?'on':''}`} aria-pressed={rulerOn} aria-label="Regla de lectura" title="Regla de lectura" onClick={()=>setRulerOn(v=>!v)}><Minus size={16}/></button>
       <button type="button" className="tool-button" aria-label={theme==='dark'?'Modo claro':'Modo oscuro'} title={theme==='dark'?'Modo claro':'Modo oscuro'} onClick={()=>setTheme(t=>t==='dark'?'light':'dark')}>{theme==='dark'?<Sun size={16}/>:<Moon size={16}/>}</button>
       <button type="button" className="tool-button" aria-label={isFullscreen?'Salir de pantalla completa':'Pantalla completa'} title={isFullscreen?'Salir de pantalla completa':'Pantalla completa'} onClick={toggleFullscreen}>{isFullscreen?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button>
      </div>
      <span className="demo-label"><span/>Datos de ejemplo</span>
      <span className="avatar">JUJ</span>
     </div>
    </div>
    <header className="page-header">
     <div className="page-heading">
      <div className="page-kicker"><span className="gold-line"/>SIDE / {page.group}{currentSub?` · ${currentSub}`:''}</div>
      <h1>{page.label}</h1>
      <p>{page.question}</p>
     </div>
     <div className="header-actions">
      <div className="updated-time"><Clock3 size={13}/><span>Última actualización: hoy 07:58</span></div>
      <div className="action-buttons">
       <button className="button secondary" onClick={()=>window.print()}><ArrowDownToLine size={15}/>Exportar</button>
       <button className="button primary" onClick={()=>setNotice('Vista de demostración. La conexión a Odoo se realizará en la siguiente etapa.')}><RefreshCw size={14}/>Actualizar</button>
      </div>
     </div>
    </header>
    <section className="filters" aria-label="Filtros del reporte">
     <div className="filter-label"><SlidersHorizontal size={14}/><span>Filtros</span></div>
     <div className="filter-controls">{page.filters.map(key=><label className="filter" key={key}><span>{report.filters[key].label}</span><select aria-label={report.filters[key].label} value={filters[key]} onChange={e=>setFilters({...filters,[key]:e.target.value})}>{report.filters[key].options.map(o=><option key={o}>{o}</option>)}</select></label>)}</div>
    </section>
    <div className="report-content" key={pageId}>
     <ReportNodes nodes={page.nodes}/>
     <div className="report-footer"><span>SIDE <i>/</i> {page.label}</span><span>JUJ · CONTROL EMPRESARIAL</span></div>
    </div>
   </main>
  </div>
  {rulerOn&&<div className="reading-ruler" aria-hidden="true" style={{top:rulerY}}/>}
  {notice&&<div className="toast" role="status"><Activity size={18}/><span>{notice}</span><button aria-label="Cerrar aviso" onClick={()=>setNotice('')}><X size={16}/></button></div>}
 </NavigateContext.Provider>;
}
