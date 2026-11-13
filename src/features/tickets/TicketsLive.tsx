import {useCallback,useEffect,useMemo,useState,type FormEvent} from 'react';
import {AlertTriangle,CheckCircle2,Clock3,Loader2,MessageSquare,Plus,Send,X} from 'lucide-react';
import {api} from '../../data/api';
import {useLive} from '../live/LiveData';

// Mesa de ayuda de OMEGA (conectada): tickets por empresa con SLA por prioridad, responsable,
// primera respuesta, resolución y conversación. Preparada para sincronizar con un Odoo Helpdesk.
type T={id:number;title:string;description:string|null;category:string;customer:string|null;priority:'alta'|'media'|'baja';
 status:'abierto'|'en_progreso'|'esperando'|'resuelto'|'cerrado';assignee_id:string|null;assignee_name:string|null;created_by_name:string|null;
 created_at:string;due_at:string;first_response_at:string|null;resolved_at:string|null;updated_at:string;source:string};
type List={tickets:T[];agents:{id:string;name:string|null;role:string}[];sla_hours:Record<string,number>;me:string;can_manage:boolean;
 kpis:{open:number;late:number;at_risk:number;solved_today:number;solved30:number;sla_pct:number|null;response_min:number|null;resolve_h:number|null}};
type Detail={ticket:T;comments:{id:number;body:string;internal:boolean;created_at:string;author:string|null}[]};
const STATUS:Record<T['status'],string>={abierto:'Abierto',en_progreso:'En progreso',esperando:'Esperando cliente',resuelto:'Resuelto',cerrado:'Cerrado'};
const PRIO:Record<T['priority'],string>={alta:'Alta',media:'Media',baja:'Baja'};
const when=(d:string)=>new Date(d).toLocaleString('es-EC',{dateStyle:'short',timeStyle:'short'});
function slaLeft(t:T){
 if(t.status==='resuelto'||t.status==='cerrado')return {label:t.resolved_at&&t.resolved_at<=t.due_at?'Dentro del SLA':'Fuera del SLA',tone:t.resolved_at&&t.resolved_at<=t.due_at?'g':'r'};
 const ms=Date.parse(t.due_at)-Date.now();const h=Math.abs(ms)/36e5;
 const txt=h<1?`${Math.round(h*60)} min`:h<48?`${h.toFixed(1)} h`:`${Math.round(h/24)} días`;
 const total=Date.parse(t.due_at)-Date.parse(t.created_at);
 return ms<0?{label:`Vencido hace ${txt}`,tone:'r'}:{label:`Vence en ${txt}`,tone:ms<total*0.2?'a':'g'};
}

export default function TicketsLive(){
 const {tenantId}=useLive();
 const [data,setData]=useState<List|null>(null);
 const [filter,setFilter]=useState<'abiertos'|'mios'|'vencidos'|'todos'>('abiertos');
 const [openId,setOpenId]=useState<number|null>(null);
 const [detail,setDetail]=useState<Detail|null>(null);
 const [creating,setCreating]=useState(false);
 const [form,setForm]=useState({title:'',description:'',customer:'',category:'general',priority:'media'});
 const [comment,setComment]=useState('');const [internal,setInternal]=useState(false);
 const [busy,setBusy]=useState(false);const [msg,setMsg]=useState<{ok:boolean;text:string}|null>(null);

 const load=useCallback(async()=>{if(!tenantId)return;try{setData(await api<List>('/api/tickets',{tenant:tenantId}));}catch(e){setMsg({ok:false,text:(e as Error).message});}},[tenantId]);
 const loadDetail=useCallback(async(id:number)=>{if(!tenantId)return;try{setDetail(await api<Detail>(`/api/tickets/${id}`,{tenant:tenantId}));}catch(e){setMsg({ok:false,text:(e as Error).message});}},[tenantId]);
 useEffect(()=>{load();},[load]);
 useEffect(()=>{if(openId)loadDetail(openId);else setDetail(null);},[openId,loadDetail]);

 const rows=useMemo(()=>(data?.tickets||[]).filter(t=>{
  const open=t.status!=='resuelto'&&t.status!=='cerrado';
  if(filter==='abiertos')return open;if(filter==='mios')return open&&t.assignee_id===data?.me;if(filter==='vencidos')return open&&Date.parse(t.due_at)<Date.now();return true;
 }),[data,filter]);

 const run=async(fn:()=>Promise<unknown>,ok?:string)=>{setBusy(true);setMsg(null);try{await fn();if(ok)setMsg({ok:true,text:ok});await load();if(openId)await loadDetail(openId);}catch(e){setMsg({ok:false,text:(e as Error).message});}finally{setBusy(false);}};
 const create=(e:FormEvent)=>{e.preventDefault();run(async()=>{const r=await api<{id:number}>('/api/tickets',{tenant:tenantId!,method:'POST',body:form});setCreating(false);setForm({title:'',description:'',customer:'',category:'general',priority:'media'});setOpenId(r.id);},'Ticket creado.');};
 const patch=(id:number,body:Record<string,unknown>)=>run(()=>api(`/api/tickets/${id}`,{tenant:tenantId!,method:'PATCH',body}));
 const send=(e:FormEvent)=>{e.preventDefault();if(!openId||!comment.trim())return;run(async()=>{await api(`/api/tickets/${openId}/comments`,{tenant:tenantId!,method:'POST',body:{body:comment,internal}});setComment('');});};

 if(!data)return <section className="panel"><div className="panel-body"><p className="legend-note"><Loader2 size={14} className="om-spin"/> Cargando tickets…</p>{msg&&<p className="legend-note om-ai-error" role="alert">{msg.text}</p>}</div></section>;
 const k=data.kpis;const t=detail?.ticket;
 return <div className="om-tk">
  <div className="grid g-4">
   <article className={`panel kpi tone-${k.late?'r':'g'}`}><div className="kpi-label"><span>Abiertos</span><span className={`status-dot ${k.late?'r':'g'}`}/></div><div className="kpi-value">{k.open}</div>
    <div className="kpi-deltas"><div><span>SLA vencido</span><strong className={k.late?'down':''}>{k.late}</strong></div><div><span>Por vencer</span><strong>{k.at_risk}</strong></div></div></article>
   <article className={`panel kpi tone-${k.sla_pct===null?'a':k.sla_pct>=95?'g':'r'}`}><div className="kpi-label"><span>SLA cumplido (30 días)</span><span className="status-dot a"/></div><div className="kpi-value">{k.sla_pct===null?'—':`${k.sla_pct.toFixed(0)}%`}</div><p className="block-note">{k.solved30} resueltos en 30 días</p></article>
   <article className="panel kpi tone-a"><div className="kpi-label"><span>Primera respuesta</span><span className="status-dot a"/></div><div className="kpi-value">{k.response_min===null?'—':k.response_min<120?`${Math.round(k.response_min)} min`:`${(k.response_min/60).toFixed(1)} h`}</div><p className="block-note">Promedio de 30 días</p></article>
   <article className="panel kpi tone-g"><div className="kpi-label"><span>Resueltos hoy</span><span className="status-dot g"/></div><div className="kpi-value">{k.solved_today}</div><p className="block-note">{k.resolve_h===null?'Sin resoluciones en 30 días':`Resolución promedio ${k.resolve_h.toFixed(1)} h`}</p></article>
  </div>

  <section className="panel table-panel" aria-labelledby="om-tk-list">
   <header className="panel-heading"><h2 id="om-tk-list">Tickets</h2><button type="button" className="button primary" onClick={()=>setCreating(true)}><Plus size={14}/>Nuevo ticket</button></header>
   <div className="panel-body">
    <div className="segmented" role="group" aria-label="Filtro de tickets">{(['abiertos','mios','vencidos','todos'] as const).map(f=><button key={f} type="button" aria-pressed={filter===f} onClick={()=>setFilter(f)}>{f==='mios'?'Asignados a mí':f[0].toUpperCase()+f.slice(1)}</button>)}</div>
    {msg&&<p className={`legend-note ${msg.ok?'':'om-ai-error'}`} role={msg.ok?'status':'alert'}>{msg.text}</p>}
    <div className="table-scroll"><table className="om-in-table"><thead><tr><th>#</th><th>Asunto</th><th>Cliente</th><th>Prioridad</th><th>Estado</th><th>Responsable</th><th>SLA</th></tr></thead>
     <tbody>{rows.length?rows.map(r=>{const s=slaLeft(r);return <tr key={r.id} className="om-tk-row" onClick={()=>setOpenId(r.id)}>
      <td>{r.id}</td><td><button type="button" className="link-button" onClick={e=>{e.stopPropagation();setOpenId(r.id);}}>{r.title}</button></td><td>{r.customer||'—'}</td>
      <td><span className={`tag ${r.priority==='alta'?'r':r.priority==='media'?'a':'g'}`}>{PRIO[r.priority]}</span></td><td>{STATUS[r.status]}</td><td>{r.assignee_name||'Sin asignar'}</td>
      <td><span className={`om-tk-sla ${s.tone}`}><Clock3 size={12}/>{s.label}</span></td></tr>;})
      :<tr><td colSpan={7}><span className="block-missing">{data.tickets.length?'No hay tickets con este filtro.':'Aún no hay tickets. Crea el primero con "Nuevo ticket".'}</span></td></tr>}</tbody></table></div>
    <p className="legend-note">SLA por prioridad: alta {data.sla_hours.alta} h, media {data.sla_hours.media} h, baja {data.sla_hours.baja} h. La primera respuesta es el primer comentario público de alguien distinto a quien abrió el ticket, o el primer cambio de estado.</p>
   </div>
  </section>

  {creating&&<><div className="drawer-scrim" onClick={()=>setCreating(false)}/>
   <aside className="om-tk-drawer" role="dialog" aria-modal="true" aria-labelledby="om-tk-new"><header><h2 id="om-tk-new">Nuevo ticket</h2><button type="button" className="link-button" aria-label="Cerrar" onClick={()=>setCreating(false)}><X size={16}/></button></header>
    <form className="om-cf-form om-tk-form" onSubmit={create}>
     <label htmlFor="tk-title"><span>Asunto</span><input id="tk-title" required minLength={3} maxLength={200} value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label>
     <label htmlFor="tk-customer"><span>Cliente</span><input id="tk-customer" maxLength={160} value={form.customer} onChange={e=>setForm({...form,customer:e.target.value})}/></label>
     <label htmlFor="tk-cat"><span>Categoría</span><select id="tk-cat" value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{['general','facturación','entrega','producto','garantía','sistema'].map(c=><option key={c} value={c}>{c}</option>)}</select></label>
     <label htmlFor="tk-prio"><span>Prioridad</span><select id="tk-prio" value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}>{Object.entries(PRIO).map(([v,l])=><option key={v} value={v}>{l} · SLA {data.sla_hours[v]} h</option>)}</select></label>
     <label htmlFor="tk-desc" className="om-tk-wide"><span>Detalle</span><textarea id="tk-desc" rows={5} maxLength={8000} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
     <div className="om-ai-actions om-tk-wide"><button type="submit" className="button primary" disabled={busy||form.title.trim().length<3}>{busy?<Loader2 size={14} className="om-spin"/>:<Plus size={14}/>}Crear ticket</button></div>
    </form></aside></>}

  {openId&&<><div className="drawer-scrim" onClick={()=>setOpenId(null)}/>
   <aside className="om-tk-drawer" role="dialog" aria-modal="true" aria-labelledby="om-tk-detail">
    <header><h2 id="om-tk-detail">#{openId} {t?.title||''}</h2><button type="button" className="link-button" aria-label="Cerrar" onClick={()=>setOpenId(null)}><X size={16}/></button></header>
    {!t?<p className="legend-note"><Loader2 size={14} className="om-spin"/> Cargando…</p>:<div className="om-tk-body">
     <p className="om-tk-meta">{t.customer?`${t.customer} · `:''}{t.category} · abierto por {t.created_by_name||'—'} el {when(t.created_at)}</p>
     {t.description&&<p className="om-tk-desc">{t.description}</p>}
     <p className={`om-tk-sla ${slaLeft(t).tone}`}>{slaLeft(t).tone==='r'?<AlertTriangle size={13}/>:<CheckCircle2 size={13}/>}{slaLeft(t).label} · límite {when(t.due_at)}{t.first_response_at?` · primera respuesta ${when(t.first_response_at)}`:''}</p>
     {data.can_manage&&<div className="om-cf-form">
      <label htmlFor="tk-st"><span>Estado</span><select id="tk-st" value={t.status} disabled={busy} onChange={e=>patch(t.id,{status:e.target.value})}>{Object.entries(STATUS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <label htmlFor="tk-pr"><span>Prioridad</span><select id="tk-pr" value={t.priority} disabled={busy} onChange={e=>patch(t.id,{priority:e.target.value})}>{Object.entries(PRIO).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <label htmlFor="tk-as"><span>Responsable</span><select id="tk-as" value={t.assignee_id||''} disabled={busy} onChange={e=>patch(t.id,{assignee_id:e.target.value||null})}><option value="">Sin asignar</option>{data.agents.map(a=><option key={a.id} value={a.id}>{a.name||a.id.slice(0,8)}</option>)}</select></label>
     </div>}
     <h3 className="om-tk-h"><MessageSquare size={14}/> Conversación</h3>
     <ul className="om-tk-thread">{detail!.comments.length?detail!.comments.map(c=><li key={c.id} className={c.internal?'is-internal':''}><b>{c.author||'—'}</b><small>{when(c.created_at)}{c.internal?' · nota interna':''}</small><p>{c.body}</p></li>):<li className="om-tk-empty">Sin comentarios todavía.</li>}</ul>
     <form className="om-tk-reply" onSubmit={send}>
      <label htmlFor="tk-c" className="sr-only">Comentario</label><textarea id="tk-c" rows={3} maxLength={4000} value={comment} placeholder="Escribe una respuesta…" onChange={e=>setComment(e.target.value)}/>
      <div className="om-ai-actions"><label className="om-cf-chip"><input type="checkbox" checked={internal} onChange={e=>setInternal(e.target.checked)}/>Nota interna</label>
       <button type="submit" className="button primary" disabled={busy||!comment.trim()}>{busy?<Loader2 size={14} className="om-spin"/>:<Send size={14}/>}Enviar</button></div>
     </form>
    </div>}
   </aside></>}
 </div>;
}
