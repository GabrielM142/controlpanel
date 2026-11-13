import {useMemo,useState} from 'react';
import {ArrowRight,BellOff,BellRing,CheckCheck,Loader2} from 'lucide-react';
import {useLive} from '../live/LiveData';
import {KIND_LABEL,useNotifications} from './useNotifications';

// Centro de notificaciones del gerente: lo que pasó en la empresa y requiere revisión, con filtro
// por tipo, marcar como leídas y elegir qué tipos recibir.
const TONE:Record<string,string>={critica:'var(--fin-loss)',atencion:'var(--fin-risk)',info:'var(--fin-ai)'};

export default function NotificationsView(){
 const {live}=useLive();
 const {data,error,markRead,setMuted}=useNotifications();
 const [kind,setKind]=useState<string>('todas');
 const [state,setState]=useState<'todas'|'no_leidas'>('no_leidas');
 const [busy,setBusy]=useState(false);
 const items=useMemo(()=>(data?.items||[]).filter(n=>(kind==='todas'||n.kind===kind)&&(state==='todas'||!n.read_at)),[data,kind,state]);
 if(!live)return <section className="panel"><div className="panel-body"><p className="legend-note">Vista de demostración. Con el panel conectado, aquí revisas las notificaciones de tu empresa.</p></div></section>;
 if(!data)return <section className="panel" aria-busy="true"><div className="panel-body"><p className="legend-note"><Loader2 size={14} className="om-spin"/> Cargando notificaciones…</p>{error&&<p className="legend-note om-ai-error">{error}</p>}</div></section>;
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);try{await fn();}finally{setBusy(false);}};
 return <div className="om-notif">
  <div className="grid g-4">
   <article className={`panel kpi tone-${data.unread?'a':'g'}`}><div className="kpi-label"><span>Sin leer</span><BellRing size={14} aria-hidden="true"/></div><div className="kpi-value">{data.unread}</div><p className="block-note">De todos los tipos activos</p></article>
   {['umbral','ticket','truekens'].map(k=><article key={k} className={`panel kpi tone-${data.unread_by_kind[k]?'a':'g'}`}><div className="kpi-label"><span>{KIND_LABEL[k]}</span><span className={`status-dot ${data.unread_by_kind[k]?'a':'g'}`}/></div><div className="kpi-value">{data.unread_by_kind[k]||0}</div><p className="block-note">sin leer</p></article>)}
  </div>
  <section className="panel" aria-labelledby="om-nt-list">
   <header className="panel-heading"><h2 id="om-nt-list">Notificaciones</h2>
    <button type="button" className="button secondary" disabled={busy||!data.unread} onClick={()=>run(()=>markRead('all'))}>{busy?<Loader2 size={14} className="om-spin"/>:<CheckCheck size={14}/>}Marcar todo como leído</button></header>
   <div className="panel-body">
    <div className="om-nt-filters">
     <div className="segmented" role="group" aria-label="Estado">{(['no_leidas','todas'] as const).map(s=><button key={s} type="button" aria-pressed={state===s} onClick={()=>setState(s)}>{s==='no_leidas'?'Sin leer':'Todas'}</button>)}</div>
     <div className="segmented" role="group" aria-label="Tipo">{['todas',...data.kinds.filter(k=>!data.muted.includes(k))].map(k=><button key={k} type="button" aria-pressed={kind===k} onClick={()=>setKind(k)}>{k==='todas'?'Todos':KIND_LABEL[k]||k}{k!=='todas'&&data.unread_by_kind[k]?` (${data.unread_by_kind[k]})`:''}</button>)}</div>
    </div>
    <ul className="om-nt-items">{items.length?items.map(n=><li key={n.id} className={n.read_at?'is-read':''}>
     <span className="om-nt-dot" style={{background:TONE[n.severity]}} aria-hidden="true"/>
     <div><strong>{n.title}</strong>{n.body&&<p>{n.body}</p>}<small>{KIND_LABEL[n.kind]||n.kind} · {new Date(n.created_at).toLocaleString('es-EC',{dateStyle:'short',timeStyle:'short'})}{n.read_at?' · leída':''}</small></div>
     <div className="om-nt-actions">{n.page_id&&<a className="row-link" href={`#${n.page_id}`} onClick={()=>{if(!n.read_at)markRead([n.id]);}}>Revisar <ArrowRight size={12}/></a>}
      {!n.read_at&&<button type="button" className="link-button" onClick={()=>markRead([n.id])}>Marcar leída</button>}</div>
    </li>):<li className="om-nt-empty">{state==='no_leidas'?'No tienes notificaciones sin leer.':'Sin notificaciones.'}</li>}</ul>
   </div>
  </section>
  <section className="panel" aria-labelledby="om-nt-prefs"><header className="panel-heading"><h2 id="om-nt-prefs">Qué quiero recibir</h2><BellOff size={15} aria-hidden="true"/></header>
   <div className="panel-body"><div className="om-cf-months">{data.kinds.map(k=>{const on=!data.muted.includes(k);return <label key={k} className={`om-cf-chip${on?' is-on':''}`}>
    <input type="checkbox" checked={on} disabled={busy} onChange={e=>run(()=>setMuted(e.target.checked?data.muted.filter(x=>x!==k):[...data.muted,k]))}/>{KIND_LABEL[k]||k}</label>;})}</div>
    <p className="legend-note">Las notificaciones de umbrales se generan después de cada cierre publicado; las de tickets, al crearlos o asignarlos; las de Truekens, al llegar al 80% y al 100% de la cuota. Telegram se configura en Umbrales y alertas.</p></div></section>
 </div>;
}
