import {useEffect,useRef,useState} from 'react';
import {LogOut,Settings,ShieldCheck,type LucideIcon} from 'lucide-react';

// Menú del avatar: la cuenta, la empresa activa, los Ajustes y el Super admin.
export type MenuLink={id:string;label:string;icon:LucideIcon};
export function AccountMenuBody({name,role,settings,admin,onOpen,onLogout,tenantSwitcher}:{name:string;role:string;settings:MenuLink[];admin:MenuLink[];onOpen:(id:string)=>void;onLogout?:()=>void;tenantSwitcher?:React.ReactNode}){
 return <div className="acct-menu-body">
  <div className="acct-menu-who"><strong>{name}</strong><span>{role}</span></div>
  {tenantSwitcher&&<div className="acct-menu-tenant">{tenantSwitcher}</div>}
  <p className="acct-menu-h"><Settings size={12} aria-hidden="true"/> Ajustes</p>
  <ul>{settings.map(s=>{const I=s.icon;return <li key={s.id}><button type="button" data-close onClick={()=>onOpen(s.id)}><I size={16} strokeWidth={1.8} aria-hidden="true"/>{s.label}</button></li>;})}</ul>
  {admin.length>0&&<><p className="acct-menu-h"><ShieldCheck size={12} aria-hidden="true"/> Plataforma OMEGA</p>
   <ul>{admin.map(s=>{const I=s.icon;return <li key={s.id}><button type="button" data-close onClick={()=>onOpen(s.id)}><I size={16} strokeWidth={1.8} aria-hidden="true"/>{s.label}</button></li>;})}</ul></>}
  {onLogout&&<button type="button" className="acct-menu-out" data-close onClick={onLogout}><LogOut size={15} aria-hidden="true"/>Cerrar sesión</button>}
 </div>;
}

export default function AvatarMenu({initials,...body}:{initials:string}&Parameters<typeof AccountMenuBody>[0]){
 const [open,setOpen]=useState(false);
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;
  const off=(e:MouseEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node))setOpen(false);};
  const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};
  document.addEventListener('mousedown',off);document.addEventListener('keydown',esc);
  return()=>{document.removeEventListener('mousedown',off);document.removeEventListener('keydown',esc);};},[open]);
 return <div className="acct-menu" ref={ref}>
  <button type="button" className="avatar acct-menu-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`Cuenta de ${body.name}: ajustes y sesión`} onClick={()=>setOpen(v=>!v)}>{initials}</button>
  {open&&<div className="acct-menu-pop" role="menu" onClick={e=>{if((e.target as HTMLElement).closest('button[data-close]'))setOpen(false);}}><AccountMenuBody {...body}/></div>}
 </div>;
}
