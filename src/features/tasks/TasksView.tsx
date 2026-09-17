import {useMemo,useState} from 'react';
import {AlertOctagon,Calendar,Check,CircleDot,Clock,Filter,ListTodo,Pencil,Play,Plus,Sparkles,Trash2,X} from 'lucide-react';
import {useTasks,type Task,type TaskPriority,type TaskStatus} from './useTasks';

const priorityTone:Record<TaskPriority,'g'|'a'|'r'>={baja:'g',media:'a',alta:'r'};
const priorityLabel:Record<TaskPriority,string>={baja:'Baja',media:'Media',alta:'Alta'};
const statusLabel:Record<TaskStatus,string>={pending:'Pendiente',in_progress:'En curso',done:'Hecha',cancelled:'Cancelada'};

const pageOptions=[
 {id:'',label:'Sin vincular'},
 {id:'nivel1',label:'Dirección Empresarial'},
 {id:'comercial',label:'Comercial'},
 {id:'financiero',label:'Financiero'},
 {id:'inventarios',label:'Inventarios'},
 {id:'clientes',label:'Clientes'},
 {id:'tickets',label:'Tickets Vigentes'},
 {id:'trueque-list',label:'Trueque Labs · Solicitudes'},
];

function fmtDate(d?:string){if(!d)return '—';try{return new Date(d).toLocaleDateString('es-EC',{day:'2-digit',month:'short'});}catch{return d;}}

export default function TasksView(){
 const {tasks,add,update,remove,setStatus,counts}=useTasks();
 const [filter,setFilter]=useState<'all'|'pending'|'in_progress'|'done'>('pending');
 const [editing,setEditing]=useState<Task|null>(null);
 const [showForm,setShowForm]=useState(false);
 const [draft,setDraft]=useState<{title:string;description:string;priority:TaskPriority;dueDate:string;linkedPageId:string}>({title:'',description:'',priority:'media',dueDate:'',linkedPageId:''});

 const filtered=useMemo(()=>tasks.filter(t=>filter==='all'||t.status===filter),[tasks,filter]);

 function reset(){setDraft({title:'',description:'',priority:'media',dueDate:'',linkedPageId:''});setEditing(null);setShowForm(false);}
 function openEdit(t:Task){setEditing(t);setDraft({title:t.title,description:t.description||'',priority:t.priority,dueDate:t.dueDate||'',linkedPageId:t.linkedPageId||''});setShowForm(true);}
 function save(){
  if(!draft.title.trim())return;
  const payload={title:draft.title,description:draft.description||undefined,priority:draft.priority,dueDate:draft.dueDate||undefined,linkedPageId:draft.linkedPageId||undefined};
  if(editing)update(editing.id,payload);else add(payload);
  reset();
 }

 return <>
  <h2 className="section-label"><span>Mi tablero de tareas</span><i/></h2>
  <div className="grid g-4">
   <article className="panel kpi tone-a"><div className="kpi-label"><span>Pendientes</span><span className="status-dot a"/></div><div className="kpi-value">{counts.pending}</div><div className="kpi-deltas"><div><span>En curso</span><strong>{counts.in_progress}</strong></div><div><span>Vencidas</span><strong className={counts.overdue>0?'down':''}>{counts.overdue}</strong></div></div></article>
   <article className="panel kpi tone-g"><div className="kpi-label"><span>Cerradas</span><span className="status-dot g"/></div><div className="kpi-value">{counts.done}</div><div className="kpi-deltas"><div><span>Total registradas</span><strong>{tasks.length}</strong></div><div><span>Cumplimiento</span><strong>{tasks.length?Math.round(counts.done/tasks.length*100):0}%</strong></div></div></article>
   <article className="panel kpi tone-r"><div className="kpi-label"><span>Alta prioridad</span><span className="status-dot r"/></div><div className="kpi-value">{tasks.filter(t=>t.priority==='alta'&&t.status!=='done'&&t.status!=='cancelled').length}</div><div className="kpi-deltas"><div><span>Sin vencimiento</span><strong>{tasks.filter(t=>!t.dueDate&&t.status!=='done').length}</strong></div><div><span>Con IA revisada</span><strong>{tasks.filter(t=>t.aiReviewedAt).length}</strong></div></div></article>
   <article className="panel metric"><div className="kpi-label">Consejo del copiloto</div><div className="metric-value" style={{fontSize:'14px',lineHeight:1.55}}>{counts.overdue>0?`Tenés ${counts.overdue} tarea(s) vencida(s). Priorizá cerrarlas antes de crear nuevas.`:counts.pending>5?'Muchas pendientes: usá la IA para clasificar por urgencia.':'Todo bajo control. Podés pedir a la IA que sugiera próximos pasos.'}</div><p>La IA lee esta lista y te ayuda a bajarlas de estado desde el copiloto.</p></article>
  </div>

  <section className="panel" style={{marginTop:14}}>
   <header className="panel-heading" style={{gap:12,flexWrap:'wrap'}}>
    <h2><ListTodo size={13} style={{verticalAlign:'-2px',marginRight:6}}/>Tareas ({filtered.length})</h2>
    <div style={{display:'flex',gap:8,alignItems:'center',marginLeft:'auto'}}>
     <label className="tickets-filters" style={{display:'inline-flex'}}><span style={{display:'inline-flex',alignItems:'center',gap:5,background:'#f7f9fc',border:'1px solid #e1e7ef',borderRadius:6,padding:'5px 8px',fontSize:10,color:'#7d8ba1'}}><Filter size={12}/><span>Estado</span>
      <select value={filter} onChange={e=>setFilter(e.target.value as typeof filter)} style={{background:'transparent',border:0,fontSize:10,color:'#25334a',fontWeight:550,padding:'0 2px'}}>
       <option value="all">Todas</option>
       <option value="pending">Pendiente</option>
       <option value="in_progress">En curso</option>
       <option value="done">Hecha</option>
      </select>
     </span></label>
     <button type="button" className="button primary" onClick={()=>{if(showForm){reset();}else{setEditing(null);setShowForm(true);}}}><Plus size={14}/>{showForm?'Cancelar':'Nueva tarea'}</button>
    </div>
   </header>
   {showForm&&<div className="panel-body" style={{borderBottom:'1px solid var(--line)'}}>
    <div className="task-form">
     <label><span>Título</span><input value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})} placeholder="Ej: Revisar cierre semanal Comercial" autoFocus/></label>
     <label><span>Descripción</span><textarea value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})} placeholder="Contexto o pasos"/></label>
     <div className="task-form-row">
      <label><span>Prioridad</span><select value={draft.priority} onChange={e=>setDraft({...draft,priority:e.target.value as TaskPriority})}><option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option></select></label>
      <label><span>Vence</span><input type="date" value={draft.dueDate} onChange={e=>setDraft({...draft,dueDate:e.target.value})}/></label>
      <label><span>Vincular a vista</span><select value={draft.linkedPageId} onChange={e=>setDraft({...draft,linkedPageId:e.target.value})}>{pageOptions.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
     </div>
     <div className="task-form-actions">
      <button type="button" className="button secondary" onClick={reset}>Cancelar</button>
      <button type="button" className="button primary" onClick={save} disabled={!draft.title.trim()}><Check size={14}/>{editing?'Guardar cambios':'Crear tarea'}</button>
     </div>
    </div>
   </div>}
   <div className="panel-body" style={{padding:0}}>
    {filtered.length===0
     ?<div style={{padding:'34px 20px',textAlign:'center',color:'var(--muted)',fontSize:12}}>Sin tareas en este filtro. Sumá una nueva desde el botón de arriba.</div>
     :<ul className="task-list">{filtered.map(t=><li key={t.id} className={`task-item p-${priorityTone[t.priority]} s-${t.status}`}>
      <button type="button" className="task-check" aria-label={t.status==='done'?'Reabrir':'Marcar como hecha'} onClick={()=>setStatus(t.id,t.status==='done'?'pending':'done')}>
       {t.status==='done'?<Check size={14}/>:t.status==='in_progress'?<CircleDot size={14}/>:<span className="task-empty"/>}
      </button>
      <div className="task-body">
       <div className="task-title"><strong>{t.title}</strong><span className={`tag ${priorityTone[t.priority]}`}>{priorityLabel[t.priority]}</span></div>
       {t.description&&<p>{t.description}</p>}
       <div className="task-meta">
        <span><Clock size={11}/> {statusLabel[t.status]}</span>
        {t.dueDate&&<span className={t.dueDate<new Date().toISOString().slice(0,10)&&t.status!=='done'?'is-overdue':''}><Calendar size={11}/> Vence {fmtDate(t.dueDate)}</span>}
        {t.linkedPageId&&<a className="row-link" href={'#'+t.linkedPageId}>Ir a {pageOptions.find(p=>p.id===t.linkedPageId)?.label||t.linkedPageId}</a>}
        {t.aiSuggestion&&<span className="task-ai"><Sparkles size={11}/> IA: {t.aiSuggestion}</span>}
       </div>
      </div>
      <div className="task-actions">
       {t.status!=='in_progress'&&t.status!=='done'&&<button type="button" title="Poner en curso" aria-label="Poner en curso" onClick={()=>setStatus(t.id,'in_progress')}><Play size={13}/></button>}
       <button type="button" title="Editar" aria-label="Editar" onClick={()=>openEdit(t)}><Pencil size={13}/></button>
       <button type="button" title="Eliminar" aria-label="Eliminar" onClick={()=>{if(confirm('¿Eliminar esta tarea?'))remove(t.id);}}><Trash2 size={13}/></button>
      </div>
     </li>)}</ul>}
   </div>
  </section>

  <p className="legend-note" style={{marginTop:14}}><AlertOctagon size={12} style={{verticalAlign:'-2px',marginRight:6}}/>El copiloto lee tus tareas pendientes: podés pedirle que sugiera cuál priorizar o marcar como hecha desde el drawer de IA (pestaña <b>Tareas</b>).</p>
 </>;
}
