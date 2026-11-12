import {useCallback,useEffect,useState} from 'react';
import {AlertCircle,CheckCircle2,Database,Link2,Loader2,Pause,Play,PlugZap,RefreshCw} from 'lucide-react';
import {api} from '../../data/api';
import {useLive} from './LiveData';

type Source={id:string;name:string;base_url:string;db_name:string;login:string;status:string;installation_uuid:string|null;source_generation:number|null;
 last_collect_at:string|null;next_collect_at:string|null;last_error:string|null;consecutive_failures:number;odoo_version:string|null;connector_version:string|null;
 companies:{id:number;name:string;authorized:boolean}[]|null;datasets:{key:string;available:boolean;missing_required:string[]}[]|null};
type Run={run_seq:number;state:string;business_date:string;observed_from:string|null;observed_to:string|null;acked_at:string|null;published_at:string|null;attempts:number;error:string|null;totals:{parts:number;records:number;bytes:number}|null};

const statusLabel:Record<string,string>={pending_link:'Pendiente de vincular',active:'Activa',paused:'Pausada',relink_required:'Re-vincular',error:'Error'};
const tone=(s:string)=>s==='active'||s==='published'?'g':s==='paused'||s==='pending_link'||s==='validated'?'a':'r';
const dt=(v:string|null)=>v?new Date(v).toLocaleString('es-EC',{dateStyle:'short',timeStyle:'short'}):'—';

function DemoExplainer(){
 return <>
  <h2 className="section-label"><span>Fuentes de datos</span><i/></h2>
  <section className="panel"><header className="panel-heading"><h2>Modo demostración</h2><span className="panel-mark"/></header><div className="panel-body">
   <p className="legend-note"><AlertCircle size={12}/> Esta instalación muestra <b>datos de ejemplo</b>: no hay backend NOVA configurado (VITE_NOVA_API_URL) ni conexión a Odoo.</p>
   <ol className="sources-steps">
    <li>Instalar en Odoo 16 los addons <code>nova_connector</code> + los funcionales que apliquen (ventas, contabilidad, inventario, POS).</li>
    <li>Crear el usuario técnico de integración con API key y generar el código de vinculación en Odoo → NOVA → Conexión.</li>
    <li>Registrar aquí la fuente (URL HTTPS, base, usuario, API key) y pegar el código de vinculación.</li>
    <li>Odoo prepara lotes desde las 00:00 locales; NOVA los recoge desde las 03:00 (America/Guayaquil), valida, confirma y publica.</li>
   </ol>
  </div></section>
 </>;
}

export default function DataSourcesView(){
 const {live,tenantId,membership,refreshStatus}=useLive();
 const [sources,setSources]=useState<Source[]>([]);
 const [runs,setRuns]=useState<Record<string,Run[]>>({});
 const [error,setError]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [form,setForm]=useState({name:'',base_url:'',db_name:'',login:'',api_key:'',collect_after:'03:00'});
 const [token,setToken]=useState<Record<string,string>>({});
 const admin=membership&&(membership.role==='owner'||membership.role==='admin');

 const load=useCallback(async()=>{
  if(!tenantId||!admin)return;
  setBusy(true);setError(null);
  try{const r=await api<{sources:Source[]}>('/api/sources',{tenant:tenantId});setSources(r.sources);}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 },[tenantId,admin]);
 useEffect(()=>{load();},[load]);

 if(!live)return <DemoExplainer/>;
 if(!admin)return <section className="panel"><div className="panel-body"><p className="legend-note">Solo los administradores de la empresa gestionan las fuentes. El estado de la última publicación aparece en la barra superior.</p></div></section>;

 const act=async(id:string,action:string,body:unknown={})=>{
  setBusy(true);setError(null);
  try{await api(`/api/sources/${id}/${action}`,{tenant:tenantId,method:'POST',body});await load();await refreshStatus();}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 };
 const showRuns=async(id:string)=>{try{const r=await api<{runs:Run[]}>(`/api/sources/${id}/runs`,{tenant:tenantId});setRuns(x=>({...x,[id]:r.runs}));}catch(e){setError((e as Error).message);}};
 const create=async()=>{
  setBusy(true);setError(null);
  try{await api('/api/sources',{tenant:tenantId,method:'POST',body:form});setForm({name:'',base_url:'',db_name:'',login:'',api_key:'',collect_after:'03:00'});await load();}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 };

 return <>
  <h2 className="section-label"><span>Fuentes de datos · {membership?.name}</span><i/></h2>
  {error&&<p className="legend-note"><AlertCircle size={12}/> {error}</p>}
  {sources.map(s=><section className="panel" key={s.id}>
   <header className="panel-heading" style={{gap:10}}>
    <h2><Database size={13}/> {s.name} <span className={`tag ${tone(s.status)}`}>{statusLabel[s.status]||s.status}</span></h2>
    <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
     <button className="button secondary" disabled={busy} onClick={()=>act(s.id,'test')}><PlugZap size={13}/>Probar conexión</button>
     <button className="button secondary" disabled={busy||s.status!=='active'} onClick={()=>act(s.id,'collect')}><RefreshCw size={13}/>Recoger lotes listos</button>
     {s.status==='paused'?<button className="button secondary" disabled={busy} onClick={()=>act(s.id,'resume')}><Play size={13}/>Reanudar</button>
      :<button className="button secondary" disabled={busy||s.status!=='active'} onClick={()=>act(s.id,'pause')}><Pause size={13}/>Pausar</button>}
     <button className="button secondary" onClick={()=>showRuns(s.id)}>Lotes</button>
    </div>
   </header>
   <div className="panel-body">
    <div className="table-scroll"><table><tbody>
     <tr><td>Odoo</td><td>{s.base_url} · base <b>{s.db_name}</b> · usuario técnico <b>{s.login}</b></td></tr>
     <tr><td>Instalación</td><td>{s.installation_uuid?`${s.installation_uuid} · generación ${s.source_generation}`:'Sin vincular'} {s.connector_version&&`· conector ${s.connector_version} · Odoo ${s.odoo_version}`}</td></tr>
     <tr><td>Compañías autorizadas</td><td>{s.companies?.map(c=>c.name).join(', ')||'—'}</td></tr>
     <tr><td>Última recolección</td><td>{dt(s.last_collect_at)} · próxima {dt(s.next_collect_at)}{s.consecutive_failures>0&&` · ${s.consecutive_failures} fallos seguidos`}</td></tr>
     {s.datasets&&<tr><td>Datasets</td><td>{s.datasets.filter(d=>d.available).length} disponibles{s.datasets.some(d=>d.missing_required?.length)&&<> · <b>con campos faltantes:</b> {s.datasets.filter(d=>d.missing_required?.length).map(d=>d.key).join(', ')}</>}</td></tr>}
     {s.last_error&&<tr><td>Último error</td><td className="r">{s.last_error}</td></tr>}
    </tbody></table></div>
    {s.status!=='active'&&s.status!=='paused'&&<div className="sources-link">
     <input aria-label="Código de vinculación" placeholder="Código de vinculación generado en Odoo" value={token[s.id]||''} onChange={e=>setToken(t=>({...t,[s.id]:e.target.value}))}/>
     <button className="button primary" disabled={busy||!token[s.id]} onClick={()=>act(s.id,'link',{link_token:token[s.id]})}><Link2 size={13}/>Vincular</button>
    </div>}
    {runs[s.id]&&<div className="table-scroll"><table>
     <thead><tr><th>Lote</th><th>Fecha negocio</th><th>Estado</th><th>Capturado</th><th>Confirmado</th><th>Publicado</th><th className="num">Registros</th><th className="num">Bytes</th><th>Error</th></tr></thead>
     <tbody>{runs[s.id].map(r=><tr key={r.run_seq}><td>#{r.run_seq}</td><td>{r.business_date}</td><td><span className={`tag ${tone(r.state)}`}>{r.state}</span></td>
      <td>{dt(r.observed_from)} → {dt(r.observed_to)}</td><td>{r.acked_at?<CheckCircle2 size={13}/>:'—'}</td><td>{dt(r.published_at)}</td>
      <td className="num">{r.totals?.records??'—'}</td><td className="num">{r.totals?.bytes??'—'}</td><td>{r.error||''}</td></tr>)}</tbody>
    </table></div>}
   </div>
  </section>)}
  <section className="panel">
   <header className="panel-heading"><h2>Registrar fuente Odoo 16</h2><span className="panel-mark"/></header>
   <div className="panel-body sources-form">
    {([['name','Nombre'],['base_url','URL HTTPS de Odoo'],['db_name','Base de datos'],['login','Usuario técnico'],['api_key','API key'],['collect_after','Recoger desde (America/Guayaquil)']] as const).map(([k,l])=>
     <label key={k} className="filter"><span>{l}</span><input type={k==='api_key'?'password':'text'} autoComplete="off" value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))}/></label>)}
    <button className="button primary" disabled={busy||!form.name||!form.base_url||!form.api_key} onClick={create}>{busy?<Loader2 size={13} className="spin"/>:<Database size={13}/>}Registrar</button>
    <p className="legend-note">La API key se cifra en el servidor y solo el worker la descifra. Nunca se guarda en el navegador.</p>
   </div>
  </section>
 </>;
}
