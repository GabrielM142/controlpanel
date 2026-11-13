import {useEffect,useState} from 'react';
import {Maximize2,Minimize2,Pause,Play,RotateCw} from 'lucide-react';

// Fase M7 · pantalla gigante / TV (≥ 1600 px o ?modo=mando). Reutiliza el modo presentación
// existente; agrega pantalla completa con un botón y la rotación opcional Mando → Inteligencia →
// Unidades cada 30 s, que se pausa al tocar la pantalla o usar el teclado.
export const TV_PARAM=typeof location!=='undefined'&&new URLSearchParams(location.search).get('modo')==='mando';
export const ROTATION=[{id:'nivel1',label:'Mando'},{id:'portal-inteligencia',label:'Inteligencia'},{id:'portal-unidades',label:'Unidades'}];
const STEP=30;
const KEY='nova.tv.rotate';

export function useWide(){const q='(min-width: 1600px)';const [w,setW]=useState(()=>typeof window!=='undefined'&&window.matchMedia?.(q).matches);
 useEffect(()=>{const m=window.matchMedia?.(q);if(!m)return;const on=()=>setW(m.matches);m.addEventListener('change',on);return()=>m.removeEventListener('change',on);},[]);return !!w;}

export function useTvRotation(pageId:string,navigate:(id:string)=>void,enabled:boolean){
 const [on,setOn]=useState(()=>{try{return localStorage.getItem(KEY)==='on';}catch{return false;}});
 const [paused,setPaused]=useState(false);
 const [left,setLeft]=useState(STEP);
 const idx=ROTATION.findIndex(r=>r.id===pageId);
 const active=enabled&&on&&!paused&&idx>=0;
 useEffect(()=>{try{localStorage.setItem(KEY,on?'on':'off');}catch{}},[on]);
 // Plazo absoluto por vista: cada página nueva (o reanudar) reinicia los 30 s; avanza una sola vez.
 useEffect(()=>{setLeft(STEP);if(!active)return;const until=Date.now()+STEP*1000;let gone=false;
  const t=setInterval(()=>{const s=Math.ceil((until-Date.now())/1000);setLeft(s);
   if(s<=0&&!gone){gone=true;clearInterval(t);navigate(ROTATION[(idx+1)%ROTATION.length].id);}},1000);
  return()=>clearInterval(t);},[active,idx,navigate]);
 // Tocar, hacer clic o usar el teclado pausa la rotación (los botones de la barra la reanudan).
 useEffect(()=>{if(!active)return;const stop=(e:Event)=>{if((e.target as HTMLElement|null)?.closest?.('.tv-bar'))return;setPaused(true);};
  window.addEventListener('pointerdown',stop);window.addEventListener('keydown',stop);return()=>{window.removeEventListener('pointerdown',stop);window.removeEventListener('keydown',stop);};},[active]);
 const next=idx>=0?ROTATION[(idx+1)%ROTATION.length]:ROTATION[0];
 return {on,paused,left,next,inRotation:idx>=0,toggle:()=>{setOn(v=>!v);setPaused(false);},resume:()=>setPaused(false)};
}

export default function TvBar({rot,fullscreen,onFullscreen}:{rot:ReturnType<typeof useTvRotation>;fullscreen:boolean;onFullscreen:()=>void}){
 return <div className="tv-bar" role="group" aria-label="Pantalla gigante">
  <button type="button" className="tv-btn" onClick={onFullscreen} aria-pressed={fullscreen}>{fullscreen?<Minimize2 size={16} aria-hidden="true"/>:<Maximize2 size={16} aria-hidden="true"/>}{fullscreen?'Salir de pantalla completa':'Pantalla completa'}</button>
  <button type="button" className={`tv-btn${rot.on?' is-on':''}`} onClick={rot.toggle} aria-pressed={rot.on}><RotateCw size={16} aria-hidden="true"/>Rotación 30 s</button>
  {rot.on&&rot.inRotation&&(rot.paused
   ?<button type="button" className="tv-btn is-paused" onClick={rot.resume}><Play size={16} aria-hidden="true"/>En pausa · reanudar</button>
   :<span className="tv-next" aria-live="off"><Pause size={14} aria-hidden="true"/>Toca para pausar · {rot.next.label} en {Math.max(0,rot.left)} s</span>)}
 </div>;
}
