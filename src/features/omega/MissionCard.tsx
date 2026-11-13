import type {Decision} from './useDecisions';
import {fmtMoney} from './data';

// Misión de hoy = una decisión pendiente de useDecisions. Ejecutar/Descartar usan el flujo
// existente (confirmación sobre $10 k y Deshacer); "xp" solo se muestra si la motivación existe.
const KIND:Record<string,{label:string;tone:string}>={compra:{label:'COMPRA',tone:'cash'},descuento:{label:'PRECIO',tone:'goal'},reclamo:{label:'CLIENTE',tone:'loss'},
 umbral:{label:'UMBRAL',tone:'cost'},omega:{label:'OMEGA',tone:'ai'}};
export default function MissionCard({d,onExecute,onDismiss,xp}:{d:Decision;onExecute:()=>void;onDismiss:()=>void;xp?:{ok:number;no:number}}){
 const k=KIND[d.kind]||KIND.omega;const done=d.status!=='pendiente';
 return <article className={`mx-mission${done?' is-done':''}`} aria-label={`${k.label}: ${d.title}`}>
  <div className="mx-mission-top"><span className={`mx-tag fin-${k.tone}`}>{k.label}</span>{d.amount?<span className="mx-mission-amount">{fmtMoney(d.amount)}</span>:null}</div>
  <strong className="mx-mission-title">{d.title}</strong>
  {d.recommendation&&<span className="mx-mission-ai">Omega: {d.recommendation}</span>}
  {done?<span className={`mx-mission-done ${d.status==='aprobada'?'fin-income':''}`}>{d.status==='aprobada'?'Ejecutada · queda registrada':d.status==='rechazada'?'Descartada · queda en el historial':`Decisión ${d.status}`}</span>
   :<div className="mx-mission-actions">
    <button type="button" className="mx-btn-primary" onClick={onExecute}>Ejecutar{xp?` · +${xp.ok} XP`:''}</button>
    <button type="button" className="mx-btn-ghost" onClick={onDismiss}>Descartar{xp?` · +${xp.no}`:''}</button>
   </div>}
 </article>;
}
