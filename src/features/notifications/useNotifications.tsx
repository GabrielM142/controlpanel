import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';
import {api} from '../../data/api';
import {useLive} from '../live/LiveData';

// Server notifications of the user in the active company (thresholds, tickets, Truekens, closes).
export type Notice={id:number;kind:string;severity:'critica'|'atencion'|'info';title:string;body:string|null;page_id:string|null;created_at:string;read_at:string|null};
type Payload={items:Notice[];unread:number;unread_by_kind:Record<string,number>;muted:string[];kinds:string[]};
type Ctx={data:Payload|null;error:string|null;refresh:()=>void;markRead:(ids:number[]|'all')=>Promise<void>;setMuted:(kinds:string[])=>Promise<void>};
const NotifCtx=createContext<Ctx>({data:null,error:null,refresh:()=>{},markRead:async()=>{},setMuted:async()=>{}});
export const KIND_LABEL:Record<string,string>={umbral:'Umbrales',ticket:'Tickets',truekens:'Truekens',presupuesto:'Presupuesto',datos:'Cierres de datos',decision:'Decisiones',sistema:'Sistema'};

export function NotificationsProvider({children}:{children:ReactNode}){
 const {live,tenantId,status}=useLive();
 const [data,setData]=useState<Payload|null>(null);
 const [error,setError]=useState<string|null>(null);
 const refresh=useCallback(()=>{if(!live||!tenantId)return;api<Payload>('/api/notifications',{tenant:tenantId}).then(r=>{setData(r);setError(null);}).catch(e=>setError((e as Error).message));},[live,tenantId]);
 const version=status?.published?.version;
 useEffect(()=>{refresh();if(!live)return;const t=setInterval(refresh,120000);return()=>clearInterval(t);},[refresh,live,version]);
 const markRead=useCallback(async(ids:number[]|'all')=>{if(!tenantId)return;await api('/api/notifications/read',{tenant:tenantId,method:'POST',body:ids==='all'?{all:true}:{ids}});refresh();},[tenantId,refresh]);
 const setMuted=useCallback(async(kinds:string[])=>{if(!tenantId)return;await api('/api/notifications/prefs',{tenant:tenantId,method:'PUT',body:{muted:kinds}});refresh();},[tenantId,refresh]);
 const value=useMemo(()=>({data,error,refresh,markRead,setMuted}),[data,error,refresh,markRead,setMuted]);
 return <NotifCtx.Provider value={value}>{children}</NotifCtx.Provider>;
}
export function useNotifications(){return useContext(NotifCtx);}
