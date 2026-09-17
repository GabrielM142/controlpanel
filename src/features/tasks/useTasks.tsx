import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';

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
const KEY='side.tasks';

// Seed tasks so the boceto shows something meaningful on first load.
const seed:Task[]=[
 {id:'t1',title:'Revisar cartera vencida > 60 días',description:'Cruzar el saldo con los 2 clientes que mueven la aguja del mes.',createdAt:new Date(Date.now()-86400000*2).toISOString(),updatedAt:new Date(Date.now()-86400000*2).toISOString(),priority:'alta',status:'pending',linkedPageId:'financiero',dueDate:new Date(Date.now()+86400000*1).toISOString().slice(0,10)},
 {id:'t2',title:'Cerrar plan comercial Loja Q3',description:'Coordinar con Andrea M. la cobertura del ejecutivo saliente.',createdAt:new Date(Date.now()-86400000*3).toISOString(),updatedAt:new Date(Date.now()-86400000).toISOString(),priority:'media',status:'in_progress',linkedPageId:'comercial'},
 {id:'t3',title:'Aprobar propuesta Trueque Labs — alertas WhatsApp',description:'Revisar cotización final y respuesta antes del viernes.',createdAt:new Date(Date.now()-86400000*4).toISOString(),updatedAt:new Date(Date.now()-86400000*4).toISOString(),priority:'media',status:'pending',linkedPageId:'trueque-list',dueDate:new Date(Date.now()+86400000*3).toISOString().slice(0,10)},
 {id:'t4',title:'Presentación Directorio — armar guión',description:'20 min con foco en Cartera y Mayorista Intorno.',createdAt:new Date(Date.now()-86400000*5).toISOString(),updatedAt:new Date(Date.now()-86400000*2).toISOString(),priority:'alta',status:'in_progress',linkedPageId:'nivel1',dueDate:new Date(Date.now()+86400000*2).toISOString().slice(0,10)},
 {id:'t5',title:'Confirmar apertura sucursal Machala',description:'Firmar el contrato de arriendo y coordinar mudanza logística.',createdAt:new Date(Date.now()-86400000*8).toISOString(),updatedAt:new Date(Date.now()-86400000*7).toISOString(),priority:'baja',status:'done'},
];

function readStore():Task[]{try{const raw=localStorage.getItem(KEY);if(!raw){localStorage.setItem(KEY,JSON.stringify(seed));return seed;}const p=JSON.parse(raw);return Array.isArray(p)?p:seed;}catch{return seed;}}

export function TasksProvider({children}:{children:ReactNode}){
 const [tasks,setTasks]=useState<Task[]>(readStore);
 useEffect(()=>{try{localStorage.setItem(KEY,JSON.stringify(tasks));}catch{}},[tasks]);

 const add=useCallback((input:{title:string;description?:string;priority?:TaskPriority;dueDate?:string;linkedPageId?:string})=>{
  const now=new Date().toISOString();
  const t:Task={id:'t'+Date.now()+Math.random().toString(36).slice(2,5),title:input.title.trim().slice(0,140),description:input.description?.trim().slice(0,600),createdAt:now,updatedAt:now,priority:input.priority||'media',status:'pending',dueDate:input.dueDate,linkedPageId:input.linkedPageId};
  setTasks(prev=>[t,...prev]);return t;
 },[]);
 const update=useCallback((id:string,patch:Partial<Task>)=>{setTasks(prev=>prev.map(t=>t.id===id?{...t,...patch,updatedAt:new Date().toISOString()}:t));},[]);
 const remove=useCallback((id:string)=>{setTasks(prev=>prev.filter(t=>t.id!==id));},[]);
 const setStatus=useCallback((id:string,status:TaskStatus)=>{update(id,{status});},[update]);
 const markAiReview=useCallback((id:string,suggestion:string)=>{update(id,{aiReviewedAt:new Date().toISOString(),aiSuggestion:suggestion});},[update]);

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
