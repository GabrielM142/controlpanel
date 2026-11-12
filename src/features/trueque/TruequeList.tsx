import {useCallback,useEffect,useState} from 'react';
import {AlertCircle,ArrowUpRight,Loader2,PackageCheck,RefreshCw,Send} from 'lucide-react';
import {api} from '../../data/api';
import {terms,termsSha256} from '../../data/terms';
import {useLive} from '../live/LiveData';

type Request={id:string;created_at:string;client_name:string;plan:string;title:string;priority:string;status:string;tokens_used?:number;idempotency_key?:string;terms_version?:string;[k:string]:unknown};

const statusLabel:Record<string,string>={pending_send:'Pendiente de envío',received:'Recibida',analyzing:'En análisis',quoted:'Cotizada',approved:'Aprobada',in_progress:'En desarrollo',delivered:'Entregada',archived:'Archivada'};
const statusTone:Record<string,'g'|'a'|'r'|'muted'>={pending_send:'r',received:'a',analyzing:'a',quoted:'g',approved:'g',in_progress:'a',delivered:'g',archived:'muted'};

function readLocal():Request[]{try{const raw=localStorage.getItem('nova.factory.local');if(!raw)return [];const arr=JSON.parse(raw);return Array.isArray(arr)?arr:[];}catch{return [];}}

export default function TruequeList(){
 const [items,setItems]=useState<Request[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState<string|null>(null);
 const [source,setSource]=useState<'live'|'local'|'mixed'>('local');
 const live=useLive();

 const load=useCallback(async()=>{
  setLoading(true);setError(null);
  const local=readLocal();
  if(!live.live||!live.tenantId){setItems(local);setSource('local');setError(local.length?'Modo demostración: estas solicitudes solo existen en este navegador y no fueron recibidas.':null);setLoading(false);return;}
  try{
   const j=await api<{requests:Request[]}>('/api/factory/requests?limit=50',{tenant:live.tenantId});
   setItems([...local,...j.requests]);setSource(local.length?'mixed':'live');
   if(local.length)setError('Hay solicitudes pendientes de envío guardadas en este navegador.');
  }catch(e){
   setItems(local);setSource('local');setError(`No se pudo consultar el servidor (${(e as Error).message}). Mostrando solo pendientes locales.`);
  }finally{setLoading(false);}
 },[live.live,live.tenantId]);

 const retry=async(r:Request)=>{
  if(!live.tenantId||r.terms_version!==terms.version){setError('Los términos cambiaron: volvé a crear la solicitud y aceptá la versión vigente.');return;}
  try{
   const {id:_id,created_at:_c,status:_s,idempotency_key,...payload}=r;
   await api('/api/factory/requests',{tenant:live.tenantId,method:'POST',headers:{'Idempotency-Key':String(idempotency_key||r.id)},
    body:{...payload,terms_accepted:true,terms_sha256:await termsSha256()}});
   const rest=readLocal().filter(x=>x.id!==r.id);
   try{localStorage.setItem('nova.factory.local',JSON.stringify(rest));}catch{}
   await load();
  }catch(e){setError(`Reintento fallido: ${(e as Error).message}`);}
 };

 useEffect(()=>{load();},[load]);

 return <>
  <h2 className="section-label"><span>Mis solicitudes a Nova Business</span><i/></h2>
  <section className="panel">
   <header className="panel-heading" style={{gap:12}}>
    <h2><PackageCheck size={13} style={{verticalAlign:'-2px',marginRight:6}}/>Historial ({items.length})</h2>
    <div style={{display:'flex',gap:8,alignItems:'center'}}>
     <span className="ph">{source==='live'?'DB':source==='mixed'?'DB + LOCAL':'LOCAL'}</span>
     <button type="button" className="button secondary" onClick={load} disabled={loading}>{loading?<Loader2 size={13} className="spin"/>:<RefreshCw size={13}/>}Recargar</button>
    </div>
   </header>
   <div className="panel-body" style={{padding:0}}>
    {error&&<div className="legend-note" style={{margin:16}}><AlertCircle size={12} style={{verticalAlign:'-2px',marginRight:6}}/>{error}</div>}
    {items.length===0&&!loading
     ?<div style={{padding:'40px 20px',textAlign:'center',color:'var(--muted)'}}>
       <p>Todavía no enviaste solicitudes. Andá a <b>Nova Factory · Nueva solicitud</b> para empezar.</p>
      </div>
     :<div className="table-scroll"><table>
      <thead><tr><th>Fecha</th><th>Módulo</th><th>Empresa</th><th>Plan</th><th>Prioridad</th><th>Estado</th><th className="num">Tokens</th><th></th></tr></thead>
      <tbody>{items.map(r=><tr key={r.id}>
       <td>{new Date(r.created_at).toLocaleDateString('es-EC',{day:'2-digit',month:'short',year:'2-digit'})}</td>
       <td><b>{r.title}</b></td>
       <td>{r.client_name}</td>
       <td><span className="ph">{r.plan.toUpperCase()}</span></td>
       <td><span className={`tag ${r.priority==='alta'||r.priority==='urgente'?'r':r.priority==='baja'?'g':'a'}`}>{r.priority}</span></td>
       <td><span className={`ticket-status s-${statusTone[r.status]||'a'}`}>{statusLabel[r.status]||r.status}</span></td>
       <td className="num">{r.tokens_used??'—'}</td>
       <td>{r.status==='pending_send'&&live.live
        ?<button type="button" className="row-link" onClick={()=>retry(r)}>Reintentar envío <Send size={13}/></button>
        :<a className="row-link" href="#trueque" aria-label="Abrir detalle" title="Detalle disponible en la próxima iteración">Detalle <ArrowUpRight size={13}/></a>}</td>
      </tr>)}</tbody>
     </table></div>}
   </div>
  </section>
  <p className="legend-note" style={{marginTop:14}}><b>Nova Business.</b> Los módulos entregados se despliegan como paquetes independientes dentro del ERP existente. Los tokens se consumen por captación y análisis; no se acumulan mes a mes.</p>
 </>;
}
