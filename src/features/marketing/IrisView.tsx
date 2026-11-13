import {useEffect,useMemo,useState} from 'react';
import {ArrowRight,Link2,Loader2,Megaphone,Target,Users} from 'lucide-react';
import {api} from '../../data/api';
import {useLive} from '../live/LiveData';

// Iris · leads y campañas: lo que envía la app de marketing (leads, inversión) medido contra la
// venta real de OMEGA (clientes captados, ventas, ROI). Se llena cuando Iris envía sus datos.
type Camp={id:number;name:string;status:string;source:string;leads:number|null;start:string;end:string;brand:string|null;unit:string|null;
 investment:number;sales:number;captured:number;roi:number|null;cpl:number|null;conversion:number|null};
type Perf={from:string;to:string;source:string|null;campaigns:Camp[];sources:{source:string;campaigns:number;last:string}[]};
const money=(v:number)=>v.toLocaleString('es-EC',{style:'currency',currency:'USD',maximumFractionDigits:0});
const pct=(v:number|null)=>v===null||!Number.isFinite(v)?'—':`${v>=0?'':'−'}${Math.abs(v).toFixed(1)}%`;
const SOURCE='iris';

export default function IrisView({onNavigate}:{onNavigate?:(id:string)=>void}){
 const {live,tenantId}=useLive();
 const [data,setData]=useState<Perf|null>(null);
 const [err,setErr]=useState<string|null>(null);
 useEffect(()=>{if(!live||!tenantId)return;let off=false;
  api<Perf>(`/api/marketing/performance?fuente=${SOURCE}`,{tenant:tenantId}).then(r=>{if(!off)setData(r);}).catch(e=>{if(!off)setErr((e as Error).message);});
  return()=>{off=true;};},[live,tenantId]);
 const t=useMemo(()=>{const c=data?.campaigns||[];const sum=(k:keyof Camp)=>c.reduce((s,x)=>s+(Number(x[k])||0),0);
  const leads=sum('leads'),inv=sum('investment'),captured=sum('captured'),sales=sum('sales');
  const roiBase=c.filter(x=>x.roi!==null);const roi=roiBase.length?roiBase.reduce((s,x)=>s+(x.roi!*x.investment),0)/Math.max(1,roiBase.reduce((s,x)=>s+x.investment,0)):null;
  return {leads,inv,captured,sales,cpl:leads?inv/leads:null,conv:leads?captured/leads*100:null,roi};},[data]);
 const go=(id:string)=>{if(onNavigate)onNavigate(id);else location.hash=id;};

 if(!live)return <section className="panel"><div className="panel-body"><p className="legend-note">Vista de demostración. Con el panel conectado, aquí ves los leads y campañas que envía Iris, medidos contra tus ventas reales.</p></div></section>;
 if(err)return <section className="panel"><div className="panel-body"><p className="legend-note om-ai-error" role="alert">{err}</p></div></section>;
 if(!data)return <section className="panel" aria-busy="true"><div className="panel-body"><p className="legend-note"><Loader2 size={14} className="om-spin"/> Cargando datos de Iris…</p></div></section>;
 const connected=data.sources.find(s=>s.source===SOURCE);

 return <div className="om-iris">
  <section className={`panel om-iris-status${connected?' is-on':''}`}><div className="panel-body">
   <Link2 size={16} aria-hidden="true"/>
   {connected?<p><b>Iris conectado.</b> {connected.campaigns} campañas · última actualización {new Date(connected.last).toLocaleString('es-EC',{dateStyle:'short',timeStyle:'short'})}.</p>
    :<p><b>Esperando la conexión con Iris.</b> Cuando Iris envíe sus campañas y leads (API en definición), esta vista se llena sola. Mientras tanto, puedes crear el token y compartir el formato de envío.</p>}
   <button type="button" className="button secondary" onClick={()=>go('insumos')}>Conexión y token <ArrowRight size={13}/></button>
  </div></section>

  <div className="grid g-4">
   <article className="panel kpi tone-a"><div className="kpi-label"><span>Leads</span><Target size={14} aria-hidden="true"/></div><div className="kpi-value">{connected?t.leads.toLocaleString('es-EC'):'—'}</div><p className="block-note">{data.from} a {data.to}</p></article>
   <article className="panel kpi tone-a"><div className="kpi-label"><span>Costo por lead</span><span className="status-dot a"/></div><div className="kpi-value">{t.cpl===null?'—':money(t.cpl)}</div><p className="block-note">Inversión {connected?money(t.inv):'—'}</p></article>
   <article className={`panel kpi tone-${t.conv===null?'a':t.conv>=10?'g':'a'}`}><div className="kpi-label"><span>Lead → cliente</span><Users size={14} aria-hidden="true"/></div><div className="kpi-value">{pct(t.conv)}</div><p className="block-note">{connected?`${t.captured} clientes con su primera compra`:'Clientes captados'}</p></article>
   <article className={`panel kpi tone-${t.roi===null?'a':t.roi>=0?'g':'r'}`}><div className="kpi-label"><span>ROI sobre margen</span><Megaphone size={14} aria-hidden="true"/></div><div className="kpi-value">{pct(t.roi)}</div><p className="block-note">Ventas en campaña {connected?money(t.sales):'—'}</p></article>
  </div>

  <section className="panel" aria-labelledby="om-iris-funnel"><header className="panel-heading"><h2 id="om-iris-funnel">Embudo: de lead a venta</h2><span className="panel-mark" aria-hidden="true"/></header>
   <div className="panel-body"><div className="om-iris-funnel">{[['Leads de Iris',t.leads,'var(--fin-ai)'],['Clientes captados',t.captured,'var(--fin-cash)']].map(([l,v,c],i)=>{const max=Math.max(1,t.leads,t.captured);
    return <div key={String(l)} className="om-iris-step"><span>{String(l)}</span><div className="om-iris-track"><i style={{width:`${connected?Number(v)/max*100:0}%`,background:String(c)}}/></div><b>{connected?Number(v).toLocaleString('es-EC'):'—'}</b>{i===1&&<small>{pct(t.conv)} de conversión</small>}</div>;})}
    <div className="om-iris-step"><span>Ventas atribuidas</span><div className="om-iris-track"><i style={{width:connected&&t.sales?'100%':'0%',background:'var(--fin-income)'}}/></div><b>{connected?money(t.sales):'—'}</b><small>Venta de la marca o unidad durante cada campaña</small></div>
   </div></div></section>

  <section className="panel table-panel" aria-labelledby="om-iris-table"><header className="panel-heading"><h2 id="om-iris-table">Campañas de Iris</h2><span className="panel-mark" aria-hidden="true"/></header>
   <div className="panel-body"><div className="table-scroll"><table className="om-in-table"><thead><tr><th>Campaña</th><th>Fechas</th><th>Marca / unidad</th><th className="num">Leads</th><th className="num">Inversión</th><th className="num">Costo por lead</th><th className="num">Clientes</th><th className="num">Conversión</th><th className="num">Ventas</th><th className="num">ROI</th></tr></thead>
    <tbody>{data.campaigns.length?data.campaigns.map(c=><tr key={c.id}><td>{c.name}{c.status==='planificada'?' (planificada)':''}</td><td>{c.start} → {c.end}</td><td>{c.brand||'Todas'} / {c.unit||'Todas'}</td>
     <td className="num">{c.leads??'—'}</td><td className="num">{money(c.investment)}</td><td className="num">{c.cpl===null?'—':money(c.cpl)}</td><td className="num">{c.captured}</td><td className="num">{pct(c.conversion)}</td><td className="num">{money(c.sales)}</td>
     <td className={`num ${c.roi===null?'':c.roi>=0?'om-budget-ok':'om-budget-low'}`}>{pct(c.roi)}</td></tr>)
     :<tr><td colSpan={10}><span className="block-missing">Sin campañas de Iris en el período.</span></td></tr>}</tbody></table></div>
    <p className="legend-note">Leads e inversión los informa Iris; clientes captados, ventas y ROI los calcula OMEGA con las ventas publicadas (primera compra del cliente dentro de las fechas de la campaña; ROI = margen bruto de esa venta − inversión, sobre la inversión).</p>
   </div></section>
 </div>;
}
