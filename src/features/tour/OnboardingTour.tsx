import {useEffect,useLayoutEffect,useState} from 'react';
import {ChevronLeft,ChevronRight,GraduationCap,X} from 'lucide-react';

type TourStep={selector:string;title:string;body:string;placement?:'top'|'bottom'|'left'|'right'|'center'};

const STEPS:TourStep[]=[
 {selector:'.tenant-switch,.brand',title:'Cliente en análisis',body:'Este panel muestra la información del cliente que estás analizando. Podés cambiarlo desde el logo superior.',placement:'right'},
 {selector:'.nav-group-header',title:'Menú organizado',body:'Los grupos y subgrupos son plegables. Se auto-expanden con la vista activa y recuerdan tu preferencia.',placement:'right'},
 {selector:'.ai-bubble',title:'Copiloto de análisis',body:'Con esta burbuja abrís al copiloto IA. Puede interpretar la pantalla actual, responder consultas y trabajar sobre tus tareas y notas.',placement:'right'},
 {selector:'.tokens-wrap,.tokens-chip',title:'Tokens de gerencia',body:'Cada acción del copiloto consume tokens del plan. Renuevan cada mes según tu suscripción con Trueque Labs.',placement:'bottom'},
 {selector:'.icon-button.bell',title:'Centro de alertas',body:'Cambios críticos entre vistas: cartera, stock, SLA. Click te lleva directo a la vista relacionada.',placement:'bottom'},
 {selector:'.nav-trueque',title:'Trueque Labs',body:'Podés pedir un módulo nuevo. La IA arma la solicitud paso a paso y nuestro equipo la cotiza.',placement:'right'},
];

const KEY='side.tour.seen';

function useForceOpen(){
 const [open,setOpen]=useState(false);
 useEffect(()=>{try{if(!localStorage.getItem(KEY))setOpen(true);}catch{setOpen(true);}
  const handler=()=>setOpen(true);
  window.addEventListener('tour:start',handler);
  return()=>window.removeEventListener('tour:start',handler);
 },[]);
 return [open,setOpen] as const;
}

export function OnboardingTour(){
 const [open,setOpen]=useForceOpen();
 const [idx,setIdx]=useState(0);
 const [rect,setRect]=useState<DOMRect|null>(null);
 const step=STEPS[idx];

 useLayoutEffect(()=>{
  if(!open){setRect(null);return;}
  const el=step?document.querySelector(step.selector.split(',')[0]) as HTMLElement|null:null;
  const target=el||(step?document.querySelector(step.selector) as HTMLElement|null:null);
  if(target){
   target.scrollIntoView({block:'center',behavior:'smooth'});
   setTimeout(()=>{setRect(target.getBoundingClientRect());},220);
  }else{setRect(null);}
 },[open,idx,step]);

 useEffect(()=>{if(!open)return;const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')close();if(e.key==='ArrowRight')next();if(e.key==='ArrowLeft')prev();};const onResize=()=>{const el=step?document.querySelector(step.selector) as HTMLElement|null:null;if(el)setRect(el.getBoundingClientRect());};window.addEventListener('keydown',onKey);window.addEventListener('resize',onResize);window.addEventListener('scroll',onResize,true);return()=>{window.removeEventListener('keydown',onKey);window.removeEventListener('resize',onResize);window.removeEventListener('scroll',onResize,true);};},[open,idx,step]);

 function close(){setOpen(false);try{localStorage.setItem(KEY,'1');}catch{}}
 function next(){if(idx<STEPS.length-1)setIdx(i=>i+1);else close();}
 function prev(){if(idx>0)setIdx(i=>i-1);}

 if(!open||!step)return null;

 const placement=step.placement||'bottom';
 const tooltipStyle=(()=>{
  const pad=14;const w=320;const h=170;
  if(!rect||placement==='center'){return {top:`calc(50vh - ${h/2}px)`,left:`calc(50vw - ${w/2}px)`,maxWidth:w};}
  if(placement==='right'){return {top:Math.max(20,rect.top),left:Math.min(window.innerWidth-w-16,rect.right+pad),maxWidth:w};}
  if(placement==='left'){return {top:Math.max(20,rect.top),left:Math.max(16,rect.left-w-pad),maxWidth:w};}
  if(placement==='top'){return {top:Math.max(20,rect.top-h-pad),left:Math.max(16,Math.min(window.innerWidth-w-16,rect.left)),maxWidth:w};}
  return {top:Math.min(window.innerHeight-h-20,rect.bottom+pad),left:Math.max(16,Math.min(window.innerWidth-w-16,rect.left)),maxWidth:w};
 })();

 const spot=rect?{top:rect.top-8,left:rect.left-8,width:rect.width+16,height:rect.height+16}:null;

 return <div className="tour-overlay" role="dialog" aria-label="Tour de bienvenida" onClick={close}>
  {spot&&<div className="tour-spot" style={{top:spot.top,left:spot.left,width:spot.width,height:spot.height}}/>}
  <div className="tour-tooltip" style={tooltipStyle} onClick={e=>e.stopPropagation()}>
   <header><GraduationCap size={16}/><strong>{step.title}</strong><button type="button" aria-label="Cerrar tour" onClick={close}><X size={14}/></button></header>
   <p>{step.body}</p>
   <footer>
    <span>{idx+1} / {STEPS.length}</span>
    <div>
     {idx>0&&<button type="button" onClick={prev}><ChevronLeft size={13}/>Atrás</button>}
     <button type="button" className="tour-primary" onClick={next}>{idx===STEPS.length-1?'Terminar':'Siguiente'}{idx<STEPS.length-1&&<ChevronRight size={13}/>}</button>
    </div>
   </footer>
  </div>
 </div>;
}

export function startTour(){window.dispatchEvent(new Event('tour:start'));}
