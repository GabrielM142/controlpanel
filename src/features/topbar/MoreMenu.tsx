import {useEffect,useRef,useState} from 'react';
import {MoreVertical,type LucideIcon} from 'lucide-react';

export type MoreMenuItem={icon:LucideIcon;label:string;onClick:()=>void;active?:boolean;shortcut?:string};

// Compact overflow menu for the utility bar on small screens.
export function MoreMenu({items,className=''}:{items:MoreMenuItem[];className?:string}){
 const [open,setOpen]=useState(false);
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;const off=(e:MouseEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node))setOpen(false);};document.addEventListener('mousedown',off);const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};document.addEventListener('keydown',esc);return()=>{document.removeEventListener('mousedown',off);document.removeEventListener('keydown',esc);};},[open]);
 return <div className={`more-wrap ${className}`} ref={ref}>
  <button type="button" className="icon-button more-trigger" aria-label="Más herramientas" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><MoreVertical size={18}/></button>
  {open&&<div className="more-menu" role="menu" aria-label="Herramientas">
   <ul>{items.map((it,i)=><li key={i}><button type="button" role="menuitem" className={it.active?'is-active':''} onClick={()=>{it.onClick();setOpen(false);}}>
    <it.icon size={14}/><span>{it.label}</span>{it.shortcut&&<em>{it.shortcut}</em>}{it.active&&<b className="more-dot" aria-hidden="true"/>}
   </button></li>)}</ul>
  </div>}
 </div>;
}
