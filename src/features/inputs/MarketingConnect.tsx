import {useCallback,useEffect,useState} from 'react';
import {Copy,KeyRound,Link2,Loader2,Trash2} from 'lucide-react';
import {api} from '../../data/api';

// Marketing app connection (Iris or any other): a company token and a push endpoint for campaigns,
// investment and leads. The token is shown once; the server stores only its hash.
type Info={tokens:{id:number;label:string|null;created_at:string;last_used_at:string|null}[];sources:{source:string;campaigns:string;last:string}[];endpoint:string};

export default function MarketingConnect({tenantId}:{tenantId:string}){
 const [info,setInfo]=useState<Info|null>(null);
 const [label,setLabel]=useState('Iris');
 const [token,setToken]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [msg,setMsg]=useState<{ok:boolean;text:string}|null>(null);
 const load=useCallback(async()=>{try{setInfo(await api<Info>('/api/integrations/marketing',{tenant:tenantId}));}catch(e){setMsg({ok:false,text:(e as Error).message});}},[tenantId]);
 useEffect(()=>{load();},[load]);
 const create=async()=>{setBusy(true);setMsg(null);
  try{const r=await api<{token:string}>('/api/integrations/marketing/tokens',{tenant:tenantId,method:'POST',body:{label}});setToken(r.token);await load();}
  catch(e){setMsg({ok:false,text:(e as Error).message});}finally{setBusy(false);}};
 const revoke=async(id:number)=>{setBusy(true);setMsg(null);
  try{await api(`/api/integrations/marketing/tokens/${id}`,{tenant:tenantId,method:'DELETE'});setMsg({ok:true,text:'Token revocado: la app ya no puede enviar datos con él.'});await load();}
  catch(e){setMsg({ok:false,text:(e as Error).message});}finally{setBusy(false);}};
 const url=`${location.origin}${info?.endpoint||'/api/integrations/marketing/campaigns'}`;
 const example=`POST ${url}
Authorization: Bearer ${token||'omk_…'}
Content-Type: application/json

{"source": "${label.toLowerCase().replace(/[^a-z0-9_-]/g,'')||'iris'}",
 "campaigns": [{"id": "CMP-001", "name": "Verano 2026", "status": "ejecutada",
   "start_date": "2026-01-05", "end_date": "2026-02-15",
   "brand": "Marca", "unit": "Unidad 1", "investment": 4200, "leads": 310}]}`;
 const copy=(t:string)=>{navigator.clipboard?.writeText(t).then(()=>setMsg({ok:true,text:'Copiado.'}),()=>{});};

 return <div className="om-mkt">
  <h3><Link2 size={14} aria-hidden="true"/> Conexión con tu app de marketing</h3>
  <p className="legend-note">Iris o tu app de marketing envían sus campañas, inversión y leads a OMEGA con un token de tu empresa. Cada campaña se actualiza por su <code>id</code>, sin duplicarse, y Marketing la mide contra la venta real.</p>
  {info?.sources.filter(s=>s.source!=='csv').map(s=><p key={s.source} className="om-ai-status">Conectada: <b>{s.source}</b> · {s.campaigns} campañas · última actualización {new Date(s.last).toLocaleString('es-EC',{dateStyle:'short',timeStyle:'short'})}</p>)}
  <div className="om-ai-actions">
   <label htmlFor="om-mkt-label" className="om-mkt-label"><span>Nombre de la app</span><input id="om-mkt-label" value={label} maxLength={80} onChange={e=>setLabel(e.target.value)}/></label>
   <button type="button" className="button primary" onClick={create} disabled={busy||!label.trim()}>{busy?<Loader2 size={14} className="om-spin"/>:<KeyRound size={14}/>}Crear token</button>
  </div>
  {token&&<div className="om-ai-test" role="status"><span className="om-eyebrow">Token nuevo: cópialo ahora, no se vuelve a mostrar</span><p><code className="om-mkt-token">{token}</code></p>
   <button type="button" className="button secondary" onClick={()=>copy(token)}><Copy size={14}/>Copiar token</button></div>}
  {!!info?.tokens.length&&<div className="table-scroll"><table className="om-in-table"><thead><tr><th>App</th><th>Creado</th><th>Último envío</th><th><span className="sr-only">Revocar</span></th></tr></thead>
   <tbody>{info.tokens.map(t=><tr key={t.id}><td>{t.label||'App'}</td><td>{new Date(t.created_at).toLocaleDateString('es-EC')}</td><td>{t.last_used_at?new Date(t.last_used_at).toLocaleString('es-EC',{dateStyle:'short',timeStyle:'short'}):'Sin envíos aún'}</td>
    <td><button type="button" className="link-button" aria-label={`Revocar token de ${t.label||'app'}`} onClick={()=>revoke(t.id)} disabled={busy}><Trash2 size={14}/>Revocar</button></td></tr>)}</tbody></table></div>}
  <details className="om-mkt-doc"><summary>Cómo debe enviar los datos tu app</summary>
   <pre>{example}</pre>
   <button type="button" className="button secondary" onClick={()=>copy(example)}><Copy size={14}/>Copiar ejemplo</button>
   <p className="legend-note">Campos: <code>id</code> y <code>name</code> obligatorios; fechas AAAA-MM-DD; <code>status</code> ejecutada o planificada; <code>brand</code> y <code>unit</code> opcionales (vacíos = toda la empresa); <code>investment</code> en dólares; <code>leads</code> opcional. Hasta 2.000 campañas por envío.</p>
  </details>
  {msg&&<p className={`legend-note ${msg.ok?'':'om-ai-error'}`} role={msg.ok?'status':'alert'}>{msg.text}</p>}
 </div>;
}
