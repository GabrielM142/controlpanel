import {useEffect,useRef,useState} from 'react';
import {Coins,X,History,Info} from 'lucide-react';
import {useTokens} from './useTokens';

export function TokensChip(){
 const t=useTokens();
 const [open,setOpen]=useState(false);
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;const off=(e:MouseEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node))setOpen(false);};document.addEventListener('mousedown',off);return()=>document.removeEventListener('mousedown',off);},[open]);
 const tone=t.percentUsed>=95?'r':t.percentUsed>=80?'a':'g';
 return <div className="tokens-wrap" ref={ref}>
  <button type="button" className={`tokens-chip tone-${tone}`} aria-expanded={open} onClick={()=>setOpen(v=>!v)} title={`${t.remaining} tokens disponibles · Renueva el ${t.nextReset}`}>
   <Coins size={13}/>
   <span className="tokens-value">{t.simulated?<><strong>{t.remaining}</strong> / {t.monthlyBudget}</>:<><strong>{t.used.toLocaleString('es-EC')}</strong>{Number.isFinite(t.remaining)?` / ${t.monthlyBudget.toLocaleString('es-EC')}`:''} TK</>}</span>
   <span className="tokens-bar"><span style={{width:`${t.percentUsed}%`}}/></span>
  </button>
  {open&&<div className="tokens-panel" role="dialog" aria-label="Consumo de tokens">
   <div className="tokens-panel-head">
    <div><strong>{t.plan}</strong><span>{t.simulated?`Renueva el ${t.nextReset} · No acumulables`:Number.isFinite(t.remaining)?`Cuota de ${t.monthlyBudget.toLocaleString('es-EC')} Truekens · se renueva ${t.nextReset}`:'Sin límite de Truekens en tu plan'}</span></div>
    <button type="button" aria-label="Cerrar" onClick={()=>setOpen(false)}><X size={14}/></button>
   </div>
   <div className="tokens-panel-body">
    <div className="tokens-summary"><span>{t.simulated?'Usados':'Truekens usados'}</span><strong>{t.used}</strong><em>{t.simulated||Number.isFinite(t.remaining)?`de ${t.monthlyBudget.toLocaleString('es-EC')}`:''}</em></div>
    <div className="tokens-summary-bar"><span style={{width:`${t.percentUsed}%`}} className={`tone-${tone}`}/></div>
    <div className="tokens-history-title"><History size={11}/><span>Últimos consumos</span></div>
    {t.history.length===0
     ?<p className="tokens-empty"><Info size={12}/> {t.simulated?'Todavía no usaste tokens este período.':<>El detalle por usuario está en <a href="#truekens">Consumo de Truekens</a>.</>}</p>
     :<ul className="tokens-history">{t.history.slice(0,8).map((h,i)=><li key={i}><span>{new Date(h.at).toLocaleString('es-EC',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span><em>{h.reason}</em><strong>-{h.cost}</strong></li>)}</ul>}
   </div>
  </div>}
 </div>;
}
