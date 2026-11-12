import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {CircleSlash,Download,Loader2,Search,SlidersHorizontal,Warehouse,X} from 'lucide-react';
import {useLive,versionKey} from '../live/LiveData';
import {cachedGet} from '../live/cache';

// Valorización de inventario por bodega. Live: /api/inventory/warehouses (published data,
// served from the browser cache per publication). Demo: labelled example rows.
type WhRow={id:string;name:string;code:string|null;value:string;qty:string;skus:number};
type LocRow={id:string;name:string;warehouse:string;value:string;qty:string;skus:number};
type ProductRow={name:string;code:string|null;category:string;unit_cost:string|null;qty:string;value:string;warehouses:number};
type Payload={mode:'live';published:{version:number;business_date:string}|null;
 totals?:{value:string;qty:string;skus:number;warehouses:number;without_cost:number};
 warehouses?:WhRow[];locations?:LocRow[];categories?:{name:string;value:string}[];products?:ProductRow[];
 options?:{warehouses:{id:string;name:string}[];categories:string[];locations:{id:string;name:string;warehouse_id:string}[]}};

const money=(v:number)=>v.toLocaleString('es-EC',{style:'currency',currency:'USD',maximumFractionDigits:0});
const money2=(v:number)=>v.toLocaleString('es-EC',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});
const units=(v:number)=>v.toLocaleString('es-EC',{maximumFractionDigits:0});
const num=(s:string|null|undefined)=>Number(s||0);

const DEMO:Payload=(()=>{
 const wh:WhRow[]=[{id:'1',name:'Bodega Matriz Cuenca',code:'MAT',value:'412850',qty:'18420',skus:1240},{id:'2',name:'Bodega Guayaquil',code:'GYE',value:'236410',qty:'9310',skus:860},{id:'3',name:'Bodega Quito',code:'UIO',value:'154230',qty:'6120',skus:610},{id:'4',name:'Tránsito / Consignación',code:'TRN',value:'38900',qty:'1440',skus:120}];
 const products:ProductRow[]=[['Refrigeradora 14 pies','REF-14','Línea blanca','612.40','220'],['Lavadora 18 kg','LAV-18','Línea blanca','488.10','190'],['Televisor 55"','TV-55','Electrónica','402.75','160'],['Cocina 6 quemadores','COC-6','Línea blanca','318.20','185'],['Juego de ollas 7 pzs','OLL-7','Hogar','42.30','1150']]
  .map(([name,code,category,cost,qty])=>({name,code,category,unit_cost:cost,qty,value:String(num(cost)*num(qty)),warehouses:3}));
 const total=wh.reduce((s,w)=>s+num(w.value),0);
 return {mode:'live',published:{version:0,business_date:'demo'},totals:{value:String(total),qty:'35290',skus:2830,warehouses:4,without_cost:12},
  warehouses:wh,locations:[{id:'11',name:'MAT/Stock',warehouse:'Bodega Matriz Cuenca',value:'352850',qty:'15400',skus:1180},{id:'12',name:'MAT/Exhibición',warehouse:'Bodega Matriz Cuenca',value:'60000',qty:'3020',skus:310},{id:'21',name:'GYE/Stock',warehouse:'Bodega Guayaquil',value:'236410',qty:'9310',skus:860},{id:'31',name:'UIO/Stock',warehouse:'Bodega Quito',value:'154230',qty:'6120',skus:610},{id:'41',name:'TRN/Consignación',warehouse:'Tránsito / Consignación',value:'38900',qty:'1440',skus:120}],categories:[{name:'Línea blanca',value:'402300'},{name:'Electrónica',value:'251900'},{name:'Hogar',value:'188190'}],products,
  options:{warehouses:wh.map(w=>({id:w.id,name:w.name})),categories:['Electrónica','Hogar','Línea blanca'],locations:[]}};
})();

function csv(rows:ProductRow[]){
 const cell=(v:string)=>{let s=v;if(/^[=+\-@\t\r]/.test(s)&&!/^-?[\d.,]+$/.test(s))s=`'${s}`;return /[",\n\r;]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};
 const head=['Producto','Referencia','Categoría','Costo unitario','Cantidad','Valor','Bodegas'];
 const body=rows.map(r=>[r.name,r.code||'',r.category,r.unit_cost||'',r.qty,r.value,String(r.warehouses)].map(cell).join(','));
 const blob=new Blob([[head.join(','),...body].join('\r\n')+'\r\n'],{type:'text/csv;charset=utf-8'});
 const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='omega-valorizacion-bodegas.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export default function WarehouseView(){
 const {live,tenantId,status}=useLive();
 const version=versionKey(status);
 const [bodega,setBodegaRaw]=useState('');const [ubicacion,setUbicacion]=useState('');
 const setBodega=(v:string)=>{setBodegaRaw(v);setUbicacion('');};const [categoria,setCategoria]=useState('Todas');
 const [orden,setOrden]=useState<'valor'|'cantidad'>('valor');const [q,setQ]=useState('');const [draft,setDraft]=useState('');
 const [shown,setShown]=useState(25);
 const [data,setData]=useState<Payload|null>(live?null:DEMO);const [error,setError]=useState<string|null>(null);const [loading,setLoading]=useState(live);
 const query=new URLSearchParams(Object.entries({bodega,ubicacion,categoria:categoria==='Todas'?'':categoria,q,orden}).filter(([,v])=>v)).toString();

 useEffect(()=>{
  if(!live){setData(DEMO);setLoading(false);return;}
  if(!tenantId||version===null)return;
  let off=false;setLoading(true);setError(null);setShown(25);
  cachedGet<Payload>(tenantId,`/api/inventory/warehouses?${query}`,version)
   .then(d=>{if(!off)setData(d);}).catch(e=>{if(!off)setError((e as Error).message);}).finally(()=>{if(!off)setLoading(false);});
  return()=>{off=true;};
 },[live,tenantId,version,query]);

 const view=useMemo(()=>{
  if(!data?.totals)return null;
  let rows=data.warehouses||[];let products=data.products||[];let locs=data.locations||[];
  if(!live){ // demo: apply the same filters locally
   if(bodega){rows=rows.filter(r=>r.id===bodega);locs=locs.filter(l=>l.warehouse===rows[0]?.name);}
   if(categoria!=='Todas')products=products.filter(p=>p.category===categoria);
   if(q)products=products.filter(p=>(p.name+' '+(p.code||'')).toLowerCase().includes(q.toLowerCase()));
   products=[...products].sort((a,b)=>orden==='cantidad'?num(b.qty)-num(a.qty):num(b.value)-num(a.value));
  }
  const total=live?num(data.totals.value):rows.reduce((s,r)=>s+num(r.value),0);
  const max=Math.max(1,...rows.map(r=>num(r.value)));
  const top=rows[0];const share=top&&total?Math.round(num(top.value)/total*100):0;
  return {rows,products,locs,total,max,top,share,cats:data.categories||[]};
 },[data,live,bodega,categoria,q,orden]);

 const submit=(e:FormEvent)=>{e.preventDefault();setQ(draft.trim());};
 const locOptions=(data?.options?.locations||[]).filter(l=>!bodega||l.warehouse_id===bodega);
 const active=[bodega&&(data?.options?.warehouses.find(w=>w.id===bodega)?.name||'Bodega'),ubicacion&&(locOptions.find(l=>l.id===ubicacion)?.name||'Ubicación'),categoria!=='Todas'&&categoria,q&&`“${q}”`].filter(Boolean) as string[];
 const clear=()=>{setBodega('');setUbicacion('');setCategoria('Todas');setQ('');setDraft('');};

 return <>
  <div className="filters om-wh-filters" role="search" aria-label="Filtros de valorización">
   <span className="filter-label"><SlidersHorizontal size={15}/>Filtros</span>
   <div className="filter-controls">
    <label className="filter"><span>Bodega</span><select value={bodega} onChange={e=>setBodega(e.target.value)}>
     <option value="">Todas</option>{(data?.options?.warehouses||[]).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
    {locOptions.length>0&&<label className="filter"><span>Ubicación</span><select value={ubicacion} onChange={e=>setUbicacion(e.target.value)}>
     <option value="">Todas</option>{locOptions.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>}
    <label className="filter"><span>Categoría</span><select value={categoria} onChange={e=>setCategoria(e.target.value)}>
     <option>Todas</option>{(data?.options?.categories||[]).map(c=><option key={c}>{c}</option>)}</select></label>
    <label className="filter"><span>Ordenar por</span><select value={orden} onChange={e=>setOrden(e.target.value as 'valor'|'cantidad')}>
     <option value="valor">Valor</option><option value="cantidad">Cantidad</option></select></label>
    <form className="filter om-wh-search" onSubmit={submit}><label htmlFor="om-wh-q"><span>Producto</span></label>
     <input id="om-wh-q" type="search" value={draft} placeholder="Nombre o referencia" maxLength={80} onChange={e=>setDraft(e.target.value)}/>
     <button type="submit" className="icon-button" aria-label="Buscar producto"><Search size={15}/></button></form>
   </div>
   {active.length>0&&<button type="button" className="om-wh-clear" onClick={clear}><X size={13}/>Quitar filtros ({active.length})</button>}
  </div>

  <div className="om-wh">
   {!live&&<p className="legend-note om-wh-demo">Vista de demostración: bodegas y cifras de ejemplo. Con Odoo conectado se calcula con las existencias y el costo de cada producto.</p>}
   {error&&<p className="legend-note" role="alert"><CircleSlash size={13}/> {error}</p>}
   {live&&data&&!data.published&&!loading&&<p className="legend-note">Aún no hay datos publicados para esta empresa. Configura la fuente en <b>Configuración · Fuentes de datos</b>.</p>}
   {loading&&!view&&<div className="om-wh-loading" aria-busy="true"><Loader2 size={16} className="om-spin"/>Calculando la valorización…</div>}

   {view&&<>
    <section className="om-lead" aria-label="Lectura de Omega" aria-live="polite">
     <span className="omega-glyph" aria-hidden="true">Ω</span>
     <div><span className="om-eyebrow">Lectura de Omega</span><p>{view.top?<>Tienes <b>{money(view.total)}</b> en inventario{active.length?' con estos filtros':''}. <b>{view.top.name}</b> concentra el <b>{view.share}%</b>{view.rows.length>1?` de ${view.rows.length} bodegas`:''}.</>:'No hay existencias valorizadas con estos filtros.'}
      {num(String(data?.totals?.without_cost))>0&&<> Hay <b>{data?.totals?.without_cost}</b> productos sin costo registrado: su valor cuenta como cero.</>}</p></div>
    </section>

    <h2 className="section-label"><span>Resumen</span><i/></h2>
    <div className="grid g-5 om-wh-kpis">
     <article className="panel kpi tone-g"><div className="kpi-label"><span>Valor del inventario</span><span className="status-dot g" aria-hidden="true"/></div><div className="kpi-value">{money(view.total)}</div><div className="kpi-deltas"><div><span>Costo promedio de capas</span><strong>Odoo</strong></div></div></article>
     <article className="panel kpi"><div className="kpi-label"><span>Unidades en bodega</span></div><div className="kpi-value">{units(num(data?.totals?.qty))}</div></article>
     <article className="panel kpi"><div className="kpi-label"><span>Productos con existencia</span></div><div className="kpi-value">{units(num(String(data?.totals?.skus)))}</div></article>
     <article className="panel kpi"><div className="kpi-label"><span>Bodegas</span></div><div className="kpi-value">{data?.totals?.warehouses}</div></article>
     <article className={`panel kpi ${num(String(data?.totals?.without_cost))>0?'tone-a':''}`}><div className="kpi-label"><span>Sin costo registrado</span>{num(String(data?.totals?.without_cost))>0&&<span className="status-dot a" aria-hidden="true"/>}</div><div className="kpi-value">{data?.totals?.without_cost}</div></article>
    </div>

    <div className="grid g-2 om-wh-grid">
     <section className="panel"><header className="panel-heading"><h2>Valor por bodega</h2><Warehouse size={15} aria-hidden="true"/></header><div className="panel-body">
      {view.rows.length?<div className="bar-list">{view.rows.map(r=>{const pct=view.total?Math.round(num(r.value)/view.total*1000)/10:0;return <div className="bar-row om-wh-row" key={r.id}>
       <button type="button" className="row-link bar-name" aria-pressed={bodega===r.id} title={`Filtrar por ${r.name}`} onClick={()=>setBodega(bodega===r.id?'':r.id)}>{r.name}</button>
       <div className="bar-track" role="img" aria-label={`${r.name}: ${money(num(r.value))}, ${pct}%`}><div className="bar-fill" style={{width:`${num(r.value)/view.max*100}%`}}/></div>
       <strong>{money(num(r.value))}<small>{pct}% · {units(num(r.qty))} u</small></strong></div>;})}</div>
       :<p className="block-missing"><CircleSlash size={13}/>Sin existencias para los filtros seleccionados.</p>}
     </div></section>
     <section className="panel"><header className="panel-heading"><h2>Valor por categoría</h2><span className="panel-mark" aria-hidden="true"/></header><div className="panel-body">
      {view.cats.length?<div className="bar-list">{view.cats.map(c=>{const m=Math.max(1,...view.cats.map(x=>num(x.value)));return <div className="bar-row" key={c.name}>
       <button type="button" className="row-link bar-name" aria-pressed={categoria===c.name} title={`Filtrar por ${c.name}`} onClick={()=>setCategoria(categoria===c.name?'Todas':c.name)}>{c.name}</button>
       <div className="bar-track" role="img" aria-label={`${c.name}: ${money(num(c.value))}`}><div className="bar-fill" style={{width:`${num(c.value)/m*100}%`}}/></div><strong>{money(num(c.value))}</strong></div>;})}</div>
       :<p className="block-missing"><CircleSlash size={13}/>Sin categorías para estos filtros.</p>}
     </div></section>
    </div>

    <section className="panel table-panel om-wh-locs"><header className="panel-heading"><h2>Valor por ubicación</h2><span className="panel-mark" aria-hidden="true"/></header>
     <div className="panel-body"><div className="table-scroll"><table>
      <thead><tr><th>Ubicación</th><th>Bodega</th><th className="num">Productos</th><th className="num">Cantidad</th><th className="num">Valor</th><th className="num">% del total</th></tr></thead>
      <tbody>{view.locs.length?view.locs.map(l=><tr key={l.id}><td>{live?<button type="button" className="row-link" aria-pressed={ubicacion===l.id} onClick={()=>setUbicacion(ubicacion===l.id?'':l.id)}>{l.name}</button>:l.name}</td><td>{l.warehouse}</td>
       <td className="num">{units(num(String(l.skus)))}</td><td className="num">{units(num(l.qty))}</td><td className="num"><b>{money(num(l.value))}</b></td><td className="num">{view.total?(num(l.value)/view.total*100).toFixed(1):'0.0'}%</td></tr>)
       :<tr><td colSpan={6}><span className="block-missing"><CircleSlash size={13}/>Sin ubicaciones para los filtros seleccionados.</span></td></tr>}</tbody>
     </table></div></div>
    </section>

    <section className="panel table-panel om-wh-table">
     <header className="panel-heading"><h2>Productos {orden==='cantidad'?'con más unidades':'de mayor valor'}{view.products.length>=200?' (primeros 200)':''}</h2>
      <button type="button" className="button secondary" onClick={()=>csv(view.products)} disabled={!view.products.length}><Download size={14}/>CSV</button></header>
     <div className="panel-body"><div className="table-scroll"><table>
      <thead><tr><th>Producto</th><th>Referencia</th><th>Categoría</th><th className="num">Costo unitario</th><th className="num">Cantidad</th><th className="num">Valor</th><th className="num">Bodegas</th></tr></thead>
      <tbody>{view.products.length?view.products.slice(0,shown).map((p,i)=><tr key={`${p.code}-${i}`}><td>{p.name}</td><td className="om-mono">{p.code||'—'}</td><td>{p.category}</td>
       <td className="num">{p.unit_cost===null?'Sin costo':money2(num(p.unit_cost))}</td><td className="num">{units(num(p.qty))}</td><td className="num"><b>{money(num(p.value))}</b></td><td className="num">{p.warehouses}</td></tr>)
       :<tr><td colSpan={7}><span className="block-missing"><CircleSlash size={13}/>Sin productos para los filtros seleccionados.</span></td></tr>}</tbody>
     </table></div>
     {view.products.length>shown&&<div className="om-wh-more"><span>Mostrando {shown} de {view.products.length}</span>
      <button type="button" className="button secondary" onClick={()=>setShown(n=>n+25)}>Mostrar 25 más</button>
      <button type="button" className="button secondary" onClick={()=>setShown(view.products.length)}>Ver todos</button></div>}
     </div>
    </section>
    <p className="legend-note om-wh-source"><span>Fuente: existencias en ubicaciones internas × costo unitario de las capas de valoración de Odoo · {live&&data?.published?`Cierre ${data.published.business_date} · versión ${data.published.version}`:'Demostración'}</span></p>
   </>}
  </div>
 </>;
}
