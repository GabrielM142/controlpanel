import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';
import {api} from '../../data/api';
import {useLive} from '../live/LiveData';

export type TaskPriority='baja'|'media'|'alta';
export type TaskStatus='pending'|'in_progress'|'done'|'cancelled';

export type Task={
 id:string;
 title:string;
 description?:string;
 createdAt:string;
 updatedAt:string;
 dueDate?:string;
 priority:TaskPriority;
 status:TaskStatus;
 linkedPageId?:string;
 aiReviewedAt?:string;
 aiSuggestion?:string;
};

type TasksState={
 tasks:Task[];
 add:(input:{title:string;description?:string;priority?:TaskPriority;dueDate?:string;linkedPageId?:string})=>Task;
 update:(id:string,patch:Partial<Task>)=>void;
 remove:(id:string)=>void;
 setStatus:(id:string,status:TaskStatus)=>void;
 markAiReview:(id:string,suggestion:string)=>void;
 counts:{pending:number;in_progress:number;done:number;overdue:number};
};

const Ctx=createContext<TasksState|null>(null);
const KEY='nova.tasks';

// Seed tasks so the boceto shows something meaningful on first load.
const seed:Task[]=[
 {id:'t1',title:'Revisar cartera vencida > 60 días',description:'Cruzar el saldo con los 2 clientes que mueven la aguja del mes.',createdAt:new Date(Date.now()-86400000*2).toISOString(),updatedAt:new Date(Date.now()-86400000*2).toISOString(),priority:'alta',status:'pending',linkedPageId:'financiero',dueDate:new Date(Date.now()+86400000*1).toISOString().slice(0,10)},
 {id:'t2',title:'Cerrar plan comercial Loja Q3',description:'Coordinar con Andrea M. la cobertura del ejecutivo saliente.',createdAt:new Date(Date.now()-86400000*3).toISOString(),updatedAt:new Date(Date.now()-86400000).toISOString(),priority:'media',status:'in_progress',linkedPageId:'comercial'},
 {id:'t3',title:'Aprobar propuesta OMEGA — alertas WhatsApp',description:'Revisar cotización final y respuesta antes del viernes.',createdAt:new Date(Date.now()-86400000*4).toISOString(),updatedAt:new Date(Date.now()-86400000*4).toISOString(),priority:'media',status:'pending',linkedPageId:'trueque-list',dueDate:new Date(Date.now()+86400000*3).toISOString().slice(0,10)},
 {id:'t4',title:'Presentación Directorio — armar guión',description:'20 min con foco en Cartera y Mayorista Intorno.',createdAt:new Date(Date.now()-86400000*5).toISOString(),updatedAt:new Date(Date.now()-86400000*2).toISOString(),priority:'alta',status:'in_progress',linkedPageId:'nivel1',dueDate:new Date(Date.now()+86400000*2).toISOString().slice(0,10)},
 {id:'t5',title:'Confirmar apertura sucursal Machala',description:'Firmar el contrato de arriendo y coordinar mudanza logística.',createdAt:new Date(Date.now()-86400000*8).toISOString(),updatedAt:new Date(Date.now()-86400000*7).toISOString(),priority:'baja',status:'done'},
];

function readStore():Task[]{try{const raw=localStorage.getItem(KEY);if(!raw){localStorage.setItem(KEY,JSON.stringify(seed));return seed;}const p=JSON.parse(raw);return Array.isArray(p)?p:seed;}catch{return seed;}}

// Live: tasks live in the NOVA API (shared, per company and user); demo keeps the browser store.
type ApiTask={id:string;title:string;description:string|null;status:string;priority:string;due_date:string|null;view_id:string|null;created_at:string;updated_at:string};
const FROM_API:Record<string,TaskStatus>={todo:'pending',doing:'in_progress',done:'done',cancelled:'cancelled'};
const TO_API:Record<TaskStatus,string>={pending:'todo',in_progress:'doing',done:'done',cancelled:'cancelled'};
const fromApi=(r:ApiTask):Task=>({id:r.id,title:r.title,description:r.description||undefined,createdAt:r.created_at,updatedAt:r.updated_at,
 dueDate:r.due_date?String(r.due_date).slice(0,10):undefined,priority:(r.priority==='urgente'?'alta':r.priority) as TaskPriority,
 status:FROM_API[r.status]||'pending',linkedPageId:r.view_id||undefined});

export function TasksProvider({children}:{children:ReactNode}){
 const {live,tenantId}=useLive();
 const [tasks,setTasks]=useState<Task[]>(()=>live?[]:readStore());
 useEffect(()=>{if(live)return;try{localStorage.setItem(KEY,JSON.stringify(tasks));}catch{}},[tasks,live]);
 useEffect(()=>{
  if(!live||!tenantId)return;let off=false;
  api<{tasks:ApiTask[]}>('/api/tasks',{tenant:tenantId}).then(r=>{if(!off)setTasks(r.tasks.map(fromApi));}).catch(()=>{});
  return()=>{off=true;};
 },[live,tenantId]);

 const add=useCallback((input:{title:string;description?:string;priority?:TaskPriority;dueDate?:string;linkedPageId?:string})=>{
  const now=new Date().toISOString();
  const t:Task={id:'t'+Date.now()+Math.random().toString(36).slice(2,5),title:input.title.trim().slice(0,140),description:input.description?.trim().slice(0,600),createdAt:now,updatedAt:now,priority:input.priority||'media',status:'pending',dueDate:input.dueDate,linkedPageId:input.linkedPageId};
  setTasks(prev=>[t,...prev]);
  if(live&&tenantId)api<ApiTask>('/api/tasks',{tenant:tenantId,method:'POST',body:{title:t.title,description:t.description,priority:t.priority,due_date:t.dueDate,view_id:t.linkedPageId}})
   .then(row=>setTasks(prev=>prev.map(x=>x.id===t.id?{...fromApi(row),aiReviewedAt:x.aiReviewedAt,aiSuggestion:x.aiSuggestion}:x)))
   .catch(()=>setTasks(prev=>prev.filter(x=>x.id!==t.id)));
  return t;
 },[live,tenantId]);
 const update=useCallback((id:string,patch:Partial<Task>)=>{
  setTasks(prev=>prev.map(t=>t.id===id?{...t,...patch,updatedAt:new Date().toISOString()}:t));
  const body:Record<string,unknown>={};
  if(patch.title!==undefined)body.title=patch.title;if(patch.description!==undefined)body.description=patch.description;
  if(patch.status!==undefined)body.status=TO_API[patch.status];if(patch.priority!==undefined)body.priority=patch.priority;
  if('dueDate' in patch)body.due_date=patch.dueDate||null;if(patch.linkedPageId!==undefined)body.view_id=patch.linkedPageId;
  if(live&&tenantId&&Object.keys(body).length&&/^[0-9a-f-]{36}$/.test(id))api(`/api/tasks/${id}`,{tenant:tenantId,method:'PATCH',body}).catch(()=>{});
 },[live,tenantId]);
 const remove=useCallback((id:string)=>{
  setTasks(prev=>prev.filter(t=>t.id!==id));
  if(live&&tenantId&&/^[0-9a-f-]{36}$/.test(id))api(`/api/tasks/${id}`,{tenant:tenantId,method:'DELETE'}).catch(()=>{});
 },[live,tenantId]);
 const setStatus=useCallback((id:string,status:TaskStatus)=>{update(id,{status});},[update]);
 const markAiReview=useCallback((id:string,suggestion:string)=>{setTasks(prev=>prev.map(t=>t.id===id?{...t,aiReviewedAt:new Date().toISOString(),aiSuggestion:suggestion}:t));},[]);

 const counts=useMemo(()=>{const today=new Date().toISOString().slice(0,10);return {
  pending:tasks.filter(t=>t.status==='pending').length,
  in_progress:tasks.filter(t=>t.status==='in_progress').length,
  done:tasks.filter(t=>t.status==='done').length,
  overdue:tasks.filter(t=>t.status!=='done'&&t.status!=='cancelled'&&t.dueDate&&t.dueDate<today).length,
 };},[tasks]);

 const value=useMemo<TasksState>(()=>({tasks,add,update,remove,setStatus,markAiReview,counts}),[tasks,add,update,remove,setStatus,markAiReview,counts]);
 return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTasks(){const v=useContext(Ctx);if(!v)throw new Error('useTasks outside provider');return v;}
