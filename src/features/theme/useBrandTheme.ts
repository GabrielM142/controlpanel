import {createContext,createElement,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';
import {api} from '../../data/api';
import {useLive} from '../live/LiveData';

// Tema por empresa: con el panel conectado, color de marca y logo se guardan en el servidor
// (/api/tenant/theme, compartidos por toda la empresa); el modo claro/oscuro es de cada usuario.
// localStorage["nova.theme.<tenantId>"] guarda la copia local (y todo el tema en modo demo).
// Aplica --brand, --on-brand (contraste WCAG ≥ 4.5) y data-mode en <html>. La marca nunca pinta datos:
// los colores financieros (--fin-*) son fijos. Los colores se leen de omega-tokens.css (sin hex aquí).
export type BrandMode='dark'|'light'|'auto';
export type BrandTheme={brandColor:string;mode:BrandMode;logo?:string};
/** Logo local (SVG o PNG), como data URL en este navegador. Se muestra con <img>: nunca se ejecuta. */
export const LOGO_MAX_BYTES=200*1024;

const css=(name:string)=>{try{return getComputedStyle(document.documentElement).getPropertyValue(name).trim();}catch{return '';}};
export const SWATCHES=[
 {id:'indigo',name:'Índigo'},{id:'azul',name:'Azul real'},{id:'magenta',name:'Magenta'},{id:'grafito',name:'Grafito'},
 {id:'esmeralda',name:'Esmeralda'},{id:'coral',name:'Coral'},{id:'turquesa',name:'Turquesa'},{id:'violeta',name:'Violeta'},
] as const;
export const swatchHex=(id:string)=>css(`--swatch-${id}`).toLowerCase();
export const FINANCIAL=[
 {token:'--fin-income',label:'Ingresos',why:'Siempre verde: a favor'},{token:'--fin-loss',label:'Costos y pérdidas',why:'Siempre rojo: urgente'},
 {token:'--fin-goal',label:'Meta y presupuesto',why:'Siempre dorado'},{token:'--fin-cash',label:'Caja y liquidez',why:'Siempre cian'},
 {token:'--fin-risk',label:'Riesgo · por vencer',why:'Siempre naranja'},{token:'--fin-ai',label:'Omega IA',why:'Siempre lila'},
];

export function hexToRgb(hex:string):[number,number,number]|null{
 const m=/^#?([0-9a-f]{6})$/i.exec(hex.trim());if(!m)return null;
 const n=parseInt(m[1],16);return [(n>>16)&255,(n>>8)&255,n&255];
}
function luminance([r,g,b]:[number,number,number]){const f=(c:number)=>{c/=255;return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4;};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);}
export function contrast(a:string,b:string){const x=hexToRgb(a),y=hexToRgb(b);if(!x||!y)return 1;const l1=luminance(x),l2=luminance(y);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);}
function hsl([r,g,b]:[number,number,number]){r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,l=(max+min)/2;
 let h=0;if(d)h=max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;return {h:(h*60+360)%360,s:d?d/(1-Math.abs(2*l-1)):0,l};}

/** Text on brand: white or dark, whichever passes WCAG AA (≥ 4.5:1); returns the chosen one and its ratio. */
export function onBrandFor(brand:string){
 const light=css('--on-brand-light')||'white',dark=css('--on-brand-dark');
 const rl=contrast(brand,light),rd=contrast(brand,dark);
 return rl>=4.5||rl>=rd?{on:light,ratio:rl,name:'blanco'}:{on:dark,ratio:rd,name:'oscuro'};
}
/** Hue clash (< 18°) with a fixed financial color: the brand must never look like data. */
export function hueClash(brand:string){
 const b=hexToRgb(brand);if(!b)return null;const hb=hsl(b);if(hb.s<0.25)return null;
 for(const f of FINANCIAL){const c=hexToRgb(css(f.token));if(!c)continue;const hf=hsl(c);const d=Math.min(Math.abs(hb.h-hf.h),360-Math.abs(hb.h-hf.h));if(d<18)return f.label;}
 return null;
}

const keyFor=(tenantId:string)=>`nova.theme.${tenantId}`;
export function readTheme(tenantId:string):BrandTheme{
 const fallback:BrandTheme={brandColor:swatchHex('indigo')||'',mode:'dark'};
 try{const v=JSON.parse(localStorage.getItem(keyFor(tenantId))||'null');if(v&&hexToRgb(v.brandColor||'')&&['dark','light','auto'].includes(v.mode))return {brandColor:v.brandColor,mode:v.mode,logo:typeof v.logo==='string'&&/^data:image\/(png|svg\+xml);base64,/.test(v.logo)?v.logo:undefined};}catch{}
 try{if(localStorage.getItem('nova.theme')==='light')fallback.mode='light';}catch{}
 return fallback;
}
export function applyTheme(t:BrandTheme){
 const root=document.documentElement;
 if(t.brandColor){const {on}=onBrandFor(t.brandColor);root.style.setProperty('--brand',t.brandColor);root.style.setProperty('--on-brand',on);}
 const prefersLight=typeof window!=='undefined'&&window.matchMedia?.('(prefers-color-scheme: light)').matches;
 root.dataset.mode=t.mode==='auto'?(prefersLight?'light':'dark'):t.mode;
 root.dataset.theme='dark'; // OMEGA skin (light is a mode of the same skin)
}

type Ctx={theme:BrandTheme;save:(t:BrandTheme)=>Promise<void>;reset:()=>Promise<void>;toggleMode:()=>void;tenantId:string;shared:boolean;canEdit:boolean};
const BrandCtx=createContext<Ctx|null>(null);

export function BrandThemeProvider({tenantId,children}:{tenantId:string;children:ReactNode}){
 const [theme,setTheme]=useState<BrandTheme>(()=>readTheme(tenantId));
 const {live}=useLive();
 const [canEdit,setCanEdit]=useState(!live);
 // Live: the company brand comes from the server; the personal mode stays local.
 useEffect(()=>{
  if(!live||!tenantId||tenantId==='demo')return;let off=false;
  api<{brand_color:string|null;logo:string|null;can_edit:boolean}>('/api/tenant/theme',{tenant:tenantId}).then(r=>{if(off)return;setCanEdit(r.can_edit);
   if(!r.brand_color)return;const local=readTheme(tenantId);const t:BrandTheme={brandColor:r.brand_color,mode:local.mode,logo:r.logo||undefined};
   try{localStorage.setItem(keyFor(tenantId),JSON.stringify(t));}catch{}setTheme(t);}).catch(()=>{});
  return()=>{off=true;};
 },[live,tenantId]);
 // Re-apply when the company changes (TenantSwitcher): brand changes, financial colors never do.
 useEffect(()=>{const t=readTheme(tenantId);setTheme(t);applyTheme(t);},[tenantId]);
 useEffect(()=>{applyTheme(theme);if(theme.mode!=='auto')return;const mq=window.matchMedia?.('(prefers-color-scheme: light)');const on=()=>applyTheme(theme);mq?.addEventListener?.('change',on);return()=>mq?.removeEventListener?.('change',on);},[theme]);
 const save=useCallback(async(t:BrandTheme)=>{
  if(live&&canEdit)await api('/api/tenant/theme',{tenant:tenantId,method:'PUT',body:{brand_color:t.brandColor,logo:t.logo||null}});
  try{localStorage.setItem(keyFor(tenantId),JSON.stringify(t));localStorage.setItem('nova.theme',t.mode==='light'?'light':'dark');}catch{}setTheme(t);
 },[tenantId,live,canEdit]);
 const reset=useCallback(async()=>{
  if(live&&canEdit)await api('/api/tenant/theme',{tenant:tenantId,method:'DELETE'});
  try{localStorage.removeItem(keyFor(tenantId));}catch{}const t={brandColor:swatchHex('indigo'),mode:'dark' as BrandMode};setTheme(t);
 },[tenantId,live,canEdit]);
 const toggleMode=useCallback(()=>{setTheme(prev=>{const next:BrandTheme={...prev,mode:document.documentElement.dataset.mode==='light'?'dark':'light'};try{localStorage.setItem(keyFor(tenantId),JSON.stringify(next));localStorage.setItem('nova.theme',next.mode);}catch{}return next;});},[tenantId]);
 const value=useMemo(()=>({theme,save,reset,toggleMode,tenantId,shared:live,canEdit}),[theme,save,reset,toggleMode,tenantId,live,canEdit]);
 return createElement(BrandCtx.Provider,{value},children);
}

export function useBrandTheme(){const v=useContext(BrandCtx);if(!v)throw new Error('useBrandTheme outside provider');return v;}
