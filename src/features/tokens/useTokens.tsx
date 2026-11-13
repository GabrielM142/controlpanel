import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {api} from '../../data/api';
import {useLive} from '../live/LiveData';

export type TokensState={
 monthlyBudget:number;
 used:number;
 plan:string;
 nextReset:string;
 remaining:number;
 percentUsed:number;
 spend:(cost:number,reason:string)=>boolean;
 history:{at:string;cost:number;reason:string}[];
 simulated:boolean;
};
type Usage={plan_name:string;label:string;quota:number|null;used:{truekens:number;questions:number}};

// LOCAL SIMULATION (boceto): not a billing ledger. Real plans/quotas live in the
// server ledger (app.token_ledger: reserve -> commit/refund, idempotent).
const DEFAULT_BUDGET=1000;
const PLAN_LABEL='Plan Gerencia Nova (simulado)';
const period=()=>new Date().toISOString().slice(0,7);
function firstOfNextMonth(){const d=new Date();return new Date(d.getFullYear(),d.getMonth()+1,1).toISOString().slice(0,10);}
const read=(k:string)=>{try{return localStorage.getItem(k);}catch{return null;}};
const write=(k:string,v:string)=>{try{localStorage.setItem(k,v);}catch{}};

const Ctx=createContext<TokensState|null>(null);

export function TokensProvider({children}:{children:ReactNode}){
 // Period change resets the simulated spend (previously it never reset).
 const samePeriod=read('nova.tokens.period')===period();
 const [used,setUsed]=useState<number>(()=>samePeriod?Math.max(0,parseInt(read('nova.tokens.used')||'0',10)||0):0);
 const [history,setHistory]=useState<{at:string;cost:number;reason:string}[]>(()=>{if(!samePeriod)return [];try{const p=JSON.parse(read('nova.tokens.history')||'[]');if(Array.isArray(p))return p.slice(0,40);}catch{}return [];});
 const [nextReset]=useState(firstOfNextMonth);
 const usedRef=useRef(used);

 useEffect(()=>{write('nova.tokens.used',String(used));write('nova.tokens.period',period());},[used]);
 useEffect(()=>{write('nova.tokens.history',JSON.stringify(history.slice(0,40)));},[history]);

 const spend=useCallback((cost:number,reason:string)=>{
  const c=Math.max(1,Math.round(cost));
  // Decide synchronously from the ref: the return value is now reliable for callers.
  if(usedRef.current+c>DEFAULT_BUDGET)return false;
  usedRef.current+=c;
  setUsed(usedRef.current);
  setHistory(prev=>[{at:new Date().toISOString(),cost:c,reason},...prev].slice(0,40)); // only successful spends are recorded
  return true;
 },[]);

 // Live: Truekens of the company this month against its plan quota (server ledger); the server
 // decides whether a question can be asked, the browser never blocks it.
 const {live,tenantId}=useLive();
 const [usage,setUsage]=useState<Usage|null>(null);
 const refresh=useCallback(()=>{if(live&&tenantId)api<Usage>('/api/plan',{tenant:tenantId}).then(setUsage).catch(()=>{});},[live,tenantId]);
 useEffect(()=>{refresh();},[refresh]);
 const value=useMemo<TokensState>(()=>{
  if(live&&usage){
   const used=Math.round(usage.used.truekens);const quota=usage.quota;
   return {monthlyBudget:quota??used,used,plan:`${usage.label} · plan ${usage.plan_name} · ${usage.used.questions} preguntas este mes`,nextReset:'el 1 de cada mes',
    remaining:quota===null?Infinity:Math.max(0,quota-used),percentUsed:quota?Math.min(100,used/quota*100):0,
    spend:(_c:number,_r:string)=>{setTimeout(refresh,8000);return true;},history:[],simulated:false};
  }  const remaining=Math.max(0,DEFAULT_BUDGET-used);
  return {monthlyBudget:DEFAULT_BUDGET,used,plan:PLAN_LABEL,nextReset,remaining,percentUsed:Math.min(100,used/DEFAULT_BUDGET*100),spend,history,simulated:true};
 },[used,history,nextReset,spend,live,usage,refresh]);

 return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTokens(){const v=useContext(Ctx);if(!v)throw new Error('useTokens outside provider');return v;}
