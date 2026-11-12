// Browser client for the NOVA API only (never Odoo, never PostgreSQL, no ERP
// credentials). Live mode requires VITE_NOVA_API_URL at build time; without it
// the app runs in explicit DEMO mode with labelled example data.
export const API_URL:string=(import.meta.env.VITE_NOVA_API_URL||'').replace(/\/$/,'');
export const IS_LIVE=API_URL.length>0;

export class ApiError extends Error{constructor(public status:number,message:string){super(message);}}

export async function api<T=unknown>(path:string,{tenant,method='GET',body,headers={}}:{tenant?:string|null;method?:string;body?:unknown;headers?:Record<string,string>}={}):Promise<T>{
 const h:Record<string,string>={Accept:'application/json','X-Nova-Request':'1',...headers};
 if(tenant)h['X-Nova-Tenant']=tenant;
 if(body!==undefined)h['Content-Type']='application/json';
 let r:Response;
 try{r=await fetch(`${API_URL}${path}`,{method,headers:h,credentials:'include',body:body===undefined?undefined:JSON.stringify(body)});}
 catch{throw new ApiError(0,'No se pudo contactar el servidor NOVA.');}
 const text=await r.text();
 let data:unknown=null;try{data=text?JSON.parse(text):null;}catch{}
 if(!r.ok)throw new ApiError(r.status,(data as {error?:string})?.error||`Error ${r.status}`);
 return data as T;
}

export async function download(path:string,tenant:string,filename:string){
 const r=await fetch(`${API_URL}${path}`,{headers:{'X-Nova-Tenant':tenant,'X-Nova-Request':'1'},credentials:'include'});
 if(!r.ok)throw new ApiError(r.status,'No se pudo exportar');
 const url=URL.createObjectURL(await r.blob());
 const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export type Membership={tenant_id:string;role:'owner'|'admin'|'analyst'|'viewer';slug:string;name:string;mode:string;timezone:string;plan:string};
export type Published={version:number;business_date:string|null;published_at:string;consistency:string;sources:Record<string,{business_date:string;observed_from:string;observed_to:string;run_seq:number}>};
export type SourceStatus={id:string;name:string;status:string;last_collect_at:string|null;next_collect_at:string|null;last_error:string|null;consecutive_failures:number;last_run:{run_seq:number;state:string;business_date:string;observed_from:string;observed_to:string;published_at:string|null;error:string|null}|null};
export type StatusPayload={mode:'live';published:Published|null;sources:SourceStatus[];quality:{check_name:string;dataset:string|null;status:string;n:number}[]};
export type Widget=
 |{kind:'kpi'|'metric';value:string;raw:string|null;deltas:{label:string;value:string;tone:string}[];metric?:string;note?:string}
 |{kind:'table';rows:string[][]}
 |{kind:'bars';rows:{n:string;v:number;vt:string}[]}
 |{kind:'toggle';data:Record<string,{n:string;v:number;vt:string}[]>;note?:string}
 |{kind:'geo';rows:GeoRow[];note?:string}
 |{kind:'missing';reason:string};
export type GeoRow={n:string;v:number;clientes:number;ticket:string;rent:string;children?:GeoRow[]};
export type ReportPayload={mode:'live';published:Published|null;widgets:Record<string,Widget>};
