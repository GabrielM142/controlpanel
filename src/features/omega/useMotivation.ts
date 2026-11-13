import {useCallback,useEffect,useRef,useState} from 'react';

// Fase M5 · Motivación. Solo es retroalimentación visual: no da permisos, no cambia datos y no
// regala Truekens. Se guarda por empresa y persona en este navegador hasta que exista una API:
// localStorage["nova.omega.motivation.<tenantId>.<userId>"] = {xp, streak, lastActiveDay, history[]}.
export type ActionKind='decision'|'discard'|'ticket'|'read'|'ask'|'task';
export const XP:Record<ActionKind,number>={decision:150,discard:40,ticket:120,read:60,ask:30,task:50};
export const LEVELS=['Observador','Analista','Estratega','Visionario','Comandante'];
export const LEVEL_XP=3000;

export type ActionDetail={kind:ActionKind;ref?:string;title?:string;amount?:number;sub?:string};
type Entry={at:number;kind:ActionKind;xp:number;ref?:string;title?:string;amount?:number;sub?:string};
type Store={xp:number;streak:number;lastActiveDay:string|null;history:Entry[];summaryWeek?:string};
export type Achievement={id:number;xp:number;title:string;phrase:string;levelUp?:string;weekly?:boolean};

const EVENT='omega-action';
/** Lo llaman las vistas cuando el usuario completa una acción real (decidir, resolver, leer…). */
export function emitAction(d:ActionDetail){try{window.dispatchEvent(new CustomEvent<ActionDetail>(EVENT,{detail:d}));}catch{}}

const day=(t=Date.now())=>{const d=new Date(t);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const yesterday=()=>day(Date.now()-86400000);
const weekKey=(t=Date.now())=>{const d=new Date(t);d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));return day(d.getTime());};
const empty=():Store=>({xp:0,streak:0,lastActiveDay:null,history:[]});
const kfmt=(n:number)=>n>=1000?`$${Math.round(n/1000)} k`:`$${Math.round(n)}`;
export const levelOf=(xp:number)=>{const last=LEVELS.length-1;const i=Math.min(last,Math.floor(xp/LEVEL_XP));
 return {index:i,number:i+1,name:LEVELS[i],progress:i<last?Math.round((xp%LEVEL_XP)/LEVEL_XP*100):100,toNext:i<last?LEVEL_XP-(xp%LEVEL_XP):0};};

function phraseFor(d:ActionDetail):string{
 switch(d.kind){
  case 'decision':return d.sub==='descuento'?'cliente retenido con tu firma':d.sub==='reclamo'?'un cliente atendido a tiempo':d.sub==='compra'&&d.amount?`compra de ${kfmt(d.amount)} en marcha`:'el pulso sube';
  case 'discard':return d.sub==='compra'&&d.amount?`liberaste ${kfmt(d.amount)} de caja`:'revisada y archivada';
  case 'ticket':return 'un cliente menos esperando';
  case 'read':return d.title?`leíste ${d.title} completo`:'reporte leído completo';
  case 'ask':return 'Omega ya trabaja en tu respuesta';
  case 'task':return d.title?`tarea cerrada: ${d.title}`:'tarea cerrada';
 }
}
const TITLE:Record<ActionKind,string>={decision:'Decisión ejecutada',discard:'Decisión descartada',ticket:'Ticket resuelto',read:'Reporte leído',ask:'Pregunta a Omega',task:'Tarea completada'};

function load(key:string):Store{try{const v=JSON.parse(localStorage.getItem(key)||'null');if(v&&typeof v.xp==='number')return {...empty(),...v,history:Array.isArray(v.history)?v.history:[]};}catch{}return empty();}

export function useMotivation(tenant:string,user:string){
 const key=`nova.omega.motivation.${tenant}.${user}`;
 const [store,setStore]=useState<Store>(()=>load(key));
 const [toasts,setToasts]=useState<Achievement[]>([]);
 const seq=useRef(0);
 const storeRef=useRef(store);storeRef.current=store;
 useEffect(()=>{setStore(load(key));},[key]);
 const save=useCallback((s:Store)=>{storeRef.current=s;setStore(s);try{localStorage.setItem(key,JSON.stringify(s));}catch{}},[key]);
 const push=useCallback((a:Omit<Achievement,'id'>)=>{const id=++seq.current;setToasts(t=>[...t,{...a,id}]);},[]);

 useEffect(()=>{
  const onAction=(e:Event)=>{
   const d=(e as CustomEvent<ActionDetail>).detail;if(!d||!(d.kind in XP))return;
   const s=storeRef.current;const today=day();
   // Una misma acción sobre el mismo elemento suma una sola vez por día (Deshacer y repetir no infla el XP).
   if(d.ref&&s.history.some(h=>h.ref===d.ref&&h.kind===d.kind&&day(h.at)===today))return;
   const xp=XP[d.kind];const before=levelOf(s.xp);const total=s.xp+xp;const after=levelOf(total);
   const streak=s.lastActiveDay===today?s.streak:s.lastActiveDay===yesterday()?s.streak+1:1;
   save({...s,xp:total,streak,lastActiveDay:today,history:[{at:Date.now(),kind:d.kind,xp,ref:d.ref,title:d.title,amount:d.amount,sub:d.sub},...s.history].slice(0,300)});
   push({xp,title:TITLE[d.kind],phrase:phraseFor(d),levelUp:after.index>before.index?after.name:undefined});
  };
  const onRead=(e:Event)=>{const id=(e as CustomEvent<string>).detail;const label=document.querySelector('h1')?.textContent?.trim();emitAction({kind:'read',ref:`read:${id}`,title:label||undefined});};
  window.addEventListener(EVENT,onAction);window.addEventListener('omega-read-end',onRead);
  return()=>{window.removeEventListener(EVENT,onAction);window.removeEventListener('omega-read-end',onRead);};
 },[save,push]);

 // Resumen semanal: los lunes, una vez por semana, con las acciones de los 7 días anteriores.
 useEffect(()=>{
  if(new Date().getDay()!==1)return;const s=storeRef.current;const wk=weekKey();if(s.summaryWeek===wk)return;
  const from=Date.now()-7*86400000;const last=s.history.filter(h=>h.at>=from&&day(h.at)!==day());
  save({...s,summaryWeek:wk});
  if(!last.length)return;
  const dec=last.filter(h=>h.kind==='decision'||h.kind==='discard').length;
  const freed=last.filter(h=>h.kind==='discard'&&h.sub==='compra').reduce((n,h)=>n+(h.amount||0),0);
  const xp=last.reduce((n,h)=>n+h.xp,0);
  push({xp,weekly:true,title:'Resumen de tu semana',phrase:`Esta semana tomaste ${dec} ${dec===1?'decisión':'decisiones'}${freed?` y liberaste ${kfmt(freed)} de caja`:''}; ${last.length} acciones en total.`});
 },[key,save,push]);

 const dismiss=useCallback((id:number)=>setToasts(t=>t.filter(x=>x.id!==id)),[]);
 const lv=levelOf(store.xp);
 const activeToday=store.lastActiveDay===day();
 const streak=activeToday||store.lastActiveDay===yesterday()?store.streak:0;
 return {xp:store.xp,level:lv,streak,toasts,dismiss,xpFor:(k:'ok'|'no')=>k==='ok'?XP.decision:XP.discard};
}
export type Motivation=ReturnType<typeof useMotivation>;
