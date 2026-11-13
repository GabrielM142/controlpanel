import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';
import {useLive} from '../live/LiveData';

export type Tenant={id:string;monogram:string;name:string;subtitle:string;sector:string};

// DEMO catalog (labelled example companies). In live mode the list comes from
// the server memberships; the selector is UX only — the API re-checks every call.
const demoCatalog:Tenant[]=[
 {id:'juj',monogram:'E',name:'Empresa Demo',subtitle:'Empresa de demostración',sector:'Retail & Mayorista'},
 {id:'coand',monogram:'CA',name:'Comercial Andes',subtitle:'Grupo Andes Distribución',sector:'Distribución nacional'},
 {id:'ware',monogram:'W',name:'Grupo Warenhaus',subtitle:'Warenhaus S.A.',sector:'Retail especializado'},
 {id:'chai',monogram:'CH',name:'Chaide & Chaide',subtitle:'Colchones & Muebles',sector:'Manufactura'},
];

type TenantsState={
 catalog:Tenant[];
 active:Tenant;
 setActive:(id:string)=>void;
 live:boolean;
};

const Ctx=createContext<TenantsState|null>(null);
const KEY='nova.tenant';
const ROLE:Record<string,string>={owner:'Propietario',admin:'Administrador',analyst:'Analista',viewer:'Lectura'};
const mono=(name:string)=>name.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()||'N';

export function TenantsProvider({children}:{children:ReactNode}){
 const live=useLive();
 const [id,setId]=useState<string>(()=>{try{return localStorage.getItem(KEY)||demoCatalog[0].id;}catch{return demoCatalog[0].id;}});
 useEffect(()=>{if(!live.live){try{localStorage.setItem(KEY,id);}catch{}}},[id,live.live]);
 const catalog=useMemo<Tenant[]>(()=>live.live
  ?live.memberships.map(m=>({id:m.tenant_id,monogram:mono(m.name),name:m.name,subtitle:ROLE[m.role]||m.role,sector:`Plan ${m.plan}`}))
  :demoCatalog,[live.live,live.memberships]);
 const activeId=live.live?live.tenantId:id;
 const active=catalog.find(t=>t.id===activeId)||catalog[0]||{id:'',monogram:'N',name:'Sin empresa',subtitle:'Sin membresías',sector:''};
 const setActive=useCallback((next:string)=>{if(live.live)live.setTenant(next);else if(demoCatalog.some(t=>t.id===next))setId(next);},[live]);
 const value=useMemo<TenantsState>(()=>({catalog,active,setActive,live:live.live}),[catalog,active,setActive,live.live]);
 return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTenants(){const v=useContext(Ctx);if(!v)throw new Error('useTenants outside provider');return v;}
