import {ArrowRight,Calculator,Layers3,Megaphone,Settings2} from 'lucide-react';
import type {Widget} from '../../data/api';

// "Configura este reporte": the inputs a report depends on (budget, units, campaigns), how many of
// its blocks are waiting for them, and a direct way to load each one.
type Link={id:string;label:string;detail:string;icon:typeof Calculator};
const PRESUPUESTO=(detail:string):Link=>({id:'presupuesto',label:'Presupuesto',detail,icon:Calculator});
const UNITS:Link={id:'insumos',label:'Unidades de negocio',detail:'Qué equipo, diario o punto de venta es cada unidad',icon:Layers3};
const CAMPAIGNS:Link={id:'insumos',label:'Campañas de marketing',detail:'Carga o conexión con tu app de marketing',icon:Megaphone};
const UNIT_PAGE=[UNITS,PRESUPUESTO('Ventas y gastos fijos de la unidad')];
const SETUP:Record<string,Link[]>={
 nivel1:[PRESUPUESTO('Cumplimiento e ISE por unidad'),UNITS],
 comercial:[PRESUPUESTO('Cumplimiento de ventas')],
 compras:[PRESUPUESTO('Cumplimiento de compras, total y por marca')],
 logistica:[UNITS],
 marketing:[CAMPAIGNS,PRESUPUESTO('Presupuesto de inversión en marketing'),UNITS],
 mayoristahogar:UNIT_PAGE,mayoristaintorno:UNIT_PAGE,retailjuj:UNIT_PAGE,retailintorno:UNIT_PAGE,
};
const WAITING=/Presupuestos y unidades|Umbrales y alertas|presupuesto|campañas|unidades de negocio/i;

export function hasReportSetup(pageId:string){return Boolean(SETUP[pageId]);}

export default function ReportSetup({pageId,widgets,onNavigate}:{pageId:string;widgets:Record<string,Widget>|null;onNavigate:(id:string)=>void}){
 const links=SETUP[pageId];
 if(!links)return null;
 const waiting=Object.values(widgets||{}).filter(w=>w.kind==='missing'&&WAITING.test(w.reason)).length;
 return <section className="panel om-setup" aria-labelledby={`om-setup-${pageId}`}>
  <header className="panel-heading"><h2 id={`om-setup-${pageId}`}>Configura este reporte</h2><Settings2 size={15} aria-hidden="true"/></header>
  <div className="panel-body">
   <p className="om-ai-status">{waiting?`${waiting} bloque${waiting>1?'s':''} de este reporte esperan estos datos de tu empresa.`:'Todos los bloques de este reporte tienen sus datos.'}</p>
   <div className="om-setup-links">{links.map(l=>{const I=l.icon;return <button key={l.label} type="button" className="om-setup-link" onClick={()=>onNavigate(l.id)}>
    <I size={16} aria-hidden="true"/><span><strong>{l.label}</strong><small>{l.detail}</small></span><ArrowRight size={14} aria-hidden="true"/></button>;})}</div>
  </div>
 </section>;
}
