import {useEffect,useRef,useState} from 'react';
import {ChevronRight,Lock,PanelLeftClose,PanelLeftOpen} from 'lucide-react';
import PortalMenu from './PortalMenu';
import {PORTALS,portalEntry,type Portal,type PortalId} from './portals';

// Dock lateral luminoso (escritorio y tableta): los 8 portales. En tableta muestra solo el
// icono y la etiqueta aparece al pasar el cursor o con foco (tooltip CSS).
// Al pasar el cursor (o con foco) cada portal despliega su submenú con TODAS sus vistas:
// las que están fuera del plan de la empresa se muestran con candado, nunca se esconden.
export type DockLink={id:string;label:string;locked?:boolean;status?:'estable'|'revisar'|'atencion';badge?:number};

// Escritorio y tableta horizontal ≥ 1024 px: menú completo siempre visible (cada portal con todas sus vistas).
// Se puede plegar a solo iconos; en tableta siempre es el dock compacto con submenú flotante.
const WIDE='(min-width: 1024px)';
function useWide(){const [w,setW]=useState(()=>typeof window!=='undefined'&&window.matchMedia(WIDE).matches);
 useEffect(()=>{const m=window.matchMedia(WIDE);const on=()=>setW(m.matches);m.addEventListener('change',on);return()=>m.removeEventListener('change',on);},[]);return w;}

export default function PortalDock({active,allowed,onOpen,badge,links,current,expanded=false,onToggle,children}:{active:PortalId|null;allowed:(p:Portal)=>boolean;onOpen:(id:string,p:Portal)=>void;badge:(p:Portal)=>number;
 links?:(p:Portal)=>DockLink[];current?:string;expanded?:boolean;onToggle?:()=>void;children?:React.ReactNode}){
 const wide=useWide();
 const [fly,setFly]=useState<{id:PortalId;top:number}|null>(null);
 const timer=useRef<number|undefined>(undefined);
 const show=(p:Portal,el:HTMLElement)=>{window.clearTimeout(timer.current);const r=el.getBoundingClientRect();
  const h=Math.min(window.innerHeight-16,420,60+(links?links(p).length:0)*40);
  setFly({id:p.id,top:Math.max(8,Math.min(r.top,window.innerHeight-h-8))});};
 const hide=(now=false)=>{window.clearTimeout(timer.current);if(now)setFly(null);else timer.current=window.setTimeout(()=>setFly(null),180);};
 useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')hide(true);};window.addEventListener('keydown',onKey);return()=>{window.removeEventListener('keydown',onKey);window.clearTimeout(timer.current);};},[]);
 const flyPortal=fly?PORTALS.find(p=>p.id===fly.id)||null:null;
 const flyLinks=flyPortal&&links?links(flyPortal):[];

 if(expanded&&wide&&links)return <nav className="portal-dock is-expanded" aria-label="Menú de OMEGA">
  <div className="portal-menu-top">
   <button type="button" className="portal-dock-logo" aria-label="OMEGA · Cartelera de inicio" onClick={()=>onOpen('cartelera',PORTALS[0])}><span aria-hidden="true">Ω</span></button>
   <span className="portal-menu-brand">OMEGA</span>
   {onToggle&&<button type="button" className="portal-menu-toggle" aria-label="Plegar el menú a solo iconos" title="Plegar menú" onClick={onToggle}><PanelLeftClose size={18} aria-hidden="true"/></button>}
  </div>
  <PortalMenu portals={PORTALS.filter(allowed)} links={links} badge={badge} active={active} current={current} onOpen={onOpen}/>
  <div className="portal-dock-foot">{children}</div>
 </nav>;

 return <nav className="portal-dock" aria-label="Portales de OMEGA">
  <button type="button" className="portal-dock-logo" aria-label="OMEGA · Cartelera de inicio" onClick={()=>onOpen('cartelera',PORTALS[0])}><span aria-hidden="true">Ω</span></button>
  <ul>{PORTALS.filter(allowed).map(p=>{const Icon=p.id==='omega'?null:p.icon;const n=badge(p);const on=active===p.id;
   return <li key={p.id} onMouseEnter={e=>links&&show(p,e.currentTarget)} onMouseLeave={()=>hide()}>
    <button type="button" data-portal={p.id} className={`portal-dock-item${on?' is-active':''}${p.id==='omega'?' is-omega':''}`} aria-current={on?'page':undefined}
     aria-label={`${p.label}${n?` · ${n} pendientes`:''}`} aria-haspopup={links?'menu':undefined} aria-expanded={links?fly?.id===p.id:undefined}
     onFocus={e=>links&&show(p,e.currentTarget.parentElement as HTMLElement)} onClick={()=>{hide(true);onOpen(portalEntry(p),p);}}>
     <span className="portal-dock-icon" aria-hidden="true">{Icon?<Icon size={20} strokeWidth={1.8}/>:'Ω'}</span>
     <span className="portal-dock-label">{p.label}</span>
     {n>0&&<span className="portal-dock-badge" aria-hidden="true">{n>99?'99+':n}</span>}
    </button>
   </li>;})}</ul>
  {wide&&onToggle&&<button type="button" className="portal-menu-toggle" aria-label="Mostrar el menú completo" title="Mostrar menú completo" onClick={onToggle}><PanelLeftOpen size={18} aria-hidden="true"/></button>}
  <div className="portal-dock-foot">{children}</div>
  {flyPortal&&flyLinks.length>0&&<div className="portal-flyout" role="menu" aria-label={`Vistas de ${flyPortal.label}`} style={{top:fly!.top}}
   onMouseEnter={()=>window.clearTimeout(timer.current)} onMouseLeave={()=>hide()}>
   <button type="button" role="menuitem" className="portal-flyout-head" onClick={()=>{hide(true);onOpen(portalEntry(flyPortal),flyPortal);}}>
    <span>{flyPortal.label}</span><ChevronRight size={14} aria-hidden="true"/>
   </button>
   <ul>{flyLinks.map(l=><li key={l.id}>
    <button type="button" role="menuitem" className={`portal-flyout-item${l.id===current?' is-current':''}${l.locked?' is-locked':''}`} aria-current={l.id===current?'page':undefined}
     onClick={()=>{hide(true);onOpen(l.id,flyPortal);}}>
     <span className={`portal-flyout-dot st-${l.status||'estable'}`} aria-hidden="true"/>
     <span className="portal-flyout-label">{l.label}</span>
     {l.locked?<span className="portal-flyout-lock" title="Fuera del plan de tu empresa"><Lock size={12} aria-hidden="true"/>Plan</span>
      :l.badge?<span className="portal-flyout-badge">{l.badge>99?'99+':l.badge}</span>:null}
    </button>
   </li>)}</ul>
  </div>}
 </nav>;
}
