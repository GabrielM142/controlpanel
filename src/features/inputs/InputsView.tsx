import {useCallback,useEffect,useMemo,useState,type ChangeEvent} from 'react';
import {CalendarRange,CheckCircle2,Download,Layers3,Loader2,Megaphone,Plus,RefreshCw,Trash2,Upload} from 'lucide-react';
import {api} from '../../data/api';
import {useLive} from '../live/LiveData';
import {clearCache} from '../live/cache';
import MarketingConnect from './MarketingConnect';

// Company inputs Odoo does not hold: budgets, marketing campaigns and business-unit rules.
// The reports read them on the next refresh; unit rules recalculate the history in the worker.
type Budget={kind:string;month:string;unit_name:string|null;brand:string|null;amount:string};
type Campaign={id:number;name:string;status:string;start_date:string;end_date:string;brand:string|null;unit_name:string|null;investment:string;source?:string;leads?:number|null};
type Rule={source_id:string;match_type:string;match_value:string;unit_name:string;channel:string;priority:number;match_name?:string|null};
type Inputs={budgets:Budget[];campaigns:Campaign[];sources:{id:string;name:string;rebuild_requested_at:string|null;rebuilt_at:string|null}[];
 rules:Rule[];options:{source_id:string;match_type:string;match_value:string;name:string|null}[];brands:string[];units:string[];can_edit:boolean};

const KINDS:{id:string;label:string;hint:string}[]=[
 {id:'ventas',label:'Ventas',hint:'Cumplimiento en Dirección, Comercial y cada unidad'},
 {id:'compras',label:'Compras',hint:'Cumplimiento de compras, total y por marca'},
 {id:'gastos_fijos',label:'Gastos fijos',hint:'Punto de equilibrio de cada unidad'},
 {id:'marketing',label:'Marketing',hint:'Cumplimiento de la inversión en campañas'},
];
const MATCH:{id:string;label:string}[]=[{id:'team',label:'Equipo de venta'},{id:'journal',label:'Diario de ventas'},{id:'pos_config',label:'Punto de venta'},{id:'company',label:'Empresa'}];
const money=(v:string|number)=>Number(v).toLocaleString('es-EC',{style:'currency',currency:'USD',maximumFractionDigits:0});
const norm=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').trim().toLowerCase();

/** Minimal CSV reader: ; , or tab delimiter, quoted fields, first row = headers. */
function parseCsv(text:string):Record<string,string>[]{
 const lines=text.replace(/^﻿/,'').split(/\r?\n/).filter(l=>l.trim());
 if(lines.length<2)return [];
 const first=lines[0];const d=first.includes(';')?';':first.includes('\t')?'\t':',';
 const split=(line:string)=>{const out:string[]=[];let cur='';let q=false;
  for(let i=0;i<line.length;i++){const ch=line[i];
   if(q){if(ch==='"'&&line[i+1]==='"'){cur+='"';i++;}else if(ch==='"')q=false;else cur+=ch;}
   else if(ch==='"')q=true;else if(ch===d){out.push(cur);cur='';}else cur+=ch;}
  out.push(cur);return out.map(x=>x.trim());};
 const head=split(first).map(norm);
 return lines.slice(1).map(l=>{const cells=split(l);const row:Record<string,string>={};head.forEach((h,i)=>{row[h]=cells[i]??'';});return row;});
}
const col=(r:Record<string,string>,...names:string[])=>{for(const n of names)if(r[n]!==undefined&&r[n]!=='')return r[n];return '';};
function download(name:string,content:string){
 const url=URL.createObjectURL(new Blob(['﻿'+content],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export default function InputsView(){
 const {live,tenantId}=useLive();
 const [data,setData]=useState<Inputs|null>(null);
 const [kind,setKind]=useState('ventas');
 const [rules,setRules]=useState<Rule[]>([]);
 const [busy,setBusy]=useState<string|null>(null);
 const [msg,setMsg]=useState<{ok:boolean;text:string}|null>(null);

 const load=useCallback(async()=>{
  if(!live||!tenantId)return;
  try{const r=await api<Inputs>('/api/inputs',{tenant:tenantId});setData(r);setRules(r.rules.map(x=>({...x})));}
  catch(e){setMsg({ok:false,text:(e as Error).message});}
 },[live,tenantId]);
 useEffect(()=>{load();},[load]);
 const pending=data?.sources.some(s=>s.rebuild_requested_at);
 useEffect(()=>{if(!pending)return;const t=setInterval(load,20000);return()=>clearInterval(t);},[pending,load]);

 const budgets=useMemo(()=>(data?.budgets||[]).filter(b=>b.kind===kind),[data,kind]);
 const edit=!!data?.can_edit;

 const send=async(label:string,path:string,body:unknown,done:string)=>{
  if(!tenantId)return;setBusy(label);setMsg(null);
  try{await api(path,{tenant:tenantId,method:'PUT',body});clearCache();setMsg({ok:true,text:done});await load();}
  catch(e){setMsg({ok:false,text:(e as Error).message});}finally{setBusy(null);}
 };
 const readFile=(e:ChangeEvent<HTMLInputElement>,fn:(rows:Record<string,string>[])=>void)=>{
  const file=e.target.files?.[0];e.target.value='';if(!file)return;
  file.text().then(t=>{const rows=parseCsv(t);if(!rows.length){setMsg({ok:false,text:'El archivo no tiene filas: usa la plantilla (primera fila = encabezados).'});return;}fn(rows);});
 };
 const uploadBudget=(rows:Record<string,string>[])=>send('budget',`/api/inputs/budgets/${kind}`,
  {rows:rows.map(r=>({month:col(r,'mes','month'),unit_name:col(r,'unidad','unidad de negocio','unit')||undefined,brand:col(r,'marca','brand')||undefined,amount:col(r,'monto','valor','amount','presupuesto')}))},
  `Presupuesto de ${KINDS.find(k=>k.id===kind)?.label.toLowerCase()} cargado: ${rows.length} filas. Los reportes ya lo usan.`);
 const uploadCampaigns=(rows:Record<string,string>[])=>send('campaigns','/api/inputs/campaigns',
  {rows:rows.map(r=>({name:col(r,'nombre','campana','campaña','name'),status:col(r,'estado','status')||'ejecutada',start_date:col(r,'inicio','fecha inicio','start'),
   end_date:col(r,'fin','fecha fin','end'),brand:col(r,'marca','brand')||undefined,unit_name:col(r,'unidad','unit')||undefined,investment:col(r,'inversion','inversión','monto','investment')||'0'}))},
  `Campañas cargadas: ${rows.length}. Marketing ya mide su venta, clientes captados y ROI.`);

 if(!live)return <section className="panel"><div className="panel-body"><p className="legend-note">Vista de demostración. Con el panel conectado, aquí cargas presupuestos, campañas y las reglas que separan tus unidades de negocio.</p></div></section>;
 if(!data)return <section className="panel"><div className="panel-body"><p className="legend-note"><Loader2 size={14} className="om-spin"/> Cargando…</p>{msg&&<p className="legend-note om-ai-error" role="alert">{msg.text}</p>}</div></section>;

 const optionsFor=(r:Rule)=>data.options.filter(o=>o.source_id===r.source_id&&o.match_type===r.match_type);
 const src=data.sources[0];
 return <div className="om-inputs">
  {msg&&<p className={`legend-note ${msg.ok?'':'om-ai-error'}`} role={msg.ok?'status':'alert'}>{msg.text}</p>}
  {!edit&&<p className="legend-note">Solo los administradores cargan presupuestos, campañas y unidades. Aquí ves lo que está vigente.</p>}

  <section className="panel" aria-labelledby="om-in-units">
   <header className="panel-heading"><h2 id="om-in-units">Unidades de negocio</h2><Layers3 size={15} aria-hidden="true"/></header>
   <div className="panel-body">
    <p className="legend-note">Cada venta de Odoo se asigna a la primera regla que coincide (menor prioridad primero), según su equipo de venta, diario, punto de venta o empresa. Los despachos heredan la unidad del pedido. Al guardar, OMEGA recalcula toda la historia en unos minutos.</p>
    {pending?<p className="om-ai-status"><RefreshCw size={14} className="om-spin"/> Recalculando la historia con las reglas nuevas…</p>
     :src?.rebuilt_at?<p className="om-ai-status"><CheckCircle2 size={14}/> Historia recalculada el {new Date(src.rebuilt_at).toLocaleString('es-EC',{dateStyle:'short',timeStyle:'short'})}</p>:null}
    <div className="table-scroll"><table className="om-in-table"><thead><tr><th>Coincide por</th><th>Valor en Odoo</th><th>Unidad de negocio</th><th>Canal</th><th className="num">Prioridad</th>{edit&&<th><span className="sr-only">Quitar</span></th>}</tr></thead>
     <tbody>{rules.length?rules.map((r,i)=>{const upd=(p:Partial<Rule>)=>setRules(rs=>rs.map((x,j)=>j===i?{...x,...p}:x));
      return <tr key={i}>
       <td><select aria-label="Coincide por" value={r.match_type} disabled={!edit} onChange={e=>upd({match_type:e.target.value,match_value:''})}>{MATCH.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></td>
       <td><select aria-label="Valor en Odoo" value={r.match_value} disabled={!edit} onChange={e=>upd({match_value:e.target.value})}><option value="">Elige…</option>{optionsFor(r).map(o=><option key={o.match_value} value={o.match_value}>{o.name||`#${o.match_value}`}</option>)}</select></td>
       <td><input aria-label="Unidad de negocio" list="om-in-unit-names" value={r.unit_name} disabled={!edit} maxLength={120} onChange={e=>upd({unit_name:e.target.value})}/></td>
       <td><input aria-label="Canal" value={r.channel} disabled={!edit} maxLength={60} onChange={e=>upd({channel:e.target.value})}/></td>
       <td className="num"><input aria-label="Prioridad" type="number" min={1} max={9999} value={r.priority} disabled={!edit} onChange={e=>upd({priority:Number(e.target.value)})}/></td>
       {edit&&<td><button type="button" className="link-button" aria-label="Quitar regla" onClick={()=>setRules(rs=>rs.filter((_,j)=>j!==i))}><Trash2 size={14}/></button></td>}
      </tr>;}):<tr><td colSpan={edit?6:5}><span className="block-missing">Sin reglas: toda la venta queda como "Sin unidad".</span></td></tr>}</tbody></table></div>
    <datalist id="om-in-unit-names">{data.units.map(u=><option key={u} value={u}/>)}</datalist>
    {edit&&src&&<div className="om-ai-actions">
     <button type="button" className="button secondary" onClick={()=>setRules(rs=>[...rs,{source_id:src.id,match_type:'team',match_value:'',unit_name:'',channel:'General',priority:(rs.length+1)*10}])}><Plus size={14}/>Agregar regla</button>
     <button type="button" className="button primary" disabled={!!busy} onClick={()=>send('units','/api/inputs/units',{rules},'Reglas guardadas. OMEGA recalcula la historia en los próximos minutos.')}>{busy==='units'?<Loader2 size={14} className="om-spin"/>:null}Guardar y recalcular</button>
    </div>}
   </div>
  </section>

  <section className="panel" aria-labelledby="om-in-budget">
   <header className="panel-heading"><h2 id="om-in-budget">Presupuestos</h2><CalendarRange size={15} aria-hidden="true"/></header>
   <div className="panel-body">
    <div className="om-in-kinds" role="tablist" aria-label="Tipo de presupuesto">{KINDS.map(k=><button key={k.id} type="button" role="tab" aria-selected={kind===k.id} className={`om-in-kind${kind===k.id?' is-active':''}`} onClick={()=>setKind(k.id)}>
     <strong>{k.label}</strong><small>{(data.budgets.filter(b=>b.kind===k.id).length)||'Sin'} fila{data.budgets.filter(b=>b.kind===k.id).length===1?'':'s'} · {k.hint}</small></button>)}</div>
    <p className="legend-note">Para armarlo mes a mes desde el real del año anterior usa <a href="#presupuesto">Planificación → Presupuesto</a>. Aquí puedes subirlo completo en un archivo CSV con columnas <code>mes;unidad;marca;monto</code>. El mes va como AAAA-MM; la unidad y la marca son opcionales (vacías = total de la empresa). Cargar un archivo reemplaza todo el presupuesto de este tipo.</p>
    {edit&&<div className="om-ai-actions">
     <button type="button" className="button secondary" onClick={()=>download(`plantilla-presupuesto-${kind}.csv`,`mes;unidad;marca;monto\n2026-01;;;100000\n2026-01;Mayorista Hogar;;60000\n2026-01;;${data.brands[0]||'Marca'};15000\n`)}><Download size={14}/>Descargar plantilla</button>
     <label className="button primary om-in-file">{busy==='budget'?<Loader2 size={14} className="om-spin"/>:<Upload size={14}/>}Subir CSV<input type="file" accept=".csv,text/csv" onChange={e=>readFile(e,uploadBudget)} disabled={!!busy}/></label>
    </div>}
    {budgets.length>0&&<div className="table-scroll"><table className="om-in-table"><thead><tr><th>Mes</th><th>Unidad</th><th>Marca</th><th className="num">Monto</th></tr></thead>
     <tbody>{budgets.slice(0,12).map((b,i)=><tr key={i}><td>{b.month}</td><td>{b.unit_name||'Empresa'}</td><td>{b.brand||'—'}</td><td className="num">{money(b.amount)}</td></tr>)}</tbody></table>
     {budgets.length>12&&<p className="legend-note">… y {budgets.length-12} filas más.</p>}</div>}
   </div>
  </section>

  <section className="panel" aria-labelledby="om-in-camp">
   <header className="panel-heading"><h2 id="om-in-camp">Campañas de marketing</h2><Megaphone size={15} aria-hidden="true"/></header>
   <div className="panel-body">
    <p className="legend-note">Columnas <code>nombre;estado;inicio;fin;marca;unidad;inversion</code>. Estado: ejecutada o planificada; fechas AAAA-MM-DD. OMEGA mide la venta de la marca o unidad durante las fechas de cada campaña, los clientes que compraron por primera vez y el ROI sobre el margen bruto. Cargar un archivo reemplaza la lista.</p>
    {edit&&<div className="om-ai-actions">
     <button type="button" className="button secondary" onClick={()=>download('plantilla-campanas.csv',`nombre;estado;inicio;fin;marca;unidad;inversion\nVerano 2026;ejecutada;2026-01-05;2026-02-15;${data.brands[0]||''};;4200\n`)}><Download size={14}/>Descargar plantilla</button>
     <label className="button primary om-in-file">{busy==='campaigns'?<Loader2 size={14} className="om-spin"/>:<Upload size={14}/>}Subir CSV<input type="file" accept=".csv,text/csv" onChange={e=>readFile(e,uploadCampaigns)} disabled={!!busy}/></label>
    </div>}
    {data.campaigns.length>0?<div className="table-scroll"><table className="om-in-table"><thead><tr><th>Campaña</th><th>Estado</th><th>Fechas</th><th>Marca</th><th>Unidad</th><th className="num">Inversión</th></tr></thead>
     <tbody>{data.campaigns.map(cp=><tr key={cp.id}><td>{cp.name}{cp.source&&cp.source!=='csv'?<small className="om-budget-hint">desde {cp.source}{cp.leads!=null?` · ${cp.leads} leads`:''}</small>:null}</td><td>{cp.status}</td><td>{cp.start_date} → {cp.end_date}</td><td>{cp.brand||'Todas'}</td><td>{cp.unit_name||'Todas'}</td><td className="num">{money(cp.investment)}</td></tr>)}</tbody></table></div>
     :<p className="block-missing">Sin campañas cargadas.</p>}
    {edit&&tenantId&&<MarketingConnect tenantId={tenantId}/>}
   </div>
  </section>
 </div>;
}
