import {Lock,Store,Sparkles,type LucideIcon} from 'lucide-react';

// Pantalla de espera para una vista que existe pero no está en el plan de la empresa:
// la vista nunca desaparece del menú; aquí se explica cómo activarla.
export default function LockedModule({label,question,icon:Icon,onNavigate,onAsk}:{label:string;question?:string;icon?:LucideIcon;onNavigate:(id:string)=>void;onAsk:(q:string)=>void}){
 return <section className="panel locked-module" aria-labelledby="locked-module-title">
  <div className="locked-module-icon" aria-hidden="true">{Icon?<Icon size={30} strokeWidth={1.8}/>:<Lock size={30} strokeWidth={1.8}/>}<span><Lock size={14} strokeWidth={2}/></span></div>
  <span className="om-eyebrow">Fuera de tu plan</span>
  <h2 id="locked-module-title">{label} está en espera</h2>
  <p>{question?`${question} `:''}Esta vista ya está lista en OMEGA, pero tu empresa todavía no tiene el módulo activo. Cuando lo actives, se llena con los datos del próximo cierre.</p>
  <div className="locked-module-actions">
   <button type="button" className="om-btn" onClick={()=>onNavigate('market')}><Store size={16} aria-hidden="true"/> Activarlo en Market</button>
   <button type="button" className="om-btn om-btn--ai" onClick={()=>onAsk(`¿Qué me daría el módulo ${label}?`)}><Sparkles size={16} aria-hidden="true"/> Preguntar a Omega</button>
  </div>
 </section>;
}
