import {useEffect,useMemo,useRef} from 'react';
import {AlertTriangle,ArrowUpRight,Bell,SlidersHorizontal,X} from 'lucide-react';
import {useThresholds,type ThresholdRule} from '../thresholds/useThresholds';

type Severity='r'|'a'|'g';
export type Alert={id:string;severity:Severity;t:string;d:string;pageId:string;at:string};

// Static "business news" alerts. Threshold-driven alerts come from useThresholds.
export const globalAlerts:Alert[]=[
 {id:'a1',severity:'r',t:'Cartera vencida creció 12% intersemanal',d:'2 clientes concentran el 68% del saldo. Ver Financiero.',pageId:'financiero',at:'hoy 08:14'},
 {id:'a2',severity:'r',t:'Stock crítico en 4 SKU clave',d:'UMCO Chaide Loja: quiebre proyectado en 3 días.',pageId:'inventarios',at:'hoy 07:55'},
 {id:'a3',severity:'a',t:'SLA en riesgo — JUJ-1041',d:'Faltan 45 min. Distribuidora El Oro.',pageId:'tickets',at:'hoy 09:03'},
 {id:'a4',severity:'a',t:'Ticket promedio Retail JUJ bajó 6%',d:'Sucursal Machala arrastra la caída.',pageId:'retailjuj',at:'ayer'},
 {id:'a5',severity:'g',t:'Meta comercial Q3 al 82%',d:'A ritmo de cierre por encima del año pasado.',pageId:'comercial',at:'hoy 07:58'},
 {id:'a6',severity:'a',t:'Concentración de proveedores',d:'62% del volumen mensual en 2 proveedores. Ver Compras.',pageId:'compras',at:'martes'},
];

function fmt(v:number,unit:string){
 if(unit==='USD')return v.toLocaleString('es-EC',{style:'currency',currency:'USD',maximumFractionDigits:0});
 if(unit==='%')return `${v}%`;
 return `${v} ${unit}`;
}

function thresholdToAlert(r:ThresholdRule):Alert{
 return {id:`th-${r.id}`,severity:r.tone,t:`Umbral excedido — ${r.label}`,d:`${r.metric}: ${fmt(r.current,r.unit)} (umbral ${r.operator} ${fmt(r.threshold,r.unit)})`,pageId:r.linkedPageId,at:'ahora'};
}

export function useCombinedAlerts(){
 const {activeAlerts}=useThresholds();
 return useMemo(()=>{
  const dynamic=activeAlerts.map(thresholdToAlert);
  const combined=[...dynamic,...globalAlerts];
  const sev:Record<Severity,number>={r:0,a:1,g:2};
  return combined.sort((a,b)=>sev[a.severity]-sev[b.severity]);
 },[activeAlerts]);
}

export function AlertsDrawer({open,onClose,onNavigate}:{open:boolean;onClose:()=>void;onNavigate:(id:string)=>void}){
 const ref=useRef<HTMLDivElement>(null);
 const {activeAlerts}=useThresholds();
 const dynamicAlerts=activeAlerts.map(thresholdToAlert);
 const combined=[...dynamicAlerts,...globalAlerts];
 const critical=combined.filter(a=>a.severity==='r').length;
 useEffect(()=>{if(!open)return;const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',esc);return()=>window.removeEventListener('keydown',esc);},[open,onClose]);

 return <aside className={`alerts-drawer ${open?'open':''}`} role="dialog" aria-label="Alertas del negocio" aria-hidden={!open} ref={ref}>
  <header className="alerts-head">
   <div><Bell size={16}/><strong>Alertas</strong><small>{combined.length} activas · {critical} críticas</small></div>
   <button type="button" aria-label="Cerrar alertas" onClick={onClose}><X size={16}/></button>
  </header>
  <div className="alerts-body">
   {dynamicAlerts.length>0&&<>
    <div className="alerts-section-title"><SlidersHorizontal size={12}/> Umbrales configurados <em>({dynamicAlerts.length})</em></div>
    {dynamicAlerts.map(a=><button type="button" key={a.id} className={`alert-item sev-${a.severity}`} onClick={()=>{onNavigate(a.pageId);onClose();}}>
     <span className="alert-dot"/>
     <div>
      <div className="alert-top"><strong>{a.t}</strong><span>{a.at}</span></div>
      <p>{a.d}</p>
      <em><ArrowUpRight size={12}/> Abrir vista</em>
     </div>
    </button>)}
   </>}
   <div className="alerts-section-title"><Bell size={12}/> Movimientos del negocio <em>({globalAlerts.length})</em></div>
   {globalAlerts.map(a=><button type="button" key={a.id} className={`alert-item sev-${a.severity}`} onClick={()=>{onNavigate(a.pageId);onClose();}}>
    <span className="alert-dot"/>
    <div>
     <div className="alert-top"><strong>{a.t}</strong><span>{a.at}</span></div>
     <p>{a.d}</p>
     <em><ArrowUpRight size={12}/> Abrir vista</em>
    </div>
   </button>)}
   <div className="alerts-note"><AlertTriangle size={12}/> Las alertas configurables salen del <b>Panel de Control · Umbrales</b>. Cuando conectemos Odoo, las notificaciones llegarán en tiempo real.</div>
  </div>
 </aside>;
}
