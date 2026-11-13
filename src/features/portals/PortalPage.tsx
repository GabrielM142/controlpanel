import {ArrowRight,Lock,type LucideIcon} from 'lucide-react';
import type {Portal} from './portals';

// Página de portal: cada vista como una tarjeta grande (estilo cartelera) con su pregunta
// gerencial y su estado, que sale de las alertas y notificaciones reales de esa vista.
export type PortalStatus='estable'|'revisar'|'atencion';
export type PortalItem={id:string;label:string;question:string;icon:LucideIcon;status:PortalStatus;badge?:number;note?:string;locked?:boolean};
const STATUS:Record<PortalStatus,string>={estable:'Estable',revisar:'Revisar',atencion:'Atención'};

export default function PortalPage({portal,items,onOpen}:{portal:Portal;items:PortalItem[];onOpen:(id:string)=>void}){
 if(!items.length)return <section className="panel"><div className="panel-body"><p className="block-missing">Este portal todavía no tiene vistas.</p></div></section>;
 return <section className="portal-page" aria-label={`Vistas de ${portal.label}`}>
  <ul className="portal-grid">{items.map(it=>{const Icon=it.icon;
   return <li key={it.id}><button type="button" className={`portal-card om-hover-grow st-${it.status}${it.locked?' is-locked':''}`} onClick={()=>onOpen(it.id)}>
    <span className="portal-card-top">
     <span className="portal-card-icon" aria-hidden="true"><Icon size={22} strokeWidth={1.8}/></span>
     {it.locked?<span className="portal-card-status is-locked"><Lock size={12} aria-hidden="true"/> Fuera de tu plan</span>
      :<span className={`portal-card-status st-${it.status}`}>{STATUS[it.status]}{it.badge?` · ${it.badge}`:''}</span>}
    </span>
    <span className="portal-card-title">{it.label}</span>
    <span className="portal-card-q">{it.question}</span>
    {it.note&&<span className="portal-card-note">{it.note}</span>}
    <span className="portal-card-go">{it.locked?'Ver cómo activarlo':'Abrir'} <ArrowRight size={14} aria-hidden="true"/></span>
   </button></li>;})}</ul>
 </section>;
}
