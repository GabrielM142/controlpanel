import {useCallback,useEffect,useMemo,useState} from 'react';
import {CheckCircle2,Loader2,Plus,Save,Sparkles,Trash2} from 'lucide-react';
import {api} from '../../data/api';
import {useLive} from '../live/LiveData';
import {clearCache} from '../live/cache';

// Budget builder: a 12-month grid per company, unit or brand, started from what really happened
// the year before (sales, purchases, selling + administrative expenses) plus a growth rate.
type Row={unit_name:string|null;brand:string|null;month:string;amount:string};
type Point={key:string;month:string;amount:number};
type Data={kind:string;year:number;by:string;rows:Row[];base:Point[];actual:Point[];units:string[];brands:string[];cutoff:string;can_edit:boolean};
type Kind='ventas'|'compras'|'gastos_fijos'|'marketing';
type By='total'|'unit'|'brand';

const KINDS:{id:Kind;label:string;feeds:string;levels:By[]}[]=[
 {id:'ventas',label:'Ventas',feeds:'Cumplimiento en Dirección, Comercial y cada unidad; ISE por unidad',levels:['total','unit','brand']},
 {id:'compras',label:'Compras',feeds:'Cumplimiento de compras, total y por marca',levels:['total','brand']},
 {id:'gastos_fijos',label:'Gastos fijos',feeds:'Punto de equilibrio de cada unidad (base: gastos de venta y administración, cuentas 601 y 602)',levels:['total','unit']},
 {id:'marketing',label:'Marketing',feeds:'Cumplimiento de la inversión en campañas',levels:['total','unit','brand']},
];
const LEVEL:Record<By,string>={total:'Empresa',unit:'Por unidad',brand:'Por marca'};
const MONTHS=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const money=(v:number)=>v.toLocaleString('es-EC',{style:'currency',currency:'USD',maximumFractionDigits:0});
const pct=(v:number|null)=>v===null||!Number.isFinite(v)?'—':`${v.toFixed(1)}%`;

export default function BudgetView(){
 const {live,tenantId}=useLive();
 const now=new Date().getFullYear();
 const [kind,setKind]=useState<Kind>('ventas');
 const [year,setYear]=useState(now);
 const [by,setBy]=useState<By>('total');
 const [data,setData]=useState<Data|null>(null);
 const [grid,setGrid]=useState<Record<string,number[]>>({});
 const [growth,setGrowth]=useState(10);
 const [newKey,setNewKey]=useState('');
 const [busy,setBusy]=useState<'load'|'save'|null>(null);
 const [msg,setMsg]=useState<{ok:boolean;text:string}|null>(null);
 const [dirty,setDirty]=useState(false);

 const load=useCallback(async()=>{
  if(!live||!tenantId)return;setBusy('load');setMsg(null);
  try{
   const r=await api<Data>(`/api/budget/${kind}/${year}?by=${by}`,{tenant:tenantId});setData(r);
   const g:Record<string,number[]>={};
   for(const row of r.rows){
    const key=by==='unit'?row.unit_name:by==='brand'?row.brand:(!row.unit_name&&!row.brand?'Empresa':null);
    if(!key||(by==='unit'&&row.brand)||(by==='brand'&&row.unit_name))continue;
    (g[key]??=Array(12).fill(0))[Number(row.month.slice(5))-1]=Number(row.amount);
   }
   if(by==='total'&&!g.Empresa)g.Empresa=Array(12).fill(0);
   if(by==='unit')for(const u of r.units)g[u]??=Array(12).fill(0);
   setGrid(g);setDirty(false);
  }catch(e){setMsg({ok:false,text:(e as Error).message});}finally{setBusy(null);}
 },[live,tenantId,kind,year,by]);
 useEffect(()=>{load();},[load]);
 useEffect(()=>{if(!KINDS.find(k=>k.id===kind)!.levels.includes(by))setBy('total');},[kind,by]);

 const series=(points:Point[]|undefined)=>{const m:Record<string,number[]>={};for(const p of points||[]){(m[p.key]??=Array(12).fill(0))[Number(p.month.slice(5))-1]+=p.amount;}return m;};
 const base=useMemo(()=>series(data?.base),[data]);
 const actual=useMemo(()=>series(data?.actual),[data]);
 const keys=Object.keys(grid);
 const monthTotal=(i:number)=>keys.reduce((s,k)=>s+(grid[k][i]||0),0);
 const yearTotal=keys.reduce((s,k)=>s+grid[k].reduce((a,b)=>a+b,0),0);
 const baseTotal=Object.values(base).reduce((s,v)=>s+v.reduce((a,b)=>a+b,0),0);
 const edit=!!data?.can_edit;

 const fromBase=()=>{
  // Each month = same month of the previous year × (1 + growth). Months without history take the
  // average of the months that do have it, so a short history still yields a full year.
  const out:Record<string,number[]>={};
  const pool=by==='total'?{Empresa:Object.values(base).reduce((acc,v)=>acc.map((x,i)=>x+v[i]),Array(12).fill(0))}:base;
  for(const [k,v] of Object.entries(pool)){
   const known=v.filter(x=>x>0);const avg=known.length?known.reduce((a,b)=>a+b,0)/known.length:0;
   out[k]=v.map(x=>Math.round((x>0?x:avg)*(1+growth/100)));
  }
  for(const k of keys)out[k]??=grid[k];
  setGrid(out);setDirty(true);
  setMsg({ok:true,text:baseTotal?`Armado desde el real de ${year-1} con ${growth>=0?'+':''}${growth}%. Ajusta lo que necesites y guarda.`:`No hay real de ${year-1} para este tipo: escribe los montos o cambia el año.`});
 };
 const setCell=(k:string,i:number,v:string)=>{const n=Math.max(0,Number(v.replace(/[^\d.]/g,''))||0);setGrid(g=>({...g,[k]:g[k].map((x,j)=>j===i?n:x)}));setDirty(true);};
 const save=async()=>{
  if(!tenantId)return;setBusy('save');setMsg(null);
  const rows=keys.flatMap(k=>grid[k].map((amount,i)=>({key:by==='total'?undefined:k,month:`${year}-${String(i+1).padStart(2,'0')}`,amount})).filter(r=>r.amount>0));
  try{await api(`/api/budget/${kind}/${year}`,{tenant:tenantId,method:'PUT',body:{by,rows}});clearCache();
   setMsg({ok:true,text:`Presupuesto de ${KINDS.find(k=>k.id===kind)!.label.toLowerCase()} ${year} guardado (${LEVEL[by].toLowerCase()}). Los reportes ya lo usan.`});setDirty(false);await load();}
  catch(e){setMsg({ok:false,text:(e as Error).message});}finally{setBusy(null);}
 };

 if(!live)return <section className="panel"><div className="panel-body"><p className="legend-note">Vista de demostración. Con el panel conectado, aquí armas el presupuesto de tu empresa a partir del real del año anterior.</p></div></section>;
 const k=KINDS.find(x=>x.id===kind)!;
 const actualTotal=Object.values(actual).reduce((acc,v)=>acc.map((x,i)=>x+v[i]),Array(12).fill(0));
 const cutMonth=data?.cutoff&&Number(data.cutoff.slice(0,4))===year?Number(data.cutoff.slice(5,7)):Number(data?.cutoff?.slice(0,4))>year?12:0;

 return <div className="om-budget">
  <section className="panel">
   <div className="panel-body om-budget-bar">
    <div className="om-in-kinds" role="tablist" aria-label="Tipo de presupuesto">{KINDS.map(x=><button key={x.id} type="button" role="tab" aria-selected={kind===x.id} className={`om-in-kind${kind===x.id?' is-active':''}`} onClick={()=>setKind(x.id)}><strong>{x.label}</strong><small>{x.feeds}</small></button>)}</div>
    <div className="om-budget-controls">
     <label htmlFor="om-b-year"><span>Año</span><select id="om-b-year" value={year} onChange={e=>setYear(Number(e.target.value))}>{[now-1,now,now+1].map(y=><option key={y} value={y}>{y}</option>)}</select></label>
     <label htmlFor="om-b-level"><span>Nivel</span><select id="om-b-level" value={by} onChange={e=>setBy(e.target.value as By)}>{k.levels.map(l=><option key={l} value={l}>{LEVEL[l]}</option>)}</select></label>
     {edit&&kind!=='marketing'&&<div className="om-budget-base"><label htmlFor="om-b-growth"><span>Crecimiento vs {year-1}</span><input id="om-b-growth" type="number" step={1} value={growth} onChange={e=>setGrowth(Number(e.target.value))}/></label>
      <button type="button" className="button secondary" onClick={fromBase} disabled={!!busy}><Sparkles size={14}/>Armar desde el real {year-1}</button></div>}
     {edit&&<button type="button" className="button primary" onClick={save} disabled={!!busy||!dirty}>{busy==='save'?<Loader2 size={14} className="om-spin"/>:<Save size={14}/>}Guardar presupuesto</button>}
    </div>
    {msg&&<p className={`legend-note ${msg.ok?'':'om-ai-error'}`} role={msg.ok?'status':'alert'}>{msg.text}</p>}
    {!edit&&<p className="legend-note">Solo los administradores editan el presupuesto.</p>}
   </div>
  </section>

  <section className="panel table-panel" aria-labelledby="om-b-grid" aria-busy={busy==='load'}>
   <header className="panel-heading"><h2 id="om-b-grid">{k.label} {year} · {LEVEL[by]}</h2><span className="om-budget-total">{money(yearTotal)}{baseTotal?<small> · real {year-1}: {money(baseTotal)} ({pct(baseTotal?(yearTotal/baseTotal-1)*100:null)})</small>:null}</span></header>
   <div className="panel-body"><div className="table-scroll"><table className="om-in-table om-budget-grid">
    <thead><tr><th>{by==='unit'?'Unidad':by==='brand'?'Marca':'Concepto'}</th>{MONTHS.map(m=><th key={m} className="num">{m}</th>)}<th className="num">Total</th>{edit&&by!=='total'&&<th><span className="sr-only">Quitar</span></th>}</tr></thead>
    <tbody>{keys.map(key=><tr key={key}><td><b>{key}</b>{base[key]?<small className="om-budget-hint">real {year-1}: {money(base[key].reduce((a,b)=>a+b,0))}</small>:null}</td>
      {grid[key].map((v,i)=><td key={i} className="num"><input aria-label={`${key} ${MONTHS[i]}`} inputMode="numeric" value={v?String(v):''} placeholder={base[key]?.[i]?String(Math.round(base[key][i])):'0'} disabled={!edit} onChange={e=>setCell(key,i,e.target.value)}/></td>)}
      <td className="num"><b>{money(grid[key].reduce((a,b)=>a+b,0))}</b></td>
      {edit&&by!=='total'&&<td><button type="button" className="link-button" aria-label={`Quitar ${key}`} onClick={()=>{setGrid(g=>{const n={...g};delete n[key];return n;});setDirty(true);}}><Trash2 size={14}/></button></td>}</tr>)}</tbody>
    <tfoot><tr><td><b>Total</b></td>{MONTHS.map((_,i)=><td key={i} className="num"><b>{money(monthTotal(i))}</b></td>)}<td className="num"><b>{money(yearTotal)}</b></td>{edit&&by!=='total'&&<td/>}</tr></tfoot>
   </table></div>
   {edit&&by!=='total'&&<div className="om-ai-actions om-budget-add">
    <input aria-label={by==='unit'?'Nueva unidad':'Nueva marca'} list="om-b-keys" value={newKey} maxLength={120} placeholder={by==='unit'?'Agregar unidad…':'Agregar marca…'} onChange={e=>setNewKey(e.target.value)}/>
    <datalist id="om-b-keys">{(by==='unit'?data?.units:data?.brands)?.filter(x=>!grid[x]).map(x=><option key={x} value={x}/>)}</datalist>
    <button type="button" className="button secondary" disabled={!newKey.trim()||!!grid[newKey.trim()]} onClick={()=>{setGrid(g=>({...g,[newKey.trim()]:Array(12).fill(0)}));setNewKey('');setDirty(true);}}><Plus size={14}/>Agregar</button>
   </div>}
   {by==='unit'&&!data?.units.length&&<p className="legend-note">Aún no hay unidades de negocio definidas: créalas en Configuración → Presupuestos y unidades para que el real se reparta por unidad.</p>}
   </div>
  </section>

  {kind!=='marketing'&&<section className="panel table-panel" aria-labelledby="om-b-vs">
   <header className="panel-heading"><h2 id="om-b-vs">Real vs presupuesto {year}</h2><CheckCircle2 size={15} aria-hidden="true"/></header>
   <div className="panel-body"><div className="table-scroll"><table className="om-in-table">
    <thead><tr><th>Mes</th><th className="num">Presupuesto</th><th className="num">Real</th><th className="num">Cumplimiento</th></tr></thead>
    <tbody>{MONTHS.map((m,i)=>{const b=monthTotal(i);const a=i<cutMonth?actualTotal[i]:null;return <tr key={m}><td>{m} {year}</td><td className="num">{b?money(b):'—'}</td><td className="num">{a===null?'—':money(a)}</td>
     <td className="num"><span className={a!==null&&b?(a>=b?'om-budget-ok':'om-budget-low'):''}>{a!==null&&b?pct(a/b*100):'—'}</span></td></tr>;})}</tbody>
   </table></div>
   <p className="legend-note">Real del último cierre publicado ({data?.cutoff||'—'}); el mes en curso está incompleto.</p></div>
  </section>}
 </div>;
}
