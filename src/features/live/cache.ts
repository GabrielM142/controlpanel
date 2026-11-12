import {api} from '../../data/api';

// Browser cache for published NOVA data. A response is fetched once per
// (tenant, path, published version) and then served from the browser: switching
// views, going back or repeating a filter never hits the server again. A new
// nightly publication changes the version and naturally invalidates everything.
// Memory first, then sessionStorage (survives a page reload, dies with the tab,
// never shared across tabs or users). Cleared on logout.
const PREFIX='nova.cache.v1:';
const MAX_ENTRIES=80;
const mem=new Map<string,unknown>();
const inflight=new Map<string,Promise<unknown>>();

const keyOf=(tenant:string,path:string,version:number|string)=>`${tenant}|${version}|${path}`;

function readSession(key:string):unknown{
 try{const raw=sessionStorage.getItem(PREFIX+key);return raw?JSON.parse(raw):undefined;}catch{return undefined;}
}
function writeSession(key:string,value:unknown){
 try{sessionStorage.setItem(PREFIX+key,JSON.stringify(value));}
 catch{ // quota: drop the oldest cached responses and keep going in memory
  try{const ks=Object.keys(sessionStorage).filter(k=>k.startsWith(PREFIX));ks.slice(0,Math.ceil(ks.length/2)).forEach(k=>sessionStorage.removeItem(k));}catch{}
 }
}
function remember(key:string,value:unknown){
 mem.delete(key);mem.set(key,value);
 while(mem.size>MAX_ENTRIES){const first=mem.keys().next().value as string;mem.delete(first);try{sessionStorage.removeItem(PREFIX+first);}catch{}}
 writeSession(key,value);
}

/** Drop entries of other publications for this tenant: they can never be served again. */
function prune(tenant:string,version:number|string){
 const keep=`${tenant}|${version}|`;
 for(const k of [...mem.keys()])if(k.startsWith(`${tenant}|`)&&!k.startsWith(keep))mem.delete(k);
 try{for(const k of Object.keys(sessionStorage))if(k.startsWith(PREFIX+`${tenant}|`)&&!k.startsWith(PREFIX+keep))sessionStorage.removeItem(k);}catch{}
}

/** Synchronous lookup, so a cached view paints on the first render without a loading state. */
export function peekCached<T>(tenant:string|null,path:string,version:number|string|null|undefined):T|undefined{
 if(!tenant||version==null)return undefined;
 const key=keyOf(tenant,path,version);
 if(mem.has(key))return mem.get(key) as T;
 const v=readSession(key);if(v!==undefined)mem.set(key,v);
 return v as T|undefined;
}

/** GET through the cache. Without a known publication version the request goes to the server and is not stored. */
export function cachedGet<T>(tenant:string,path:string,version:number|string|null|undefined):Promise<T>{
 if(version==null)return api<T>(path,{tenant});
 const key=keyOf(tenant,path,version);
 const hit=peekCached<T>(tenant,path,version);
 if(hit!==undefined)return Promise.resolve(hit);
 const pending=inflight.get(key);
 if(pending)return pending as Promise<T>;
 prune(tenant,version);
 const p=api<T>(path,{tenant}).then(v=>{remember(key,v);return v;}).finally(()=>inflight.delete(key));
 inflight.set(key,p);
 return p;
}

export function clearCache(){
 mem.clear();inflight.clear();
 try{for(const k of Object.keys(sessionStorage))if(k.startsWith(PREFIX))sessionStorage.removeItem(k);}catch{}
}
