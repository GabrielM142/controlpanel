import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {CheckCircle2,CircleSlash,KeyRound,Loader2,Sparkles,Trash2} from 'lucide-react';
import {api} from '../../data/api';
import {useLive} from '../live/LiveData';

// Omega IA per company: provider (Anthropic or OpenAI), model and the company's own API key.
// The key is sent once, stored encrypted on the server and never shown again.
type Settings={providers:{id:string;label:string;default_model:string}[];provider:string|null;model:string|null;configured:boolean;updated_at:string|null;server_fallback:boolean};
type TestAnswer={headline:string;sources:string[]};

export default function AISettingsView(){
 const {live,tenantId,membership}=useLive();
 const admin=membership?.role==='owner'||membership?.role==='admin';
 const [s,setS]=useState<Settings|null>(null);
 const [provider,setProvider]=useState('openai');const [model,setModel]=useState('');const [key,setKey]=useState('');
 const [busy,setBusy]=useState<'save'|'test'|'delete'|null>(null);const [msg,setMsg]=useState<{ok:boolean;text:string}|null>(null);
 const [test,setTest]=useState<TestAnswer|null>(null);

 const load=useCallback(async()=>{
  if(!live||!tenantId||!admin)return;
  try{const r=await api<Settings>('/api/ai/settings',{tenant:tenantId});setS(r);if(r.provider)setProvider(r.provider);setModel(r.model||'');}
  catch(e){setMsg({ok:false,text:(e as Error).message});}
 },[live,tenantId,admin]);
 useEffect(()=>{load();},[load]);

 const current=s?.providers.find(p=>p.id===provider);
 const save=async(e:FormEvent)=>{
  e.preventDefault();if(!tenantId)return;setBusy('save');setMsg(null);setTest(null);
  try{await api('/api/ai/settings',{tenant:tenantId,method:'PUT',body:{provider,model:model.trim()||undefined,api_key:key.trim()||undefined}});
   setKey('');setMsg({ok:true,text:'Configuración guardada. La clave queda cifrada en el servidor.'});await load();}
  catch(err){setMsg({ok:false,text:(err as Error).message});}finally{setBusy(null);}
 };
 const runTest=async()=>{
  if(!tenantId)return;setBusy('test');setMsg(null);setTest(null);
  try{const r=await api<TestAnswer>('/api/ai/report',{tenant:tenantId,method:'POST',body:{page_id:'comercial',question:'En una frase: ¿cómo van las ventas del último cierre?'}});
   setTest(r);setMsg({ok:true,text:'Omega IA respondió con los datos publicados.'});}
  catch(err){setMsg({ok:false,text:(err as Error).message});}finally{setBusy(null);}
 };
 const remove=async()=>{
  if(!tenantId)return;setBusy('delete');setMsg(null);setTest(null);
  try{await api('/api/ai/settings',{tenant:tenantId,method:'DELETE'});setMsg({ok:true,text:'Configuración eliminada.'});setKey('');setModel('');await load();}
  catch(err){setMsg({ok:false,text:(err as Error).message});}finally{setBusy(null);}
 };

 if(!live)return <section className="panel"><div className="panel-body"><p className="legend-note">Vista de demostración: Omega responde con la lectura calculada de cada pantalla. Con el panel conectado, aquí eliges el proveedor de inteligencia artificial de tu empresa y cargas su clave.</p></div></section>;
 if(!admin)return <section className="panel"><div className="panel-body"><p className="legend-note">Solo los administradores de la empresa configuran Omega IA.</p></div></section>;

 return <div className="om-ai-settings">
  <section className="panel"><header className="panel-heading"><h2>Proveedor de inteligencia artificial</h2><Sparkles size={15} aria-hidden="true"/></header>
   <div className="panel-body">
    <p className="om-ai-status">{s?.configured?<><CheckCircle2 size={14}/> Configurado con {s.providers.find(p=>p.id===s.provider)?.label} · modelo <b>{s.model}</b>{s.updated_at?` · actualizado ${new Date(s.updated_at).toLocaleString('es-EC',{dateStyle:'short',timeStyle:'short'})}`:''}</>
     :s?.server_fallback?<><CheckCircle2 size={14}/> Sin clave propia: Omega usa la clave general del servidor (Anthropic).</>
     :<><CircleSlash size={14}/> Sin configurar: Omega responde con la lectura calculada de cada pantalla.</>}</p>
    <form className="om-ai-form" onSubmit={save}>
     <label htmlFor="om-ai-provider"><span>Proveedor</span>
      <select id="om-ai-provider" value={provider} onChange={e=>{setProvider(e.target.value);setModel('');}}>{(s?.providers||[{id:'openai',label:'OpenAI',default_model:'gpt-5.5'},{id:'anthropic',label:'Anthropic (Claude)',default_model:'claude-opus-5-5'}]).map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
     <label htmlFor="om-ai-model"><span>Modelo</span>
      <input id="om-ai-model" value={model} maxLength={80} placeholder={current?.default_model||''} onChange={e=>setModel(e.target.value)}/>
      <small>Vacío usa {current?.default_model}.</small></label>
     <label htmlFor="om-ai-key" className="om-ai-key"><span>Clave de API</span>
      <input id="om-ai-key" type="password" autoComplete="off" value={key} maxLength={300}
       placeholder={s?.configured&&s.provider===provider?'Guardada · escribe una nueva solo para cambiarla':provider==='openai'?'sk-…':'sk-ant-…'} onChange={e=>setKey(e.target.value)}/>
      <small><KeyRound size={12}/> Se guarda cifrada y nunca se vuelve a mostrar.</small></label>
     <div className="om-ai-actions">
      <button type="submit" className="button primary" disabled={!!busy||(!key.trim()&&!(s?.configured&&s.provider===provider))}>{busy==='save'?<Loader2 size={14} className="om-spin"/>:null}Guardar</button>
      <button type="button" className="button secondary" onClick={runTest} disabled={!!busy||!(s?.configured||s?.server_fallback)}>{busy==='test'?<Loader2 size={14} className="om-spin"/>:null}Probar con el último cierre</button>
      {s?.configured&&<button type="button" className="button secondary" onClick={remove} disabled={!!busy}><Trash2 size={14}/>Quitar</button>}
     </div>
    </form>
    {msg&&<p className={`legend-note ${msg.ok?'':'om-ai-error'}`} role={msg.ok?'status':'alert'}>{msg.text}</p>}
    {test&&<div className="om-ai-test"><span className="om-eyebrow">Respuesta de prueba</span><p>{test.headline}</p><small>{test.sources[0]}</small></div>}
   </div></section>
  <p className="legend-note">Omega IA solo lee las cifras publicadas del último cierre de tu empresa: el servidor arma el contexto, nunca consulta Odoo en vivo ni envía credenciales del ERP. Cada pregunta la cobra tu proveedor según su tarifa; hay un límite de 60 preguntas por hora por usuario.</p>
 </div>;
}
