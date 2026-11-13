import {useMemo,useRef,useState} from 'react';
import {Check,Clock,PartyPopper,X} from 'lucide-react';
import type {Decision} from './useDecisions';
import {blocksOf,fmtMoney,pageById,seriesOf} from './data';

// Fase M6 · decisiones deslizables del teléfono. Derecha = Ejecutar, izquierda = Descartar; ambos
// usan el flujo actual (confirmación sobre $10 k y Deshacer). "Más tarde" solo reordena la pila en
// esta pantalla. La mini-gráfica sale de la vista ligada a la decisión (solo si tiene serie).
const KIND:Record<string,{label:string;tone:string}>={compra:{label:'COMPRA',tone:'cash'},descuento:{label:'PRECIO',tone:'goal'},reclamo:{label:'CLIENTE',tone:'loss'},
 umbral:{label:'UMBRAL',tone:'cost'},omega:{label:'OMEGA',tone:'ai'}};
const THRESHOLD=110;

function miniSeries(d:Decision,live:boolean):number[]{
 if(live||!d.pageId)return [];const page=pageById(d.pageId);if(!page)return [];
 const b=blocksOf(page).find(x=>x.node.kind==='bars');return b?seriesOf(d.pageId,b.id,null).map(r=>r.v):[];
}

export default function SwipeDeck({decisions,live,onDecide,xpFor}:{decisions:Decision[];live:boolean;onDecide:(d:Decision,ok:boolean)=>void;xpFor?:(k:'ok'|'no')=>number}){
 const [later,setLater]=useState<string[]>([]);
 const pending=decisions.filter(d=>d.status==='pendiente');
 const stack=useMemo(()=>[...pending.filter(d=>!later.includes(d.id)),...later.map(id=>pending.find(d=>d.id===id)).filter((d):d is Decision=>!!d)],[pending,later]);
 const [dx,setDx]=useState(0);const start=useRef<number|null>(null);
 const top=stack[0];
 const buzz=()=>{try{navigator.vibrate?.(18);}catch{}};
 const decide=(ok:boolean)=>{if(!top)return;buzz();setDx(0);setLater(l=>l.filter(x=>x!==top.id));onDecide(top,ok);};
 const postpone=()=>{if(!top)return;setDx(0);setLater(l=>[...l.filter(x=>x!==top.id),top.id]);};

 if(!top){
  const done=decisions.filter(d=>d.status==='aprobada'||d.status==='rechazada');
  const freed=decisions.filter(d=>d.status==='rechazada'&&d.kind==='compra').reduce((n,d)=>n+(d.amount||0),0);
  return <section className="sw-done om-rise" aria-label="Todo resuelto">
   <span className="sw-done-icon" aria-hidden="true"><PartyPopper size={34} strokeWidth={1.8}/></span>
   <h2>¡Todo resuelto!</h2>
   <p>{done.length?`Hoy resolviste ${done.length} ${done.length===1?'decisión':'decisiones'}: ${done.filter(d=>d.status==='aprobada').length} ejecutadas y ${done.filter(d=>d.status==='rechazada').length} descartadas${freed?`; liberaste ${fmtMoney(freed)} de caja`:''}.`:'No hay decisiones esperando tu firma.'}</p>
   <p className="sw-muted">Omega te avisará cuando algo necesite tu firma.</p>
  </section>;
 }
 const k=KIND[top.kind]||KIND.omega;const s=miniSeries(top,live);
 const onDown=(e:React.PointerEvent)=>{start.current=e.clientX;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);};
 const onMove=(e:React.PointerEvent)=>{if(start.current!==null)setDx(e.clientX-start.current);};
 const onUp=()=>{if(start.current===null)return;start.current=null;if(dx>THRESHOLD)decide(true);else if(dx<-THRESHOLD)decide(false);else setDx(0);};
 const hint=dx>40?'ok':dx<-40?'no':'';
 return <section className="sw" aria-label={`Decisiones por resolver: ${stack.length}`}>
  <div className="sw-stack">
   {stack.slice(1,3).reverse().map((d,i,arr)=><div key={d.id} className="sw-card is-behind" style={{['--depth' as string]:arr.length-i}} aria-hidden="true"/>)}
   <article key={top.id} className={`sw-card is-top${hint?` hint-${hint}`:''}`} style={{transform:`translateX(${dx}px) rotate(${dx/18}deg)`,transition:start.current===null?undefined:'none'}}
    onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={()=>{start.current=null;setDx(0);}} aria-label={`${k.label}: ${top.title}`}>
    {hint&&<span className={`sw-stamp ${hint==='ok'?'fin-income':'fin-loss'}`} aria-hidden="true">{hint==='ok'?'EJECUTAR':'DESCARTAR'}</span>}
    <div className="sw-top"><span className={`mx-tag fin-${k.tone}`}>{k.label}</span><span className="sw-muted">{top.age}</span></div>
    {top.amount?<strong className="sw-amount">{fmtMoney(top.amount)}</strong>:null}
    <h3 className="sw-title">{top.title}</h3>
    {s.length>1&&<MiniBars values={s}/>}
    {top.recommendation&&<p className="sw-ai"><span aria-hidden="true">Ω</span> {top.recommendation}</p>}
    <p className="sw-muted sw-count">{stack.length} por resolver · desliza o usa los botones</p>
   </article>
  </div>
  <div className="sw-actions">
   <button type="button" className="sw-btn is-no" aria-label={`Descartar ${top.title}`} onClick={()=>decide(false)}><X size={26}/><span>Descartar{xpFor?` +${xpFor('no')}`:''}</span></button>
   <button type="button" className="sw-btn is-later" aria-label={`Más tarde: ${top.title}`} onClick={postpone} disabled={stack.length<2}><Clock size={20}/><span>Más tarde</span></button>
   <button type="button" className="sw-btn is-ok" aria-label={`Ejecutar ${top.title}`} onClick={()=>decide(true)}><Check size={26}/><span>Ejecutar{xpFor?` +${xpFor('ok')}`:''}</span></button>
  </div>
 </section>;
}

function MiniBars({values}:{values:number[]}){
 const mx=Math.max(...values.map(Math.abs),1);
 return <div className="sw-bars" aria-hidden="true">{values.slice(-12).map((v,i)=><i key={i} className={v<0?'is-neg':''} style={{height:`${Math.max(6,Math.abs(v)/mx*100)}%`}}/>)}</div>;
}
