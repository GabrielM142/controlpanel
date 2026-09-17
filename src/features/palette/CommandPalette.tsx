import {useEffect,useMemo,useRef,useState} from 'react';
import {Search,X,CornerDownLeft} from 'lucide-react';

export type PaletteItem={id:string;label:string;group:string;subgroup?:string;keywords?:string};

export function CommandPalette({open,onClose,items,onSelect}:{open:boolean;onClose:()=>void;items:PaletteItem[];onSelect:(id:string)=>void}){
 const [q,setQ]=useState('');
 const [idx,setIdx]=useState(0);
 const inputRef=useRef<HTMLInputElement>(null);

 useEffect(()=>{if(open){setQ('');setIdx(0);setTimeout(()=>inputRef.current?.focus(),0);}},[open]);

 const filtered=useMemo(()=>{const t=q.trim().toLowerCase();if(!t)return items;return items.filter(i=>[i.label,i.group,i.subgroup||'',i.keywords||''].join(' ').toLowerCase().includes(t));},[q,items]);

 useEffect(()=>{if(idx>=filtered.length)setIdx(0);},[filtered.length,idx]);

 function onKey(e:React.KeyboardEvent){
  if(e.key==='Escape'){e.preventDefault();onClose();}
  else if(e.key==='ArrowDown'){e.preventDefault();setIdx(i=>Math.min(filtered.length-1,i+1));}
  else if(e.key==='ArrowUp'){e.preventDefault();setIdx(i=>Math.max(0,i-1));}
  else if(e.key==='Enter'){e.preventDefault();const chosen=filtered[idx];if(chosen){onSelect(chosen.id);onClose();}}
 }

 if(!open)return null;
 return <div className="palette-backdrop" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
  <div className="palette" role="dialog" aria-label="Búsqueda rápida">
   <div className="palette-input"><Search size={14}/><input ref={inputRef} value={q} onChange={e=>setQ(e.target.value)} onKeyDown={onKey} placeholder="Buscar vista o acción…" aria-label="Búsqueda"/><button type="button" aria-label="Cerrar" onClick={onClose}><X size={14}/></button></div>
   <ul className="palette-list" role="listbox">
    {filtered.length===0
     ?<li className="palette-empty">Sin resultados. Probá con otro término.</li>
     :filtered.map((it,i)=><li key={it.id} role="option" aria-selected={i===idx} className={i===idx?'is-active':''}
       onMouseEnter={()=>setIdx(i)}
       onMouseDown={e=>{e.preventDefault();onSelect(it.id);onClose();}}>
       <div><strong>{it.label}</strong><span>{it.group}{it.subgroup?` · ${it.subgroup}`:''}</span></div>
       {i===idx&&<CornerDownLeft size={12}/>}
      </li>)}
   </ul>
   <footer className="palette-foot"><span>↑↓ moverte</span><span>Enter abrir</span><span>Esc cerrar</span></footer>
  </div>
 </div>;
}
