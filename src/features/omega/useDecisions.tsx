import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';
import {useThresholds} from '../thresholds/useThresholds';
import {demoTickets} from '../tickets/TicketsView';
import {useLive} from '../live/LiveData';

// OMEGA · bandeja única de decisiones. Fuentes: tickets de soporte, umbrales excedidos (useThresholds),
// solicitudes de aprobación de ejemplo y lo que el gerente lleva desde "Pregúntale a Omega".
// Estado (aprobado/rechazado/escalado) se guarda en este navegador: es un demo, no firma real en el ERP.
export type DecisionKind='compra'|'descuento'|'reclamo'|'umbral'|'omega';
export type DecisionStatus='pendiente'|'aprobada'|'rechazada'|'escalada'|'reasignada';
export type Decision={id:string;kind:DecisionKind;title:string;detail:string;recommendation:string;amount?:number;
 priority:'alta'|'media'|'baja';sla?:number;age:string;owner?:string;pageId?:string;source:string;status:DecisionStatus};

const DEMO_APPROVALS:Omit<Decision,'status'>[]=[
 {id:'oc-4512',kind:'compra',title:'OC #4512 · Cerámica importada',detail:'Supera el umbral de aprobación de $40.000. El inventario de esa línea ya cubre 5 meses.',recommendation:'Rechazar y liberar caja; reprogramar la compra para el próximo trimestre.',amount:58200,priority:'alta',age:'hace 2 días',owner:'Compras',pageId:'compras',source:'Ejemplo · solicitud de compra'},
 {id:'desc-mendoza',kind:'descuento',title:'Ferretería Mendoza pide 12% de descuento',detail:'Cliente del top 5. Con ese descuento el margen del pedido baja a 9%.',recommendation:'Ofrecer 8% atado a volumen trimestral.',amount:14600,priority:'media',age:'hace 5 h',owner:'Comercial',pageId:'comercial',source:'Ejemplo · política de descuentos'},
 {id:'rec-hogarplus',kind:'reclamo',title:'Hogar Plus · lote defectuoso',detail:'$28.200 trimestrales en riesgo. El SLA vence hoy a las 18:00.',recommendation:'Reponer el lote ($2.100) y asignar seguimiento de calidad.',amount:2100,priority:'alta',sla:88,age:'hace 1 h',owner:'Logística',pageId:'logistica',source:'Ejemplo · reclamo de cliente'},
];

type Ctx={decisions:Decision[];pending:number;decide:(id:string,status:DecisionStatus)=>void;undo:(id:string)=>void;
 addFromOmega:(d:{title:string;detail:string;recommendation:string;pageId?:string})=>string};
const DecisionsCtx=createContext<Ctx|null>(null);
const KEY='nova.omega.decisions';
const read=()=>{try{const v=JSON.parse(localStorage.getItem(KEY)||'{}');return {status:v.status||{},added:Array.isArray(v.added)?v.added:[]};}catch{return {status:{},added:[]};}};

export function DecisionsProvider({children}:{children:ReactNode}){
 const {activeAlerts}=useThresholds();
 const {live}=useLive();
 const [store,setStore]=useState<{status:Record<string,DecisionStatus>;added:Omit<Decision,'status'>[]}>(read);
 const [history,setHistory]=useState<Record<string,DecisionStatus>>({});
 useEffect(()=>{try{localStorage.setItem(KEY,JSON.stringify(store));}catch{}},[store]);

 const base=useMemo<Omit<Decision,'status'>[]>(()=>[
  // Live: only what the manager created; demo approvals and tickets never mix with real data.
  ...(live?[]:DEMO_APPROVALS),
  ...store.added,
  ...(live?[]:demoTickets).filter(t=>t.status!=='resuelto'&&t.status!=='cerrado').map(t=>({id:`tk-${t.id}`,kind:'reclamo' as const,
   title:`${t.id} · ${t.asunto}`,detail:`${t.cliente} · ${t.canal} · abierto ${t.abierto} · en cola ${t.cola}.`,
   recommendation:t.sla>=90?'Escalar a nivel 2: el SLA está por vencer.':t.status==='esperando_cliente'?'Recordar al cliente y pausar el SLA.':'Mantener con el agente asignado y revisar en 2 h.',
   priority:t.prioridad,sla:t.sla,age:t.abierto,owner:t.agente,pageId:'tickets',source:'Tickets de soporte (demo)'})),
  ...activeAlerts.map(r=>({id:`th-${r.id}`,kind:'umbral' as const,title:`Umbral excedido · ${r.label}`,
   detail:`${r.metric}: ${r.current} ${r.unit} (umbral ${r.operator} ${r.threshold} ${r.unit}).`,
   recommendation:r.tone==='r'?'Asignar responsable hoy y revisar el plan de acción.':'Revisar en la reunión semanal.',
   priority:r.tone==='r'?'alta' as const:'media' as const,age:'ahora',owner:'Panel de Control',pageId:r.linkedPageId,source:'Umbrales configurados'})),
 ],[activeAlerts,store.added,live]);

 const decisions=useMemo(()=>base.map(d=>({...d,status:store.status[d.id]||'pendiente'})),[base,store.status]);
 const decide=useCallback((id:string,status:DecisionStatus)=>{
  setHistory(h=>({...h,[id]:store.status[id]||'pendiente'}));
  setStore(s=>({...s,status:{...s.status,[id]:status}}));
 },[store.status]);
 const undo=useCallback((id:string)=>{setStore(s=>{const status={...s.status};const prev=history[id];if(!prev||prev==='pendiente')delete status[id];else status[id]=prev;return {...s,status};});},[history]);
 const addFromOmega=useCallback((d:{title:string;detail:string;recommendation:string;pageId?:string})=>{
  const id=`omega-${Date.now()}`;
  const item:Omit<Decision,'status'>={id,kind:'omega',title:d.title,detail:d.detail,recommendation:d.recommendation,priority:'media',age:'ahora',owner:'Gerencia',pageId:d.pageId,source:'Pregúntale a Omega'};
  setStore(s=>({...s,added:[item,...s.added].slice(0,20)}));
  return id;
 },[]);
 const value=useMemo(()=>({decisions,pending:decisions.filter(d=>d.status==='pendiente').length,decide,undo,addFromOmega}),[decisions,decide,undo,addFromOmega]);
 return <DecisionsCtx.Provider value={value}>{children}</DecisionsCtx.Provider>;
}

export function useDecisions(){const v=useContext(DecisionsCtx);if(!v)throw new Error('useDecisions outside provider');return v;}
