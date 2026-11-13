import {useCallback,useEffect,useState} from 'react';
import {Coins,Download,Loader2,Users} from 'lucide-react';
import {api,download} from '../../data/api';
import {useLive} from '../live/LiveData';

// Consumo de Truekens: evidencia para el gerente de quién usó Omega IA, cuándo, para qué y cuántos
// Truekens. La conversión desde tokens es interna de OMEGA: aquí solo se muestran Truekens.
type Entry={at:string;user_name:string;page_id:string|null;feature:string;question:string|null;provider:string|null;model:string|null;
 truekens:number|null};
type Data={plan:{plan_name:string;status:string;quota:number|null;label:string};used:{truekens:number;questions:number};scope:'empresa'|'propio';month:string;
 byUser:{name:string;email:string|null;questions:number;truekens:number}[];byPage:{page_id:string;feature:string;questions:number;truekens:number}[];entries:Entry[]};
const n=(v:number|null|undefined,d=0)=>v===null||v===undefined?'—':v.toLocaleString('es-EC',{maximumFractionDigits:d});

export default function TruekensView(){
 const {live,tenantId,membership}=useLive();
 const [mes,setMes]=useState(new Date().toISOString().slice(0,7));
 const [data,setData]=useState<Data|null>(null);
 const [err,setErr]=useState<string|null>(null);
 const load=useCallback(async()=>{if(!live||!tenantId)return;setErr(null);try{setData(await api<Data>(`/api/truekens?mes=${mes}`,{tenant:tenantId}));}catch(e){setErr((e as Error).message);}},[live,tenantId,mes]);
 useEffect(()=>{load();},[load]);
 if(!live)return <section className="panel"><div className="panel-body"><p className="legend-note">Vista de demostración. Con el panel conectado, aquí ves cuántos Truekens usó cada persona de tu empresa y en qué.</p></div></section>;
 if(err)return <section className="panel"><div className="panel-body"><p className="legend-note om-ai-error" role="alert">{err}</p></div></section>;
 if(!data)return <section className="panel" aria-busy="true"><div className="panel-body"><p className="legend-note"><Loader2 size={14} className="om-spin"/> Cargando consumo…</p></div></section>;
 const L=data.plan.label;const q=data.plan.quota;const pct=q?Math.min(100,data.used.truekens/q*100):null;
 const admin=membership?.role==='owner'||membership?.role==='admin';
 return <div className="om-tk-view">
  <div className="om-ai-actions om-tkn-bar">
   <label htmlFor="tkn-mes" className="om-mkt-label"><span>Mes</span><input id="tkn-mes" type="month" value={mes} onChange={e=>setMes(e.target.value)}/></label>
   {admin&&<button type="button" className="button secondary" onClick={()=>download(`/api/truekens.csv?mes=${mes}`,tenantId!,`truekens-${mes}.csv`).catch(e=>setErr((e as Error).message))}><Download size={14}/>Descargar evidencia (CSV)</button>}
   <span className="legend-note">{data.scope==='empresa'?'Consumo de toda la empresa.':'Solo ves tu propio consumo; el gerente ve el de todos.'}</span>
  </div>
  <div className="grid g-4">
   <article className={`panel kpi tone-${pct!==null&&pct>=100?'r':pct!==null&&pct>=80?'a':'g'}`}><div className="kpi-label"><span>{L} usados este mes</span><Coins size={14} aria-hidden="true"/></div><div className="kpi-value">{n(data.used.truekens)}</div>
    <div className="kpi-deltas"><div><span>Cuota del plan</span><strong>{q===null?'Sin límite':n(q)}</strong></div><div><span>Disponibles</span><strong>{q===null?'—':n(Math.max(0,q-data.used.truekens))}</strong></div></div></article>
   <article className="panel kpi tone-a"><div className="kpi-label"><span>Preguntas a Omega</span><span className="status-dot a"/></div><div className="kpi-value">{n(data.used.questions)}</div><p className="block-note">Este mes, toda la empresa</p></article>
   <article className="panel kpi tone-a"><div className="kpi-label"><span>Promedio por pregunta</span><span className="status-dot a"/></div><div className="kpi-value">{data.used.questions?n(data.used.truekens/data.used.questions):'—'}</div><p className="block-note">{L} por respuesta de Omega este mes</p></article>
   <article className="panel kpi tone-g"><div className="kpi-label"><span>Plan</span><span className="status-dot g"/></div><div className="kpi-value">{data.plan.plan_name}</div><p className="block-note">Estado: {data.plan.status}</p></article>
  </div>
  {pct!==null&&<div className="om-tkn-meter" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`${L} usados`}><i className={pct>=100?'r':pct>=80?'a':'g'} style={{width:`${pct}%`}}/><span>{pct.toFixed(0)}% de la cuota</span></div>}

  <div className="grid g-2">
   <section className="panel table-panel"><header className="panel-heading"><h2><Users size={14} aria-hidden="true"/> Por usuario · {data.month}</h2></header>
    <div className="panel-body"><div className="table-scroll"><table className="om-in-table"><thead><tr><th>Usuario</th><th className="num">Preguntas</th><th className="num">{L}</th></tr></thead>
     <tbody>{data.byUser.length?data.byUser.map(u=><tr key={u.email||u.name}><td><b>{u.name}</b>{u.email&&<small className="om-budget-hint">{u.email}</small>}</td><td className="num">{n(u.questions)}</td><td className="num"><b>{n(u.truekens)}</b></td></tr>)
      :<tr><td colSpan={3}><span className="block-missing">Sin consumo en {data.month}.</span></td></tr>}</tbody></table></div></div></section>
   <section className="panel table-panel"><header className="panel-heading"><h2>Por vista · {data.month}</h2></header>
    <div className="panel-body"><div className="table-scroll"><table className="om-in-table"><thead><tr><th>Dónde</th><th className="num">Preguntas</th><th className="num">{L}</th></tr></thead>
     <tbody>{data.byPage.length?data.byPage.map(r=><tr key={r.page_id+r.feature}><td>{r.page_id==='omega'?'Pregúntale a Omega':r.page_id}</td><td className="num">{n(r.questions)}</td><td className="num">{n(r.truekens)}</td></tr>)
      :<tr><td colSpan={3}><span className="block-missing">Sin consumo.</span></td></tr>}</tbody></table></div></div></section>
  </div>

  <section className="panel table-panel"><header className="panel-heading"><h2>Registro detallado (evidencia)</h2></header>
   <div className="panel-body"><div className="table-scroll"><table className="om-in-table"><thead><tr><th>Fecha</th><th>Usuario</th><th>Vista</th><th>Pregunta</th><th>Modelo</th><th className="num">{L}</th></tr></thead>
    <tbody>{data.entries.length?data.entries.map((e,i)=><tr key={i}><td>{new Date(e.at).toLocaleString('es-EC',{dateStyle:'short',timeStyle:'short'})}</td><td>{e.user_name}</td><td>{e.page_id||'—'}</td>
     <td className="om-tkn-q">{e.question||'—'}</td><td>{e.provider?`${e.provider} · ${e.model||''}`:'—'}</td><td className="num"><b>{n(e.truekens)}</b></td></tr>)
     :<tr><td colSpan={6}><span className="block-missing">Sin consumo en {data.month}.</span></td></tr>}</tbody></table></div>
    <p className="legend-note">Cada respuesta de Omega IA queda registrada con quién preguntó, cuándo, en qué vista y cuántos {L} consumió.</p>
   </div></section>
 </div>;
}
