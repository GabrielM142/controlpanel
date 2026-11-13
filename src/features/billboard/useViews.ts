import {useEffect,useSyncExternalStore} from 'react';

// Historial de lectura por empresa en este navegador (nova.views.<tenantId>): última apertura,
// aperturas y avance de lectura (scroll máximo alcanzado, 0–100). Alimenta "Continúa revisando"
// y "Lo más visto por ti". Hasta que exista una API, nunca muestra datos de otras personas.
export type ViewStat={at:number;opens:number;progress:number};
type Store=Record<string,ViewStat>;
const listeners=new Set<()=>void>();
const key=(t:string)=>`nova.views.${t}`;
const cache=new Map<string,Store>();
function read(t:string):Store{
 if(cache.has(t))return cache.get(t)!;
 let s:Store={};try{const v=JSON.parse(localStorage.getItem(key(t))||'{}');if(v&&typeof v==='object')s=v;}catch{}
 cache.set(t,s);return s;
}
function write(t:string,s:Store){cache.set(t,s);try{localStorage.setItem(key(t),JSON.stringify(s));}catch{}listeners.forEach(l=>l());}
const subscribe=(l:()=>void)=>{listeners.add(l);return()=>{listeners.delete(l);};};

export function useViewHistory(tenant:string){return useSyncExternalStore(subscribe,()=>read(tenant),()=>read(tenant));}

/** Registra la apertura de una vista y su avance de lectura mientras se recorre. */
export function useTrackView(tenant:string,pageId:string,enabled:boolean){
 useEffect(()=>{
  if(!enabled)return;
  const s=read(tenant);const prev=s[pageId];
  write(tenant,{...s,[pageId]:{at:Date.now(),opens:(prev?.opens||0)+1,progress:prev?.progress||0}});
  let raf=0;
  const onScroll=()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>{
   const doc=document.documentElement;const max=doc.scrollHeight-window.innerHeight;
   const p=max<=0?100:Math.min(100,Math.round(window.scrollY/max*100));
   const cur=read(tenant);const v=cur[pageId];
   if(v&&p>v.progress+4){write(tenant,{...cur,[pageId]:{...v,progress:p}});
    if(p>=95&&v.progress<95)window.dispatchEvent(new CustomEvent('omega-read-end',{detail:pageId}));}
  });};
  window.addEventListener('scroll',onScroll,{passive:true});
  return()=>{window.removeEventListener('scroll',onScroll);cancelAnimationFrame(raf);};
 },[tenant,pageId,enabled]);
}
