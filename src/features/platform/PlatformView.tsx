import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {Building2,Coins,Loader2,Plus,Save,ShieldCheck,Sparkles,UserPlus,X} from 'lucide-react';
import {api} from '../../data/api';
import {useLive} from '../live/LiveData';

// Super admin de OMEGA (SaaS): todas las empresas, su plan (estado, módulos, skills, cuota de
// Truekens), su consumo real y la conversión tokens → Truekens. Solo usuarios platform_admin.
type Tenant={id:string;slug:string;name:string;created_at:string;plan_name:string|null;status:string;quota:number|null;modules:string[]|null;skills:string[];notes:string|null;
 users:number;last_close:string|null;sources:string|null;truekens:number;tokens:number;questions:number;open_tickets:number};
type Overview={month:string;settings:{multiplier:number;label:string;defaultQuota:number|null};tenants:Tenant[];modules:{id:string;label:string;kind:string}[];skills:{id:string;label:string}[]};
type Usage={entries:{at:string;tenant:string;user_name:string;email:string|null;page_id:string|null;question:string|null;provider:string|null;model:string|null;input_tokens:number|null;output_tokens:number|null;multiplier:number|null;truekens:number|null}[]};
const n=(v:number|null|undefined,d=0)=>v===null||v===undefined?'—':Number(v).toLocaleString('es-EC',{maximumFractionDigits:d});

export default function PlatformView(){
 const {live,user}=useLive();
 const [mes,setMes]=useState(new Date().toISOString().slice(0,7));
 const [data,setData]=useState<Overview|null>(null);
 const [usage,setUsage]=useState<Usage|null>(null);
 const [edit,setEdit]=useState<Tenant|null>(null);
 const [creating,setCreating]=useState(false);
 const [form,setForm]=useState({name:'',admin_email:'',admin_name:''});
 const [member,setMember]=useState({email:'',role:'admin'});
 const [members,setMembers]=useState<{name:string;email:string;role:string}[]>([]);
 const [mult,setMult]=useState('1');const [defQuota,setDefQuota]=useState('');
 const [busy,setBusy]=useState(false);const [msg,setMsg]=useState<{ok:boolean;text:string}|null>(null);
 const load=useCallback(async()=>{try{const r=await api<Overview>(`/api/platform/overview?mes=${mes}`);setData(r);setMult(String(r.settings.multiplier));setDefQuota(r.settings.defaultQuota===null?'':String(r.settings.defaultQuota));
  setUsage(await api<Usage>(`/api/platform/usage?mes=${mes}`));}catch(e){setMsg({ok:false,text:(e as Error).message});}},[mes]);
 useEffect(()=>{if(live&&user?.platform_admin)load();},[live,user,load]);
 useEffect(()=>{if(!edit){setMembers([]);return;}api<{members:typeof members}>(`/api/platform/tenants/${edit.id}/members`).then(r=>setMembers(r.members)).catch(()=>{});},[edit]);
 if(!live||!user?.platform_admin)return <section className="panel"><div className="panel-body"><p className="legend-note">Solo el super administrador de OMEGA ve esta consola.</p></div></section>;
 if(!data)return <section className="panel" aria-busy="true"><div className="panel-body"><p className="legend-note"><Loader2 size={14} className="om-spin"/> Cargando empresas…</p>{msg&&<p className="legend-note om-ai-error">{msg.text}</p>}</div></section>;
 const run=async(fn:()=>Promise<unknown>,ok:string)=>{setBusy(true);setMsg(null);try{const r=await fn();setMsg({ok:true,text:typeof r==='string'?r:ok});await load();}catch(e){setMsg({ok:false,text:(e as Error).message});}finally{setBusy(false);}};
 const L=data.settings.label;
 const totals=data.tenants.reduce((s,t)=>({t:s.t+t.truekens,k:s.k+Number(t.tokens),q:s.q+t.questions,u:s.u+t.users}),{t:0,k:0,q:0,u:0});
 const savePlan=(e:FormEvent)=>{e.preventDefault();if(!edit)return;run(()=>api(`/api/platform/tenants/${edit.id}/plan`,{method:'PUT',body:{plan_name:edit.plan_name||'Estándar',status:edit.status,trueken_quota:edit.quota,modules:edit.modules,skills:edit.skills,notes:edit.notes}}),`Plan de ${edit.name} guardado.`);};
 const toggle=(list:string[]|null,id:string,all:string[])=>{const cur=list??all;return cur.includes(id)?cur.filter(x=>x!==id):[...cur,id];};
 return <div className="om-plat">
  <div className="om-ai-actions om-tkn-bar">
   <label htmlFor="pl-mes" className="om-mkt-label"><span>Mes</span><input id="pl-mes" type="month" value={mes} onChange={e=>setMes(e.target.value)}/></label>
   <button type="button" className="button primary" onClick={()=>setCreating(true)}><Building2 size={14}/>Nueva empresa</button>
  </div>
  {msg&&<p className={`legend-note ${msg.ok?'':'om-ai-error'}`} role={msg.ok?'status':'alert'}>{msg.text}</p>}
  <div className="grid g-4">
   <article className="panel kpi tone-g"><div className="kpi-label"><span>Empresas</span><Building2 size={14} aria-hidden="true"/></div><div className="kpi-value">{data.tenants.length}</div><p className="block-note">{data.tenants.filter(t=>t.status==='suspendida').length} suspendidas · {totals.u} usuarios</p></article>
   <article className="panel kpi tone-a"><div className="kpi-label"><span>{L} del mes</span><Coins size={14} aria-hidden="true"/></div><div className="kpi-value">{n(totals.t)}</div><p className="block-note">{n(totals.q)} preguntas a Omega</p></article>
   <article className="panel kpi tone-a"><div className="kpi-label"><span>Tokens reales del mes</span><span className="status-dot a"/></div><div className="kpi-value">{n(totals.k)}</div><p className="block-note">Lo que cobra el proveedor de IA</p></article>
   <article className="panel kpi tone-g"><div className="kpi-label"><span>Conversión</span><span className="status-dot g"/></div><div className="kpi-value">× {n(data.settings.multiplier,4)}</div><p className="block-note">{L} por token real</p></article>
  </div>

  <section className="panel" aria-labelledby="pl-conv"><header className="panel-heading"><h2 id="pl-conv">Conversión y plan por defecto</h2><ShieldCheck size={15} aria-hidden="true"/></header>
   <div className="panel-body"><form className="om-cf-form" onSubmit={e=>{e.preventDefault();run(()=>api('/api/platform/settings',{method:'PUT',body:{multiplier:Number(mult),default_quota:defQuota===''?null:Number(defQuota)}}),'Conversión guardada. Se aplica a las próximas preguntas.');}}>
    <label htmlFor="pl-mult"><span>{L} por cada token real (factor)</span><div className="om-cf-num"><input id="pl-mult" type="number" step="0.0001" min="0.0001" value={mult} onChange={e=>setMult(e.target.value)}/><em>×</em></div></label>
    <label htmlFor="pl-dq"><span>Cuota mensual por defecto (empresas nuevas)</span><div className="om-cf-num"><input id="pl-dq" type="number" min={0} step={1000} value={defQuota} placeholder="Sin límite" onChange={e=>setDefQuota(e.target.value)}/><em>{L}</em></div></label>
    <div className="om-cf-add"><button type="submit" className="button primary" disabled={busy}><Save size={14}/>Guardar</button></div>
   </form><p className="legend-note">{L} = (tokens de entrada + salida que informa el proveedor) × factor. Cada registro guarda el factor vigente, así un cambio no altera el historial.</p></div></section>

  <section className="panel table-panel" aria-labelledby="pl-ten"><header className="panel-heading"><h2 id="pl-ten">Empresas · {data.month}</h2></header>
   <div className="panel-body"><div className="table-scroll"><table className="om-in-table"><thead><tr><th>Empresa</th><th>Estado</th><th>Plan</th><th className="num">Usuarios</th><th>Último cierre</th><th className="num">{L}</th><th className="num">Cuota</th><th className="num">Tokens</th><th className="num">Tickets</th><th>Módulos</th><th/></tr></thead>
    <tbody>{data.tenants.map(t=><tr key={t.id}><td><b>{t.name}</b><small className="om-budget-hint">{t.slug}</small></td>
     <td><span className={`tag ${t.status==='activa'?'g':'r'}`}>{t.status}</span></td><td>{t.plan_name||'Estándar'}</td><td className="num">{t.users}</td><td>{t.last_close||'Sin datos'}</td>
     <td className="num"><b>{n(t.truekens)}</b></td><td className="num">{t.quota===null?'Sin límite':n(t.quota)}</td><td className="num">{n(Number(t.tokens))}</td><td className="num">{t.open_tickets}</td>
     <td>{t.modules===null?'Todos':`${t.modules.length} de ${data.modules.length}`}{t.skills.length?` · ${t.skills.length} skills`:''}</td>
     <td><button type="button" className="row-link" onClick={()=>setEdit({...t})}>Gestionar</button></td></tr>)}</tbody></table></div></div></section>

  <section className="panel table-panel" aria-labelledby="pl-use"><header className="panel-heading"><h2 id="pl-use">Consumo de {L} · todas las empresas</h2></header>
   <div className="panel-body"><div className="table-scroll"><table className="om-in-table"><thead><tr><th>Fecha</th><th>Empresa</th><th>Usuario</th><th>Vista</th><th>Pregunta</th><th className="num">Tokens</th><th className="num">{L}</th></tr></thead>
    <tbody>{usage?.entries.length?usage.entries.slice(0,300).map((e,i)=><tr key={i}><td>{new Date(e.at).toLocaleString('es-EC',{dateStyle:'short',timeStyle:'short'})}</td><td>{e.tenant}</td><td>{e.user_name}</td><td>{e.page_id||'—'}</td>
     <td className="om-tkn-q">{e.question||'—'}</td><td className="num">{n((e.input_tokens||0)+(e.output_tokens||0))}</td><td className="num"><b>{n(e.truekens)}</b></td></tr>)
     :<tr><td colSpan={7}><span className="block-missing">Sin consumo en {data.month}.</span></td></tr>}</tbody></table></div></div></section>

  {edit&&<><div className="drawer-scrim" onClick={()=>setEdit(null)}/>
   <aside className="om-tk-drawer" role="dialog" aria-modal="true" aria-labelledby="pl-edit"><header><h2 id="pl-edit">{edit.name}</h2><button type="button" className="link-button" aria-label="Cerrar" onClick={()=>setEdit(null)}><X size={16}/></button></header>
    <form className="om-tk-body" onSubmit={savePlan}>
     <div className="om-cf-form">
      <label htmlFor="pe-name"><span>Plan</span><input id="pe-name" value={edit.plan_name||''} placeholder="Estándar" maxLength={60} onChange={e=>setEdit({...edit,plan_name:e.target.value})}/></label>
      <label htmlFor="pe-st"><span>Estado</span><select id="pe-st" value={edit.status} onChange={e=>setEdit({...edit,status:e.target.value})}><option value="activa">Activa</option><option value="suspendida">Suspendida</option></select></label>
      <label htmlFor="pe-q"><span>Cuota mensual de {L}</span><input id="pe-q" type="number" min={0} step={1000} value={edit.quota??''} placeholder="Sin límite" onChange={e=>setEdit({...edit,quota:e.target.value===''?null:Number(e.target.value)})}/></label>
     </div>
     <fieldset className="om-cf-promo"><legend>Módulos activos</legend>
      <div className="om-cf-months">{data.modules.map(m=>{const on=edit.modules===null||edit.modules.includes(m.id);return <label key={m.id} className={`om-cf-chip${on?' is-on':''}`}>
       <input type="checkbox" checked={on} onChange={()=>setEdit({...edit,modules:toggle(edit.modules,m.id,data.modules.map(x=>x.id))})}/>{m.label}</label>;})}</div>
      <button type="button" className="link-button" onClick={()=>setEdit({...edit,modules:null})}>Activar todos</button></fieldset>
     <fieldset className="om-cf-promo"><legend>Skills contratados</legend>
      <div className="om-cf-months">{data.skills.map(s=>{const on=edit.skills.includes(s.id);return <label key={s.id} className={`om-cf-chip${on?' is-on':''}`}>
       <input type="checkbox" checked={on} onChange={()=>setEdit({...edit,skills:on?edit.skills.filter(x=>x!==s.id):[...edit.skills,s.id]})}/>{s.label}</label>;})}</div></fieldset>
     <label htmlFor="pe-notes" className="om-mkt-label"><span>Notas internas</span><textarea id="pe-notes" rows={3} maxLength={1000} value={edit.notes||''} onChange={e=>setEdit({...edit,notes:e.target.value})}/></label>
     <div className="om-ai-actions"><button type="submit" className="button primary" disabled={busy}><Save size={14}/>Guardar plan</button>
      <button type="button" className="button secondary" disabled={busy||!edit.last_close} title={edit.last_close?'':'La empresa aún no tiene datos publicados'} onClick={()=>run(async()=>{const r=await api<{units:number;thresholds:number;budget:Record<string,number>}>(`/api/platform/tenants/${edit.id}/seed`,{method:'POST',body:{}});
       return `Valores sugeridos para ${edit.name}: ${r.units} unidades, ${r.thresholds} umbrales, presupuesto ${Object.entries(r.budget).map(([k,v])=>`${k} ${v} meses`).join(', ')}.`;},'')}><Sparkles size={14}/>Cargar valores sugeridos</button></div>
    </form>
    <h3 className="om-tk-h"><UserPlus size={14}/> Usuarios</h3>
    <ul className="om-tk-thread">{members.map(m=><li key={m.email}><b>{m.name}</b><small>{m.email} · {m.role}</small></li>)}</ul>
    <form className="om-cf-form" onSubmit={e=>{e.preventDefault();run(async()=>{const r=await api<{temporary_password:string|null}>(`/api/platform/tenants/${edit.id}/members`,{method:'POST',body:member});setMember({email:'',role:'admin'});
     const m=await api<{members:typeof members}>(`/api/platform/tenants/${edit.id}/members`);setMembers(m.members);return r.temporary_password?`Usuario creado. Contraseña temporal (se muestra una vez): ${r.temporary_password}`:'Usuario agregado a la empresa.';},'');}}>
     <label htmlFor="pm-email"><span>Correo</span><input id="pm-email" type="email" required value={member.email} onChange={e=>setMember({...member,email:e.target.value})}/></label>
     <label htmlFor="pm-role"><span>Rol</span><select id="pm-role" value={member.role} onChange={e=>setMember({...member,role:e.target.value})}>{['owner','admin','analyst','viewer'].map(r=><option key={r} value={r}>{r}</option>)}</select></label>
     <div className="om-cf-add"><button type="submit" className="button secondary" disabled={busy||!member.email}><Plus size={14}/>Agregar</button></div>
    </form>
   </aside></>}

  {creating&&<><div className="drawer-scrim" onClick={()=>setCreating(false)}/>
   <aside className="om-tk-drawer" role="dialog" aria-modal="true" aria-labelledby="pl-new"><header><h2 id="pl-new">Nueva empresa</h2><button type="button" className="link-button" aria-label="Cerrar" onClick={()=>setCreating(false)}><X size={16}/></button></header>
    <form className="om-cf-form om-tk-form" onSubmit={e=>{e.preventDefault();run(async()=>{const r=await api<{slug:string;admin_email:string;temporary_password:string|null}>('/api/platform/tenants',{method:'POST',body:form});setCreating(false);setForm({name:'',admin_email:'',admin_name:''});
     return `Empresa creada (${r.slug}). Administrador ${r.admin_email}${r.temporary_password?` · contraseña temporal (se muestra una vez): ${r.temporary_password}`:' (usuario existente)'}. Luego conecta su Odoo en Fuentes de datos.`;},'');}}>
     <label htmlFor="pn-name" className="om-tk-wide"><span>Nombre de la empresa</span><input id="pn-name" required maxLength={120} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
     <label htmlFor="pn-email"><span>Correo del administrador</span><input id="pn-email" type="email" required value={form.admin_email} onChange={e=>setForm({...form,admin_email:e.target.value})}/></label>
     <label htmlFor="pn-an"><span>Nombre del administrador</span><input id="pn-an" maxLength={120} value={form.admin_name} onChange={e=>setForm({...form,admin_name:e.target.value})}/></label>
     <div className="om-ai-actions om-tk-wide"><button type="submit" className="button primary" disabled={busy}><Building2 size={14}/>Crear empresa</button></div>
    </form></aside></>}
 </div>;
}
