import {useEffect,useRef,useState} from 'react';
import {ChevronDown,Lock} from 'lucide-react';
import {portalEntry,type Portal,type PortalId} from './portals';
import type {DockLink} from './PortalDock';

// Menú completo por portales (escritorio, tableta y la hoja "Menú" del teléfono).
// Cada portal se pliega: el clic en el nombre abre su tablero (tarjetas) y despliega sus vistas;
// la flecha solo pliega o despliega. Por defecto queda abierto solo el portal activo,
// así Omega y Market se ven sin desplazar.
export default function PortalMenu({portals,links,badge,active,current,onOpen,className}:{portals:Portal[];links:(p:Portal)=>DockLink[];badge:(p:Portal)=>number;
 active:PortalId|null;current?:string;onOpen:(id:string,p:Portal)=>void;className?:string}){
 const [open,setOpen]=useState<Set<PortalId>>(()=>new Set(active?[active]:[]));
 useEffect(()=>{if(active)setOpen(new Set([active]));},[active]);
 const ref=useRef<HTMLUListElement>(null);
 useEffect(()=>{ref.current?.querySelector('.is-current')?.scrollIntoView({block:'nearest'});},[current]);
 const toggle=(id:PortalId)=>setOpen(s=>{const n=new Set(s);if(n.has(id))n.delete(id);else n.add(id);return n;});
 return <ul className={`portal-menu${className?` ${className}`:''}`} ref={ref}>{portals.map(p=>{const Icon=p.id==='omega'?null:p.icon;const n=badge(p);const on=active===p.id;const ls=links(p);
  const many=ls.length>1;const isOpen=many&&open.has(p.id);const listId=`pm-${p.id}`;
  return <li key={p.id} className={`portal-menu-group${on?' is-active':''}${isOpen?' is-open':''}`}>
   <div className="portal-menu-row">
    <button type="button" data-portal={p.id} className={`portal-menu-head${p.id==='omega'?' is-omega':''}`} aria-current={on&&!many?'page':undefined}
     onClick={()=>{if(many)setOpen(new Set([p.id]));onOpen(portalEntry(p),p);}}>
     <span className="portal-dock-icon" aria-hidden="true">{Icon?<Icon size={18} strokeWidth={1.8}/>:'Ω'}</span>
     <span className="portal-menu-label">{p.label}</span>
     {n>0&&<span className="portal-menu-count" aria-label={`${n} pendientes`}>{n>99?'99+':n}</span>}
    </button>
    {many&&<button type="button" className="portal-menu-caret" aria-expanded={isOpen} aria-controls={listId} aria-label={`${isOpen?'Plegar':'Desplegar'} ${p.label}`} onClick={()=>toggle(p.id)}>
     <ChevronDown size={16} aria-hidden="true"/></button>}
   </div>
   {isOpen&&<ul id={listId}>{ls.map(l=><li key={l.id}>
    <button type="button" className={`portal-flyout-item${l.id===current?' is-current':''}${l.locked?' is-locked':''}`} aria-current={l.id===current?'page':undefined} onClick={()=>onOpen(l.id,p)}>
     <span className={`portal-flyout-dot st-${l.status||'estable'}`} aria-hidden="true"/>
     <span className="portal-flyout-label">{l.label}</span>
     {l.locked?<span className="portal-flyout-lock" title="Fuera del plan de tu empresa"><Lock size={12} aria-hidden="true"/>Plan</span>
      :l.badge?<span className="portal-flyout-badge">{l.badge>99?'99+':l.badge}</span>:null}
    </button></li>)}</ul>}
  </li>;})}</ul>;
}
