import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';
import {api} from '../../data/api';
import {useLive} from '../live/LiveData';

export type Note={id:string;text:string;color:'gold'|'blue'|'green'|'red';createdAt:string;author:string;linkedPageId?:string;pinned?:boolean};

type NotesState={
 notes:Note[];
 add:(input:{text:string;color?:Note['color'];linkedPageId?:string})=>Note;
 update:(id:string,patch:Partial<Note>)=>void;
 remove:(id:string)=>void;
 forPage:(pageId:string)=>Note[];
};

const Ctx=createContext<NotesState|null>(null);
const KEY='nova.notes';
const AUTHOR='Yo';

const seed:Note[]=[
 {id:'n1',text:'Preguntar a Andrea por el follow-up de Comercial Andes esta semana.',color:'gold',createdAt:new Date(Date.now()-86400000*2).toISOString(),author:AUTHOR,linkedPageId:'clientes',pinned:true},
 {id:'n2',text:'Cartera vencida: pedir el detalle por vendedor antes del viernes.',color:'red',createdAt:new Date(Date.now()-86400000).toISOString(),author:AUTHOR,linkedPageId:'financiero'},
 {id:'n3',text:'Idea: campaña de fidelización Retail Intorno en octubre.',color:'blue',createdAt:new Date().toISOString(),author:AUTHOR,linkedPageId:'retailintorno'},
];

function readStore():Note[]{try{const raw=localStorage.getItem(KEY);if(!raw){localStorage.setItem(KEY,JSON.stringify(seed));return seed;}const p=JSON.parse(raw);return Array.isArray(p)?p:seed;}catch{return seed;}}

// Live: notes live in the NOVA API (per company and user); demo keeps the browser store.
type ApiNote={id:string;body:string;color:string;view_id:string|null;pinned:boolean;created_at:string};
const COLORS=new Set(['gold','blue','green','red']);

export function NotesProvider({children}:{children:ReactNode}){
 const {live,tenantId,user}=useLive();
 const author=user?.name||AUTHOR;
 const fromApi=useCallback((r:ApiNote):Note=>({id:r.id,text:r.body,color:(COLORS.has(r.color)?r.color:'gold') as Note['color'],
  createdAt:r.created_at,author,linkedPageId:r.view_id||undefined,pinned:r.pinned}),[author]);
 const [notes,setNotes]=useState<Note[]>(()=>live?[]:readStore());
 useEffect(()=>{if(live)return;try{localStorage.setItem(KEY,JSON.stringify(notes));}catch{}},[notes,live]);
 useEffect(()=>{
  if(!live||!tenantId)return;let off=false;
  api<{notes:ApiNote[]}>('/api/notes',{tenant:tenantId}).then(r=>{if(!off)setNotes(r.notes.map(fromApi));}).catch(()=>{});
  return()=>{off=true;};
 },[live,tenantId,fromApi]);

 const add=useCallback((input:{text:string;color?:Note['color'];linkedPageId?:string})=>{
  const n:Note={id:'n'+Date.now()+Math.random().toString(36).slice(2,5),text:input.text.trim().slice(0,500),color:input.color||'gold',createdAt:new Date().toISOString(),author,linkedPageId:input.linkedPageId};
  setNotes(prev=>[n,...prev]);
  if(live&&tenantId)api<ApiNote>('/api/notes',{tenant:tenantId,method:'POST',body:{body:n.text,color:n.color,view_id:n.linkedPageId}})
   .then(row=>setNotes(prev=>prev.map(x=>x.id===n.id?fromApi(row):x))).catch(()=>setNotes(prev=>prev.filter(x=>x.id!==n.id)));
  return n;
 },[live,tenantId,author,fromApi]);
 const update=useCallback((id:string,patch:Partial<Note>)=>{
  setNotes(prev=>prev.map(n=>n.id===id?{...n,...patch}:n));
  const body:Record<string,unknown>={};
  if(patch.text!==undefined)body.body=patch.text;if(patch.color!==undefined)body.color=patch.color;
  if(patch.pinned!==undefined)body.pinned=patch.pinned;if(patch.linkedPageId!==undefined)body.view_id=patch.linkedPageId;
  if(live&&tenantId&&Object.keys(body).length&&/^[0-9a-f-]{36}$/.test(id))api(`/api/notes/${id}`,{tenant:tenantId,method:'PATCH',body}).catch(()=>{});
 },[live,tenantId]);
 const remove=useCallback((id:string)=>{
  setNotes(prev=>prev.filter(n=>n.id!==id));
  if(live&&tenantId&&/^[0-9a-f-]{36}$/.test(id))api(`/api/notes/${id}`,{tenant:tenantId,method:'DELETE'}).catch(()=>{});
 },[live,tenantId]);
 const forPage=useCallback((pageId:string)=>notes.filter(n=>n.linkedPageId===pageId),[notes]);

 const value=useMemo<NotesState>(()=>({notes,add,update,remove,forPage}),[notes,add,update,remove,forPage]);
 return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotes(){const v=useContext(Ctx);if(!v)throw new Error('useNotes outside provider');return v;}
