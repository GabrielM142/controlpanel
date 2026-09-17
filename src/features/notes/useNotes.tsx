import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';

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
const AUTHOR='JUJ';

const seed:Note[]=[
 {id:'n1',text:'Preguntar a Andrea por el follow-up de Comercial Andes esta semana.',color:'gold',createdAt:new Date(Date.now()-86400000*2).toISOString(),author:AUTHOR,linkedPageId:'clientes',pinned:true},
 {id:'n2',text:'Cartera vencida: pedir el detalle por vendedor antes del viernes.',color:'red',createdAt:new Date(Date.now()-86400000).toISOString(),author:AUTHOR,linkedPageId:'financiero'},
 {id:'n3',text:'Idea: campaña de fidelización Retail Intorno en octubre.',color:'blue',createdAt:new Date().toISOString(),author:AUTHOR,linkedPageId:'retailintorno'},
];

function readStore():Note[]{try{const raw=localStorage.getItem(KEY);if(!raw){localStorage.setItem(KEY,JSON.stringify(seed));return seed;}const p=JSON.parse(raw);return Array.isArray(p)?p:seed;}catch{return seed;}}

export function NotesProvider({children}:{children:ReactNode}){
 const [notes,setNotes]=useState<Note[]>(readStore);
 useEffect(()=>{try{localStorage.setItem(KEY,JSON.stringify(notes));}catch{}},[notes]);

 const add=useCallback((input:{text:string;color?:Note['color'];linkedPageId?:string})=>{
  const n:Note={id:'n'+Date.now()+Math.random().toString(36).slice(2,5),text:input.text.trim().slice(0,500),color:input.color||'gold',createdAt:new Date().toISOString(),author:AUTHOR,linkedPageId:input.linkedPageId};
  setNotes(prev=>[n,...prev]);return n;
 },[]);
 const update=useCallback((id:string,patch:Partial<Note>)=>{setNotes(prev=>prev.map(n=>n.id===id?{...n,...patch}:n));},[]);
 const remove=useCallback((id:string)=>{setNotes(prev=>prev.filter(n=>n.id!==id));},[]);
 const forPage=useCallback((pageId:string)=>notes.filter(n=>n.linkedPageId===pageId),[notes]);

 const value=useMemo<NotesState>(()=>({notes,add,update,remove,forPage}),[notes,add,update,remove,forPage]);
 return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotes(){const v=useContext(Ctx);if(!v)throw new Error('useNotes outside provider');return v;}
