import {useEffect,useRef,useState} from 'react';
import {Ellipsis,X} from 'lucide-react';
import {PORTALS,portalEntry,type Portal,type PortalId} from './portals';

// Teléfono (< 768 px): dock inferior flotante con 4 portales y el orbe de Omega al centro.
// "Más" abre el resto de portales, los ajustes y la cuenta.
export default function MobileDock({active,allowed,onOpen,badge,more}:{active:PortalId|null;allowed:(p:Portal)=>boolean;onOpen:(id:string,p:Portal)=>void;badge:(p:Portal)=>number;more:React.ReactNode}){
 const [open,setOpen]=useState(false);
 const sheet=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(open)sheet.current?.showModal();else sheet.current?.close();},[open]);
 const main=PORTALS.filter(p=>p.mobile&&allowed(p));
 const omega=PORTALS.find(p=>p.id==='omega')!;
 const left=main.slice(0,2),right=main.slice(2,4);
 const rest=PORTALS.filter(p=>!p.mobile&&p.id!=='omega'&&allowed(p));
 const item=(p:Portal)=>{const Icon=p.icon;const n=badge(p);return <button key={p.id} type="button" className={`mdock-item${active===p.id?' is-active':''}`} aria-current={active===p.id?'page':undefined}
  aria-label={`${p.label}${n?` · ${n} pendientes`:''}`} onClick={()=>onOpen(portalEntry(p),p)}><Icon size={22} strokeWidth={1.8} aria-hidden="true"/><span>{p.label}</span>{n>0&&<i aria-hidden="true">{n>99?'99+':n}</i>}</button>;};
 return <>
  <nav className="mobile-dock" aria-label="Portales de OMEGA">
   {left.map(item)}
   {allowed(omega)&&<button type="button" className={`mdock-orb om-glow-pulse${active==='omega'?' is-active':''}`} aria-label="Hablar con Omega" onClick={()=>onOpen(portalEntry(omega),omega)}>Ω</button>}
   {right.map(item)}
   <button type="button" className="mdock-item" aria-haspopup="dialog" aria-expanded={open} aria-label="Más portales y ajustes" onClick={()=>setOpen(true)}><Ellipsis size={22} aria-hidden="true"/><span>Más</span></button>
  </nav>
  <dialog className="mdock-sheet" ref={sheet} onCancel={()=>setOpen(false)} onClick={e=>{if(e.target===sheet.current)setOpen(false);}} aria-label="Más portales y ajustes">
   <header><strong>Más</strong><button type="button" className="icon-button" aria-label="Cerrar" onClick={()=>setOpen(false)}><X size={20}/></button></header>
   <div className="mdock-sheet-portals">{rest.map(p=>{const Icon=p.icon;return <button key={p.id} type="button" className="mdock-sheet-item" onClick={()=>{setOpen(false);onOpen(portalEntry(p),p);}}>
    <Icon size={22} strokeWidth={1.8} aria-hidden="true"/><span>{p.label}</span></button>;})}</div>
   <div className="mdock-sheet-more" onClick={e=>{if((e.target as HTMLElement).closest('button[data-close]'))setOpen(false);}}>{more}</div>
  </dialog>
 </>;
}
