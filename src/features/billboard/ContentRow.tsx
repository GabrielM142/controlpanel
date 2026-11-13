import {useRef,type ReactNode} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';

// Fila horizontal de la cartelera: rueda del ratón, flechas y deslizamiento táctil.
export default function ContentRow({title,meta,children,empty}:{title:string;meta?:ReactNode;children:ReactNode;empty?:string}){
 const ref=useRef<HTMLDivElement>(null);
 const move=(dir:number)=>{const el=ref.current;if(el)el.scrollBy({left:dir*el.clientWidth*.8,behavior:'smooth'});};
 const onWheel=(e:React.WheelEvent<HTMLDivElement>)=>{const el=ref.current;if(!el||Math.abs(e.deltaX)>Math.abs(e.deltaY))return;
  if(el.scrollWidth>el.clientWidth){el.scrollLeft+=e.deltaY;}};
 const has=Array.isArray(children)?children.length>0:!!children;
 return <section className="bb-row" aria-label={title}>
  <header className="bb-row-head"><h2>{title}{meta&&<span className="bb-row-meta"> · {meta}</span>}</h2>
   {has&&<span className="bb-row-arrows"><button type="button" aria-label={`Anterior en ${title}`} onClick={()=>move(-1)}><ChevronLeft size={18}/></button>
    <button type="button" aria-label={`Siguiente en ${title}`} onClick={()=>move(1)}><ChevronRight size={18}/></button></span>}</header>
  {has?<div className="bb-row-track" ref={ref} onWheel={onWheel}>{children}</div>:<p className="bb-row-empty">{empty||'Sin elementos.'}</p>}
 </section>;
}
