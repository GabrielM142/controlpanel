import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';

export type Tenant={id:string;monogram:string;name:string;subtitle:string;sector:string};

const catalog:Tenant[]=[
 {id:'juj',monogram:'J',name:'JUJ',subtitle:'José Ugalde Jerves',sector:'Retail & Mayorista'},
 {id:'coand',monogram:'CA',name:'Comercial Andes',subtitle:'Grupo Andes Distribución',sector:'Distribución nacional'},
 {id:'ware',monogram:'W',name:'Grupo Warenhaus',subtitle:'Warenhaus S.A.',sector:'Retail especializado'},
 {id:'chai',monogram:'CH',name:'Chaide & Chaide',subtitle:'Colchones & Muebles',sector:'Manufactura'},
];

type TenantsState={
 catalog:Tenant[];
 active:Tenant;
 setActive:(id:string)=>void;
};

const Ctx=createContext<TenantsState|null>(null);
const KEY='nova.tenant';

export function TenantsProvider({children}:{children:ReactNode}){
 const [id,setId]=useState<string>(()=>{try{return localStorage.getItem(KEY)||catalog[0].id;}catch{return catalog[0].id;}});
 useEffect(()=>{try{localStorage.setItem(KEY,id);}catch{}},[id]);
 const active=catalog.find(t=>t.id===id)||catalog[0];
 const setActive=useCallback((next:string)=>{if(catalog.some(t=>t.id===next))setId(next);},[]);
 const value=useMemo<TenantsState>(()=>({catalog,active,setActive}),[active,setActive]);
 return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTenants(){const v=useContext(Ctx);if(!v)throw new Error('useTenants outside provider');return v;}
