import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';

export type TokensState={
 monthlyBudget:number;
 used:number;
 plan:string;
 nextReset:string;
 remaining:number;
 percentUsed:number;
 spend:(cost:number,reason:string)=>boolean;
 history:{at:string;cost:number;reason:string}[];
};

// Boceto values: managerial plan resets on the 1st of the next month.
const DEFAULT_BUDGET=1000;
const PLAN_LABEL='Plan Gerencia Nova';

function firstOfNextMonth(){const d=new Date();return new Date(d.getFullYear(),d.getMonth()+1,1).toISOString().slice(0,10);}

const Ctx=createContext<TokensState|null>(null);

export function TokensProvider({children}:{children:ReactNode}){
 const [used,setUsed]=useState<number>(()=>{try{return Math.max(0,parseInt(localStorage.getItem('nova.tokens.used')||'0',10)||0);}catch{return 0;}});
 const [history,setHistory]=useState<{at:string;cost:number;reason:string}[]>(()=>{try{const raw=localStorage.getItem('nova.tokens.history');if(raw){const p=JSON.parse(raw);if(Array.isArray(p))return p.slice(0,40);}}catch{}return [];});
 const [nextReset]=useState(firstOfNextMonth);

 useEffect(()=>{try{localStorage.setItem('nova.tokens.used',String(used));}catch{}},[used]);
 useEffect(()=>{try{localStorage.setItem('nova.tokens.history',JSON.stringify(history.slice(0,40)));}catch{}},[history]);

 const spend=useCallback((cost:number,reason:string)=>{
  const c=Math.max(1,Math.round(cost));
  let ok=false;
  setUsed(prev=>{if(prev+c>DEFAULT_BUDGET){ok=false;return prev;}ok=true;return prev+c;});
  setHistory(prev=>[{at:new Date().toISOString(),cost:c,reason},...prev].slice(0,40));
  return ok;
 },[]);

 const value=useMemo<TokensState>(()=>{
  const remaining=Math.max(0,DEFAULT_BUDGET-used);
  return {monthlyBudget:DEFAULT_BUDGET,used,plan:PLAN_LABEL,nextReset,remaining,percentUsed:Math.min(100,used/DEFAULT_BUDGET*100),spend,history};
 },[used,history,nextReset,spend]);

 return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTokens(){const v=useContext(Ctx);if(!v)throw new Error('useTokens outside provider');return v;}
