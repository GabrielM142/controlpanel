import {useEffect,useRef,useState} from 'react';
import {Check,ChevronDown,Layers3} from 'lucide-react';
import {useTenants} from './useTenants';

export function TenantSwitcher(){
 const {catalog,active,setActive}=useTenants();
 const [open,setOpen]=useState(false);
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;const off=(e:MouseEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node))setOpen(false);};document.addEventListener('mousedown',off);return()=>document.removeEventListener('mousedown',off);},[open]);
 return <div className="tenant-switch" ref={ref}>
  <button type="button" className="brand tenant-brand" aria-label={`Cliente activo: ${active.name}`} aria-expanded={open} onClick={()=>setOpen(v=>!v)}>
   <div className="brand-symbol"><Layers3 size={26} strokeWidth={1.5}/></div>
   <div><strong>{active.name}</strong><small>{active.subtitle}</small></div>
   <ChevronDown size={13} className={`tenant-chev ${open?'open':''}`}/>
  </button>
  {open&&<div className="tenant-menu" role="listbox" aria-label="Cambiar cliente analizado">
   <div className="tenant-menu-head">Cliente en análisis</div>
   {catalog.map(t=><button key={t.id} type="button" role="option" aria-selected={t.id===active.id} className={`tenant-option ${t.id===active.id?'is-active':''}`} onClick={()=>{setActive(t.id);setOpen(false);}}>
    <span className="tenant-mono">{t.monogram}</span>
    <span className="tenant-info"><strong>{t.name}</strong><em>{t.subtitle}</em><small>{t.sector}</small></span>
    {t.id===active.id&&<Check size={13}/>}
   </button>)}
   <div className="tenant-menu-foot">Los datos analizados corresponden al cliente seleccionado. Panel operado por <b>Trueque Labs</b>.</div>
  </div>}
 </div>;
}
