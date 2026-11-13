import {useEffect,useSyncExternalStore} from 'react';

// Apariencia del panel (Fase M): "mando" (oscuro espacial, predeterminado para gerencia) o
// "era" (Nueva era). Preferencia personal del navegador en localStorage["nova.skin"]; sin
// elección, la decide el rol: propietario y administrador ven Mando.
export type Skin='mando'|'era';
const KEY='nova.skin';
const listeners=new Set<()=>void>();
/** Elección guardada por el usuario, o null si deja que decida su rol. */
export const readSkin=():Skin|null=>{try{const v=localStorage.getItem(KEY);return v==='mando'||v==='era'?v:null;}catch{return null;}};
/** Aplica el estilo en <html data-skin>; sin elección, Mando (se ajusta al rol al entrar). */
export function applySkin(s:Skin|null){
 document.documentElement.dataset.skin=s??'mando';
 window.dispatchEvent(new Event('omega-skin'));
}
export function setSkin(s:Skin|null){
 try{if(s)localStorage.setItem(KEY,s);else localStorage.removeItem(KEY);}catch{}
 listeners.forEach(l=>l());
}
const subscribe=(l:()=>void)=>{listeners.add(l);return()=>{listeners.delete(l);};};

/** Skin efectivo para el rol dado; además lo aplica en <html data-skin>. */
export function useSkin(role?:string|null):{skin:Skin;chosen:Skin|null}{
 const chosen=useSyncExternalStore(subscribe,readSkin,()=>null);
 const gerencia=!role||role==='owner'||role==='admin';
 const skin:Skin=chosen??(gerencia?'mando':'era');
 useEffect(()=>{applySkin(skin);},[skin]);
 return {skin,chosen};
}
