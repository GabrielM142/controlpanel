import {PORTALS,portalEntry,type Portal,type PortalId} from './portals';

// Dock lateral luminoso (escritorio y tableta): los 8 portales. En tableta muestra solo el
// icono y la etiqueta aparece al pasar el cursor o con foco (tooltip CSS).
export default function PortalDock({active,allowed,onOpen,badge,children}:{active:PortalId|null;allowed:(p:Portal)=>boolean;onOpen:(id:string,p:Portal)=>void;badge:(p:Portal)=>number;children?:React.ReactNode}){
 return <nav className="portal-dock" aria-label="Portales de OMEGA">
  <button type="button" className="portal-dock-logo" aria-label="OMEGA · Cartelera de inicio" onClick={()=>onOpen('cartelera',PORTALS[0])}><span aria-hidden="true">Ω</span></button>
  <ul>{PORTALS.filter(allowed).map(p=>{const Icon=p.id==='omega'?null:p.icon;const n=badge(p);const on=active===p.id;
   return <li key={p.id}><button type="button" data-portal={p.id} className={`portal-dock-item${on?' is-active':''}${p.id==='omega'?' is-omega':''}`} aria-current={on?'page':undefined}
    aria-label={`${p.label}${n?` · ${n} pendientes`:''}`} onClick={()=>onOpen(portalEntry(p),p)}>
    <span className="portal-dock-icon" aria-hidden="true">{Icon?<Icon size={20} strokeWidth={1.8}/>:'Ω'}</span>
    <span className="portal-dock-label">{p.label}</span>
    {n>0&&<span className="portal-dock-badge" aria-hidden="true">{n>99?'99+':n}</span>}
   </button></li>;})}</ul>
  <div className="portal-dock-foot">{children}</div>
 </nav>;
}
