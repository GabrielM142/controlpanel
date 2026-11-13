import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';
import {api,ApiError,IS_LIVE,type Membership,type ReportPayload,type StatusPayload,type Widget} from '../../data/api';
import {cachedGet,clearCache,peekCached} from './cache';

type User={id:string;email:string;name:string;platform_admin?:boolean};
type LiveState={
 live:boolean;
 loading:boolean;
 user:User|null;
 memberships:Membership[];
 tenantId:string|null;
 membership:Membership|null;
 setTenant:(id:string)=>void;
 status:StatusPayload|null;
 statusError:string|null;
 refreshStatus:()=>Promise<void>;
 login:(email:string,password:string)=>Promise<void>;
 logout:()=>Promise<void>;
};

const Ctx=createContext<LiveState>({live:false,loading:false,user:null,memberships:[],tenantId:null,membership:null,setTenant:()=>{},status:null,statusError:null,refreshStatus:async()=>{},login:async()=>{},logout:async()=>{}});
const TENANT_KEY='nova.live.tenant';

export function LiveProvider({children}:{children:ReactNode}){
 const [loading,setLoading]=useState(IS_LIVE);
 const [user,setUser]=useState<User|null>(null);
 const [memberships,setMemberships]=useState<Membership[]>([]);
 const [tenantId,setTenantId]=useState<string|null>(null);
 const [status,setStatus]=useState<StatusPayload|null>(null);
 const [statusError,setStatusError]=useState<string|null>(null);

 const adopt=useCallback((u:User|null,ms:Membership[])=>{
  setUser(u);setMemberships(ms);
  let saved:string|null=null;try{saved=sessionStorage.getItem(TENANT_KEY);}catch{}
  setTenantId(ms.find(m=>m.tenant_id===saved)?.tenant_id||ms[0]?.tenant_id||null);
 },[]);

 useEffect(()=>{
  if(!IS_LIVE)return;
  api<{user:User;memberships:Membership[]}>('/api/session').then(s=>adopt(s.user,s.memberships)).catch(()=>adopt(null,[])).finally(()=>setLoading(false));
 },[adopt]);

 const refreshStatus=useCallback(async()=>{
  if(!IS_LIVE||!tenantId)return;
  try{setStatus(await api<StatusPayload>('/api/status',{tenant:tenantId}));setStatusError(null);}
  catch(e){setStatusError((e as Error).message);if(e instanceof ApiError&&e.status===401)adopt(null,[]);}
 },[tenantId,adopt]);

 useEffect(()=>{setStatus(null);refreshStatus();},[refreshStatus]);

 const setTenant=useCallback((id:string)=>{
  if(!memberships.some(m=>m.tenant_id===id))return; // the server re-checks membership on every call
  try{sessionStorage.setItem(TENANT_KEY,id);}catch{}
  setTenantId(id);
 },[memberships]);

 const login=useCallback(async(email:string,password:string)=>{
  const s=await api<{user:User;memberships:Membership[]}>('/api/auth/login',{method:'POST',body:{email,password}});
  adopt(s.user,s.memberships);
 },[adopt]);
 const logout=useCallback(async()=>{try{await api('/api/auth/logout',{method:'POST'});}finally{clearCache();adopt(null,[]);setStatus(null);}},[adopt]);

 const value=useMemo<LiveState>(()=>({live:IS_LIVE,loading,user,memberships,tenantId,membership:memberships.find(m=>m.tenant_id===tenantId)||null,setTenant,status,statusError,refreshStatus,login,logout}),[loading,user,memberships,tenantId,setTenant,status,statusError,refreshStatus,login,logout]);
 return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useLive=()=>useContext(Ctx);

/** Published version used as cache key; null while the status is unknown (nothing gets cached then). */
export const versionKey=(status:StatusPayload|null):number|string|null=>status?(status.published?.version??'none'):null;

/** Report widgets for a page and filters, fetched once per publication and then served from the browser cache. Cache is keyed by tenant: switching tenant never shows the previous tenant's data. */
export function useReportData(pageId:string|null,filters:Record<string,string>){
 const {live,tenantId,status,statusError}=useLive();
 const query=new URLSearchParams(Object.entries(filters).filter(([,v])=>v)).toString();
 const path=pageId?`/api/reports/${pageId}?${query}`:'';
 const ready=!!status||!!statusError; // wait for the version so the first request is already cacheable
 const version=versionKey(status);
 const key=`${tenantId}|${path}|${version??''}`;
 const [state,setState]=useState<{key:string;data:ReportPayload|null;error:string|null;loading:boolean}>(()=>{const hit=live&&pageId?peekCached<ReportPayload>(tenantId,path,version):undefined;return {key,data:hit??null,error:null,loading:false};});
 useEffect(()=>{
  if(!live||!tenantId||!pageId||!ready)return;
  const hit=peekCached<ReportPayload>(tenantId,path,version);
  if(hit){setState({key,data:hit,error:null,loading:false});return;}
  let cancelled=false;
  setState(s=>({key,data:s.key.split('|')[0]===tenantId?s.data:null,error:null,loading:true}));
  cachedGet<ReportPayload>(tenantId,path,version)
   .then(data=>{if(!cancelled)setState({key,data,error:null,loading:false});})
   .catch(e=>{if(!cancelled)setState({key,data:null,error:(e as Error).message,loading:false});});
  return()=>{cancelled=true;};
 },[key,live,tenantId,pageId,path,version,ready]);
 if(live&&pageId&&!ready)return {key,data:null,error:null,loading:true};
 return state;
}

export type LiveWidgets={live:boolean;loading:boolean;widgets:Record<string,Widget>|null;ids:WeakMap<object,string>};
export const WidgetsContext=createContext<LiveWidgets>({live:false,loading:false,widgets:null,ids:new WeakMap()});
