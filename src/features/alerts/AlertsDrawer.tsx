import {useEffect,useRef} from 'react';
import {AlertTriangle,ArrowUpRight,Bell,X} from 'lucide-react';

type Severity='r'|'a'|'g';
export type Alert={id:string;severity:Severity;t:string;d:string;pageId:string;at:string};

export const globalAlerts:Alert[]=[
 {id:'a1',severity:'r',t:'Cartera vencida creció 12% intersemanal',d:'2 clientes concentran el 68% del saldo. Ver Financiero.',pageId:'financiero',at:'hoy 08:14'},
 {id:'a2',severity:'r',t:'Stock crítico en 4 SKU clave',d:'UMCO Chaide Loja: quiebre proyectado en 3 días.',pageId:'inventarios',at:'hoy 07:55'},
 {id:'a3',severity:'a',t:'SLA en riesgo — JUJ-1041',d:'Faltan 45 min. Distribuidora El Oro.',pageId:'tickets',at:'hoy 09:03'},
 {id:'a4',severity:'a',t:'Ticket promedio Retail JUJ bajó 6%',d:'Sucursal Machala arrastra la caída.',pageId:'retailjuj',at:'ayer'},
 {id:'a5',severity:'g',t:'Meta comercial Q3 al 82%',d:'A ritmo de cierre por encima del año pasado.',pageId:'comercial',at:'hoy 07:58'},
 {id:'a6',severity:'a',t:'Concentración de proveedores',d:'62% del volumen mensual en 2 proveedores. Ver Compras.',pageId:'compras',at:'martes'},
];

export function AlertsDrawer({open,onClose,onNavigate}:{open:boolean;onClose:()=>void;onNavigate:(id:string)=>void}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',esc);return()=>window.removeEventListener('keydown',esc);},[open,onClose]);

 const critical=globalAlerts.filter(a=>a.severity==='r').length;
 return <aside className={`alerts-drawer ${open?'open':''}`} role="dialog" aria-label="Alertas del negocio" aria-hidden={!open} ref={ref}>
  <header className="alerts-head">
   <div><Bell size={16}/><strong>Alertas</strong><small>{globalAlerts.length} activas · {critical} críticas</small></div>
   <button type="button" aria-label="Cerrar alertas" onClick={onClose}><X size={16}/></button>
  </header>
  <div className="alerts-body">
   {globalAlerts.map(a=><button type="button" key={a.id} className={`alert-item sev-${a.severity}`} onClick={()=>{onNavigate(a.pageId);onClose();}}>
    <span className="alert-dot"/>
    <div>
     <div className="alert-top"><strong>{a.t}</strong><span>{a.at}</span></div>
     <p>{a.d}</p>
     <em><ArrowUpRight size={12}/> Abrir vista</em>
    </div>
   </button>)}
   <div className="alerts-note"><AlertTriangle size={12}/> Estas alertas se generarán en tiempo real desde la base analítica al conectar el worker de Odoo.</div>
  </div>
 </aside>;
}
