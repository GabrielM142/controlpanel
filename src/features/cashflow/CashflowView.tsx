import {useCallback,useEffect,useMemo,useState} from 'react';
import {AlertTriangle,Banknote,Loader2,Plus,Save,Trash2,TrendingUp} from 'lucide-react';
import {api} from '../../data/api';
import {useLive} from '../live/LiveData';
import {defaults,levers,project,type Base,type Params} from './model';

// Flujo de efectivo: caja real por mes, proyección con lo comprometido y el ritmo (o presupuesto)
// y escenarios para subir ventas con inversiones y promociones, midiendo su efecto en la caja.
type Payload=Base&{published:{version:number;business_date:string}|null;scenarios:{id:number;name:string;params:Params}[];notes:string[];can_edit:boolean};
const money=(v:number)=>v.toLocaleString('es-EC',{style:'currency',currency:'USD',maximumFractionDigits:0});
const signed=(v:number)=>`${v>=0?'+':'−'}${money(Math.abs(v))}`;
const MONTH=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const label=(m:string)=>`${MONTH[Number(m.slice(5))-1]} ${m.slice(2,4)}`;

function Num({id,label:l,value,onChange,step=1,suffix,min}:{id:string;label:string;value:number;onChange:(v:number)=>void;step?:number;suffix?:string;min?:number}){
 return <label htmlFor={id}><span>{l}</span><div className="om-cf-num"><input id={id} type="number" step={step} min={min} value={Number.isFinite(value)?value:0} onChange={e=>onChange(Number(e.target.value))}/>{suffix&&<em>{suffix}</em>}</div></label>;
}

function CashBars({rows}:{rows:{n:string;v:number}[]}){
 const max=Math.max(1,...rows.map(r=>Math.abs(r.v)));
 return <div className="om-cf-bars" role="img" aria-label="Saldo de caja por mes">{rows.map(r=><div key={r.n} className="om-cf-bar">
  <div className="om-cf-bar-track"><span className={r.v<0?'neg':'pos'} style={{height:`${Math.abs(r.v)/max*100}%`}}/></div>
  <small>{r.n}</small><b className={r.v<0?'neg':''}>{money(r.v)}</b></div>)}</div>;
}

export default function CashflowView(){
 const {live,tenantId}=useLive();
 const [data,setData]=useState<Payload|null>(null);
 const [p,setP]=useState<Params|null>(null);
 const [name,setName]=useState('Escenario base');
 const [busy,setBusy]=useState(false);
 const [msg,setMsg]=useState<{ok:boolean;text:string}|null>(null);
 const [inv,setInv]=useState({month:'',amount:0,concept:''});

 const load=useCallback(async()=>{
  if(!live||!tenantId)return;
  try{const r=await api<Payload>('/api/cashflow?meses=6',{tenant:tenantId});setData(r);if(r.published)setP(x=>x??defaults(r));}
  catch(e){setMsg({ok:false,text:(e as Error).message});}
 },[live,tenantId]);
 useEffect(()=>{load();},[load]);
 const res=useMemo(()=>data?.published&&p?project(data,p):null,[data,p]);
 const lev=useMemo(()=>data?.published&&p?levers(data,p):[],[data,p]);
 const base=useMemo(()=>data?.published?project(data,defaults(data)):null,[data]);

 if(!live)return <section className="panel"><div className="panel-body"><p className="legend-note">Vista de demostración. Con el panel conectado, aquí ves tu caja real por mes, la proyección y los escenarios de ventas, inversiones y promociones.</p></div></section>;
 if(!data)return <section className="panel"><div className="panel-body"><p className="legend-note"><Loader2 size={14} className="om-spin"/> Leyendo el último cierre…</p>{msg&&<p className="legend-note om-ai-error" role="alert">{msg.text}</p>}</div></section>;
 if(!data.published||!p||!res)return <section className="panel"><div className="panel-body"><p className="block-missing">Aún no hay un cierre publicado para esta empresa.</p></div></section>;
 const set=(q:Partial<Params>)=>setP(x=>({...x!,...q}));
 const save=async()=>{if(!tenantId)return;setBusy(true);setMsg(null);
  try{await api('/api/cashflow/scenarios',{tenant:tenantId,method:'PUT',body:{name,params:p}});setMsg({ok:true,text:`Escenario "${name}" guardado para tu empresa.`});await load();}
  catch(e){setMsg({ok:false,text:(e as Error).message});}finally{setBusy(false);}};
 const remove=async(id:number)=>{if(!tenantId)return;setBusy(true);
  try{await api(`/api/cashflow/scenarios/${id}`,{tenant:tenantId,method:'DELETE'});await load();}catch(e){setMsg({ok:false,text:(e as Error).message});}finally{setBusy(false);}};
 const real=data.history.slice(-6);
 const usesBudget=Object.keys(data.budget).length>0;

 return <div className="om-cf">
  <h2 className="section-label"><span>Caja hoy y en {data.months.length} meses</span><i/></h2>
  <div className="grid g-4">
   <article className={`panel kpi tone-${res.opening<0?'r':'g'}`}><div className="kpi-label"><span>Caja al cierre {data.published.business_date}</span><span className={`status-dot ${res.opening<0?'r':'g'}`}/></div><div className="kpi-value">{money(res.opening)}</div><p className="block-note">{p.opening!==null?'Saldo bancario ingresado por ti':'Saldo contable de efectivo y bancos'}</p></article>
   <article className={`panel kpi tone-${res.closing<0?'r':'g'}`}><div className="kpi-label"><span>Caja proyectada {label(data.months[data.months.length-1])}</span><span className={`status-dot ${res.closing<0?'r':'g'}`}/></div><div className="kpi-value">{money(res.closing)}</div>
    <div className="kpi-deltas"><div><span>vs escenario base</span><strong className={res.closing-(base?.closing??0)>=0?'up':'down'}>{signed(res.closing-(base?.closing??0))}</strong></div></div></article>
   <article className={`panel kpi tone-${res.min.balance<0?'r':'a'}`}><div className="kpi-label"><span>Punto más bajo</span><span className={`status-dot ${res.min.balance<0?'r':'a'}`}/></div><div className="kpi-value">{money(res.min.balance)}</div><p className="block-note">{label(res.min.month)}{res.negativeMonths?` · ${res.negativeMonths} mes(es) en negativo`:''}</p></article>
   <article className={`panel kpi tone-${res.financing>0?'r':'g'}`}><div className="kpi-label"><span>Financiamiento necesario</span><span className={`status-dot ${res.financing>0?'r':'g'}`}/></div><div className="kpi-value">{money(res.financing)}</div><p className="block-note">{res.financing>0?'Para no quedar en negativo en ningún mes':'La caja alcanza en todo el horizonte'}</p></article>
  </div>
  {res.financing>0&&<p className="om-cf-alert" role="alert"><AlertTriangle size={14}/> Con este escenario la caja queda en {money(res.min.balance)} en {label(res.min.month)}. La palanca más fuerte está abajo, en "Cómo subir ventas y caja".</p>}

  <section className="panel" aria-labelledby="om-cf-levers"><header className="panel-heading"><h2 id="om-cf-levers">Escenario: ventas, inversiones y promociones</h2><TrendingUp size={15} aria-hidden="true"/></header>
   <div className="panel-body">
    <div className="om-cf-form">
     <Num id="cf-growth" label={`Crecimiento de ventas vs ritmo actual${usesBudget?' (meses sin presupuesto)':''}`} value={p.salesGrowth} suffix="%" onChange={v=>set({salesGrowth:v})}/>
     <Num id="cf-margin" label="Margen extra por precio o mezcla" value={p.marginBoost} step={0.5} suffix="pts" onChange={v=>set({marginBoost:v})}/>
     <Num id="cf-collect" label="Días de cobro de la venta nueva" value={p.collectDays} min={0} suffix="días" onChange={v=>set({collectDays:Math.max(0,v)})}/>
     <Num id="cf-overdue" label="Recuperación de cartera vencida en el horizonte" value={p.overdueRecovery} min={0} suffix="%" onChange={v=>set({overdueRecovery:Math.min(100,Math.max(0,v))})}/>
     <Num id="cf-vat" label="IVA en cobros y pagos nuevos" value={p.vat} min={0} suffix="%" onChange={v=>set({vat:Math.max(0,v)})}/>
     <Num id="cf-mkt" label="Marketing adicional por mes" value={p.marketing} step={100} min={0} suffix="USD" onChange={v=>set({marketing:Math.max(0,v)})}/>
     <label htmlFor="cf-opening"><span>Saldo bancario real (opcional)</span><div className="om-cf-num"><input id="cf-opening" type="number" step={1000} value={p.opening??''} placeholder={String(Math.round(data.opening??0))} onChange={e=>set({opening:e.target.value===''?null:Number(e.target.value)})}/><em>USD</em></div></label>
    </div>
    <fieldset className="om-cf-promo"><legend>Promoción</legend>
     <div className="om-cf-months">{data.months.map(m=><label key={m} className={`om-cf-chip${p.promoMonths.includes(m)?' is-on':''}`}><input type="checkbox" checked={p.promoMonths.includes(m)} onChange={e=>set({promoMonths:e.target.checked?[...p.promoMonths,m]:p.promoMonths.filter(x=>x!==m)})}/>{label(m)}</label>)}</div>
     <div className="om-cf-form">
      <Num id="cf-disc" label="Descuento" value={p.promoDiscount} min={0} suffix="%" onChange={v=>set({promoDiscount:Math.min(90,Math.max(0,v))})}/>
      <Num id="cf-uplift" label="Volumen adicional esperado" value={p.promoUplift} min={0} suffix="%" onChange={v=>set({promoUplift:Math.max(0,v)})}/>
      <Num id="cf-pcost" label="Costo de la promoción por mes" value={p.promoCost} step={100} min={0} suffix="USD" onChange={v=>set({promoCost:Math.max(0,v)})}/>
     </div>
    </fieldset>
    <fieldset className="om-cf-promo"><legend>Inversiones</legend>
     {p.investments.length>0&&<ul className="om-cf-inv">{p.investments.map((x,i)=><li key={i}><span>{label(x.month)} · {x.concept||'Inversión'}</span><b>{money(x.amount)}</b>
      <button type="button" className="link-button" aria-label={`Quitar ${x.concept||'inversión'}`} onClick={()=>set({investments:p.investments.filter((_,j)=>j!==i)})}><Trash2 size={13}/></button></li>)}</ul>}
     <div className="om-cf-form">
      <label htmlFor="cf-inv-m"><span>Mes</span><select id="cf-inv-m" value={inv.month} onChange={e=>setInv({...inv,month:e.target.value})}><option value="">Elige…</option>{data.months.map(m=><option key={m} value={m}>{label(m)}</option>)}</select></label>
      <label htmlFor="cf-inv-c"><span>Concepto</span><input id="cf-inv-c" value={inv.concept} maxLength={60} placeholder="Camión, local, inventario…" onChange={e=>setInv({...inv,concept:e.target.value})}/></label>
      <Num id="cf-inv-a" label="Monto" value={inv.amount} step={1000} min={0} suffix="USD" onChange={v=>setInv({...inv,amount:Math.max(0,v)})}/>
      <div className="om-cf-add"><button type="button" className="button secondary" disabled={!inv.month||!inv.amount} onClick={()=>{set({investments:[...p.investments,inv]});setInv({month:'',amount:0,concept:''});}}><Plus size={14}/>Agregar inversión</button></div>
     </div>
    </fieldset>
    {data.can_edit&&<div className="om-ai-actions">
     <label htmlFor="cf-name" className="om-mkt-label"><span>Nombre del escenario</span><input id="cf-name" value={name} maxLength={80} onChange={e=>setName(e.target.value)}/></label>
     <button type="button" className="button primary" onClick={save} disabled={busy||!name.trim()}>{busy?<Loader2 size={14} className="om-spin"/>:<Save size={14}/>}Guardar escenario</button>
     <button type="button" className="button secondary" onClick={()=>setP(defaults(data))}>Volver al escenario base</button>
    </div>}
    {data.scenarios.length>0&&<div className="om-cf-saved"><span>Escenarios guardados:</span>{data.scenarios.map(s=><span key={s.id} className="om-cf-chip is-saved">
     <button type="button" className="link-button" onClick={()=>{setP({...defaults(data),...s.params});setName(s.name);}}>{s.name}</button>
     {data.can_edit&&<button type="button" className="link-button" aria-label={`Borrar ${s.name}`} onClick={()=>remove(s.id)}><Trash2 size={12}/></button>}</span>)}</div>}
    {msg&&<p className={`legend-note ${msg.ok?'':'om-ai-error'}`} role={msg.ok?'status':'alert'}>{msg.text}</p>}
   </div></section>

  <section className="panel" aria-labelledby="om-cf-chart"><header className="panel-heading"><h2 id="om-cf-chart">Saldo de caja: real y proyectado</h2><Banknote size={15} aria-hidden="true"/></header>
   <div className="panel-body"><CashBars rows={[...real.map(h=>({n:label(h.month),v:p.opening!==null?h.balance-(data.opening??0)+p.opening:h.balance})),...res.rows.map(r=>({n:`${label(r.month)}*`,v:r.balance}))]}/>
    <p className="legend-note">* Proyectado. Real: cuentas de efectivo y bancos ({data.history.length} meses publicados).</p></div></section>

  <section className="panel table-panel" aria-labelledby="om-cf-table"><header className="panel-heading"><h2 id="om-cf-table">Flujo proyectado mes a mes</h2><span className="panel-mark" aria-hidden="true"/></header>
   <div className="panel-body"><div className="table-scroll"><table className="om-in-table">
    <thead><tr><th>Concepto</th>{res.rows.map(r=><th key={r.month} className="num">{label(r.month)}</th>)}<th className="num">Total</th></tr></thead>
    <tbody>
     {([['Ventas del mes','sales'],['Cobros de venta nueva','fromNewSales'],['Cobros de cartera','fromPortfolio'],['Total cobros','collections'],['Pagos a proveedores','suppliers'],['Gastos operativos','expenses'],['IVA neto al SRI','taxes'],['Marketing y promociones','marketing'],['Inversiones','investments'],['Total pagos','outflow'],['Flujo neto','net'],['Saldo final','balance']] as [string,keyof typeof res.rows[0]][])
      .map(([l,k])=><tr key={k} className={k==='collections'||k==='outflow'||k==='net'||k==='balance'?'om-cf-strong':''}><td>{l}</td>{res.rows.map(r=><td key={r.month} className={`num${(k==='net'||k==='balance')&&Number(r[k])<0?' om-budget-low':''}`}>{money(Number(r[k]))}</td>)}
       <td className="num">{k==='balance'?money(res.closing):money(res.rows.reduce((s,r)=>s+Number(r[k]),0))}</td></tr>)}
    </tbody></table></div>
    <p className="legend-note">Supuestos: {usesBudget?'presupuesto cargado donde existe; en el resto, ':''}ritmo de {data.runRate.basis} (venta {money(data.runRate.sales)}/mes, gastos con nómina {money(data.runRate.expenses)}/mes); margen {data.marginPct?.toFixed(1)}%; proveedores a {Math.round(data.daysPay??30)} días; cartera ya facturada en su vencimiento; cobros y pagos nuevos con IVA {p.vat}%. Caja real promedio de los últimos 3 meses: entradas {money(data.cashIn??0)}, salidas {money(data.cashOut??0)}. {data.notes[1]}</p>
   </div></section>

  <section className="panel" aria-labelledby="om-cf-an"><header className="panel-heading"><h2 id="om-cf-an">Cómo subir ventas y caja</h2><TrendingUp size={15} aria-hidden="true"/></header>
   <div className="panel-body">
    <p className="legend-note">Cada palanca, sola, contra tu escenario actual: cuánto cambia la caja al final del horizonte y el resultado operativo (margen bruto − gastos − marketing).</p>
    <div className="table-scroll"><table className="om-in-table"><thead><tr><th>Palanca</th><th>Qué supone</th><th className="num">Ventas</th><th className="num">Caja final</th><th className="num">Resultado</th></tr></thead>
     <tbody>{[...lev].sort((a,b)=>b.cash-a.cash).map(l=><tr key={l.label}><td><b>{l.label}</b></td><td>{l.detail}</td><td className="num">{signed(l.sales)}</td>
      <td className={`num ${l.cash>=0?'om-budget-ok':'om-budget-low'}`}>{signed(l.cash)}</td><td className={`num ${l.profit>=0?'om-budget-ok':'om-budget-low'}`}>{signed(l.profit)}</td></tr>)}</tbody></table></div>
    <div className="grid g-3 om-cf-summary">
     <article className="panel metric"><div className="kpi-label">Ventas del horizonte</div><div className="metric-value">{money(res.sales)}</div><p>{signed(res.sales-(base?.sales??0))} vs base</p></article>
     <article className="panel metric"><div className="kpi-label">Margen bruto</div><div className="metric-value">{money(res.grossProfit)}</div><p>{signed(res.grossProfit-(base?.grossProfit??0))} vs base</p></article>
     <article className="panel metric"><div className="kpi-label">Resultado operativo</div><div className="metric-value">{money(res.operatingResult)}</div><p>{signed(res.operatingResult-(base?.operatingResult??0))} vs base</p></article>
    </div>
   </div></section>
 </div>;
}
