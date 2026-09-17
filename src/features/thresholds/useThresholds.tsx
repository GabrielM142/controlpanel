import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';

export type ThresholdArea='comercial'|'financiero'|'compras'|'inventarios'|'soporte';
export type ThresholdOperator='>='|'<='|'>'|'<';
export type ThresholdTone='r'|'a';

export type ThresholdRule={
 id:string;
 area:ThresholdArea;
 label:string;
 metric:string;
 unit:string;
 current:number;
 threshold:number;
 defaultThreshold:number;
 operator:ThresholdOperator;
 tone:ThresholdTone;
 enabled:boolean;
 linkedPageId:string;
 description:string;
};

export const AREA_LABEL:Record<ThresholdArea,string>={
 comercial:'Comercial · Ventas',
 financiero:'Financiero · Cartera',
 compras:'Compras · Proveedores',
 inventarios:'Inventarios · Stock',
 soporte:'Soporte · SLA',
};

// Boceto defaults: current values are mocked to match the existing report figures.
const DEFAULTS:ThresholdRule[]=[
 {id:'com-meta-mensual',area:'comercial',label:'Meta mensual mínima',metric:'Ventas del mes',unit:'USD',current:2400000,threshold:3000000,defaultThreshold:3000000,operator:'<',tone:'r',enabled:true,linkedPageId:'comercial',description:'Alerta si la facturación mensual queda por debajo del objetivo del período.'},
 {id:'com-concentracion',area:'comercial',label:'Concentración top 3 clientes',metric:'Participación del top 3',unit:'%',current:62,threshold:60,defaultThreshold:60,operator:'>=',tone:'a',enabled:true,linkedPageId:'clientes',description:'Alerta cuando los 3 mayores clientes concentran más del umbral definido.'},
 {id:'com-ticket',area:'comercial',label:'Ticket promedio mínimo',metric:'Ticket promedio',unit:'USD',current:44,threshold:42,defaultThreshold:42,operator:'<',tone:'a',enabled:true,linkedPageId:'comercial',description:'Alerta si el ticket promedio cae bajo el umbral.'},

 {id:'fin-cartera',area:'financiero',label:'Cartera vencida máxima',metric:'Cartera vencida',unit:'%',current:8.2,threshold:8,defaultThreshold:8,operator:'>',tone:'r',enabled:true,linkedPageId:'financiero',description:'Alerta cuando la cartera vencida supera el porcentaje aceptado.'},
 {id:'fin-liquidez',area:'financiero',label:'Días de liquidez proyectada',metric:'Runway operativo',unit:'días',current:45,threshold:30,defaultThreshold:30,operator:'<',tone:'r',enabled:true,linkedPageId:'financiero',description:'Alerta si la caja proyectada baja del umbral mínimo.'},
 {id:'fin-banco',area:'financiero',label:'Dependencia banco principal',metric:'Líneas revolventes',unit:'%',current:72,threshold:60,defaultThreshold:60,operator:'>=',tone:'a',enabled:true,linkedPageId:'financiero',description:'Alerta cuando la concentración con un solo banco supera el umbral.'},

 {id:'cmp-proveedores',area:'compras',label:'Concentración proveedores top 2',metric:'Compras del mes',unit:'%',current:62,threshold:55,defaultThreshold:55,operator:'>=',tone:'a',enabled:true,linkedPageId:'compras',description:'Alerta si dos proveedores concentran más del umbral aceptado.'},
 {id:'cmp-cobertura',area:'compras',label:'Cobertura de stock mínima',metric:'Días de cobertura',unit:'días',current:21,threshold:15,defaultThreshold:15,operator:'<',tone:'r',enabled:true,linkedPageId:'inventarios',description:'Alerta cuando la cobertura de inventario baja del umbral operativo.'},
 {id:'cmp-margen',area:'compras',label:'Margen negociado mínimo',metric:'Margen de compras',unit:'%',current:8.4,threshold:7,defaultThreshold:7,operator:'<',tone:'a',enabled:true,linkedPageId:'compras',description:'Alerta si el margen negociado con proveedores baja del umbral.'},

 {id:'inv-critico',area:'inventarios',label:'Stock crítico máximo (SKU)',metric:'SKU en quiebre',unit:'SKU',current:4,threshold:3,defaultThreshold:3,operator:'>',tone:'r',enabled:true,linkedPageId:'inventarios',description:'Alerta si más de X SKU pasan a stock crítico.'},
 {id:'inv-obs',area:'inventarios',label:'Obsolescencia lenta máxima',metric:'Inventario obsoleto',unit:'%',current:6.2,threshold:5,defaultThreshold:5,operator:'>',tone:'a',enabled:true,linkedPageId:'inventarios',description:'Alerta cuando el inventario obsoleto supera el umbral.'},
 {id:'inv-rotacion',area:'inventarios',label:'Rotación mínima',metric:'Rotación mensual',unit:'veces/mes',current:2.8,threshold:2.5,defaultThreshold:2.5,operator:'<',tone:'a',enabled:true,linkedPageId:'inventarios',description:'Alerta si la rotación del inventario cae bajo el umbral.'},

 {id:'sop-sla-cumpl',area:'soporte',label:'Cumplimiento de SLA mínimo',metric:'SLA cumplido',unit:'%',current:92,threshold:95,defaultThreshold:95,operator:'<',tone:'r',enabled:true,linkedPageId:'tickets',description:'Alerta si el cumplimiento del SLA queda por debajo del objetivo.'},
 {id:'sop-vencidos',area:'soporte',label:'Tickets SLA vencidos',metric:'Tickets con SLA vencido',unit:'tickets',current:1,threshold:0,defaultThreshold:0,operator:'>',tone:'r',enabled:true,linkedPageId:'tickets',description:'Alerta si hay tickets con SLA vencido.'},
 {id:'sop-respuesta',area:'soporte',label:'Tiempo respuesta máximo',metric:'Tiempo medio de respuesta',unit:'min',current:14,threshold:15,defaultThreshold:15,operator:'>',tone:'a',enabled:true,linkedPageId:'tickets',description:'Alerta si el tiempo medio de respuesta supera el umbral.'},
];

type ThresholdsState={
 rules:ThresholdRule[];
 updateThreshold:(id:string,value:number)=>void;
 toggleEnabled:(id:string,enabled:boolean)=>void;
 resetOne:(id:string)=>void;
 resetAll:()=>void;
 activeAlerts:ThresholdRule[];
 stats:{total:number;enabled:number;triggered:number;critical:number};
};

const Ctx=createContext<ThresholdsState|null>(null);
const KEY='nova.thresholds';

function isTriggered(r:ThresholdRule){
 if(!r.enabled)return false;
 switch(r.operator){
  case '>':return r.current>r.threshold;
  case '>=':return r.current>=r.threshold;
  case '<':return r.current<r.threshold;
  case '<=':return r.current<=r.threshold;
 }
}

function readStore():ThresholdRule[]{
 try{
  const raw=localStorage.getItem(KEY);
  if(!raw)return DEFAULTS;
  const parsed=JSON.parse(raw) as Partial<ThresholdRule>[];
  if(!Array.isArray(parsed))return DEFAULTS;
  // Merge stored overrides with defaults to survive schema evolutions.
  return DEFAULTS.map(def=>{const s=parsed.find(p=>p.id===def.id);return s?{...def,threshold:typeof s.threshold==='number'?s.threshold:def.threshold,enabled:typeof s.enabled==='boolean'?s.enabled:def.enabled}:def;});
 }catch{return DEFAULTS;}
}

export function ThresholdsProvider({children}:{children:ReactNode}){
 const [rules,setRules]=useState<ThresholdRule[]>(readStore);
 useEffect(()=>{try{localStorage.setItem(KEY,JSON.stringify(rules.map(r=>({id:r.id,threshold:r.threshold,enabled:r.enabled}))));}catch{}},[rules]);

 const updateThreshold=useCallback((id:string,value:number)=>{setRules(prev=>prev.map(r=>r.id===id?{...r,threshold:Number.isFinite(value)?value:r.threshold}:r));},[]);
 const toggleEnabled=useCallback((id:string,enabled:boolean)=>{setRules(prev=>prev.map(r=>r.id===id?{...r,enabled}:r));},[]);
 const resetOne=useCallback((id:string)=>{setRules(prev=>prev.map(r=>r.id===id?{...r,threshold:r.defaultThreshold,enabled:true}:r));},[]);
 const resetAll=useCallback(()=>{setRules(DEFAULTS.map(r=>({...r})));},[]);

 const activeAlerts=useMemo(()=>rules.filter(isTriggered),[rules]);
 const stats=useMemo(()=>({
  total:rules.length,
  enabled:rules.filter(r=>r.enabled).length,
  triggered:activeAlerts.length,
  critical:activeAlerts.filter(r=>r.tone==='r').length,
 }),[rules,activeAlerts]);

 const value=useMemo<ThresholdsState>(()=>({rules,updateThreshold,toggleEnabled,resetOne,resetAll,activeAlerts,stats}),[rules,updateThreshold,toggleEnabled,resetOne,resetAll,activeAlerts,stats]);
 return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useThresholds(){const v=useContext(Ctx);if(!v)throw new Error('useThresholds outside provider');return v;}
