import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {BellRing,CheckCircle2,CircleSlash,Loader2,Send} from 'lucide-react';
import {api} from '../../data/api';
import {useLive} from '../live/LiveData';

// Telegram alerts per company: after each nightly close the server evaluates the thresholds and
// sends one summary to this chat when something is exceeded. The bot token is stored encrypted.
type Settings={chat_id:string|null;enabled:boolean;has_token:boolean;last_version:number|null;last_sent_at:string|null;last_error:string|null};

export default function TelegramCard(){
 const {live,tenantId,membership}=useLive();
 const admin=membership?.role==='owner'||membership?.role==='admin';
 const [s,setS]=useState<Settings|null>(null);
 const [token,setToken]=useState('');const [chat,setChat]=useState('');const [enabled,setEnabled]=useState(true);
 const [busy,setBusy]=useState<'save'|'test'|null>(null);const [msg,setMsg]=useState<{ok:boolean;text:string}|null>(null);
 const load=useCallback(async()=>{
  if(!live||!tenantId||!admin)return;
  try{const r=await api<Settings>('/api/notify/settings',{tenant:tenantId});setS(r);setChat(r.chat_id||'');setEnabled(r.has_token?r.enabled:true);}catch{}
 },[live,tenantId,admin]);
 useEffect(()=>{load();},[load]);
 if(!live||!admin)return null;

 const save=async(e:FormEvent)=>{
  e.preventDefault();if(!tenantId)return;setBusy('save');setMsg(null);
  try{await api('/api/notify/settings',{tenant:tenantId,method:'PUT',body:{telegram_token:token.trim()||undefined,chat_id:chat.trim()||undefined,enabled}});
   setToken('');setMsg({ok:true,text:enabled?'Guardado: recibirás las alertas después de cada cierre.':'Guardado con las alertas desactivadas.'});await load();}
  catch(err){setMsg({ok:false,text:(err as Error).message});}finally{setBusy(null);}
 };
 const test=async()=>{
  if(!tenantId)return;setBusy('test');setMsg(null);
  try{const r=await api<{alerts:number}>('/api/notify/test',{tenant:tenantId,method:'POST',body:{}});
   setMsg({ok:true,text:r.alerts?`Enviado a Telegram con ${r.alerts} alerta${r.alerts>1?'s':''} del último cierre.`:'Mensaje de prueba enviado a Telegram.'});}
  catch(err){setMsg({ok:false,text:(err as Error).message});}finally{setBusy(null);}
 };

 return <section className="panel om-tg" aria-labelledby="om-tg-title">
  <header className="panel-heading"><h2 id="om-tg-title">Alertas por Telegram</h2><BellRing size={15} aria-hidden="true"/></header>
  <div className="panel-body">
   <p className="om-ai-status">{s?.has_token&&s.enabled?<><CheckCircle2 size={14}/> Activas · chat {s.chat_id}{s.last_sent_at?` · último envío ${new Date(s.last_sent_at).toLocaleString('es-EC',{dateStyle:'short',timeStyle:'short'})}`:''}</>
    :<><CircleSlash size={14}/> Sin configurar: las alertas solo se ven en la campana del panel.</>}</p>
   {s?.last_error&&<p className="legend-note om-ai-error" role="alert">Último intento falló: {s.last_error}</p>}
   <ol className="om-tg-steps">
    <li>En Telegram abre <b>@BotFather</b>, envía <code>/newbot</code> y copia el token que te entrega.</li>
    <li>Agrega el bot a tu grupo (o escríbele) y obtén el número del chat, por ejemplo con <b>@userinfobot</b>.</li>
    <li>Pégalos aquí, guarda y pulsa <b>Enviar prueba</b>.</li>
   </ol>
   <form className="om-ai-form" onSubmit={save}>
    <label htmlFor="om-tg-token"><span>Token del bot</span>
     <input id="om-tg-token" type="password" autoComplete="off" value={token} maxLength={120} placeholder={s?.has_token?'Guardado · escribe uno nuevo solo para cambiarlo':'123456789:ABC…'} onChange={e=>setToken(e.target.value)}/></label>
    <label htmlFor="om-tg-chat"><span>Chat</span>
     <input id="om-tg-chat" value={chat} maxLength={64} placeholder="-1001234567890 o @canal" onChange={e=>setChat(e.target.value)}/></label>
    <label htmlFor="om-tg-on" className="om-tg-toggle"><input id="om-tg-on" type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/><span>Enviar alertas después de cada cierre</span></label>
    <div className="om-ai-actions">
     <button type="submit" className="button primary" disabled={!!busy||(!token.trim()&&!s?.has_token)}>{busy==='save'?<Loader2 size={14} className="om-spin"/>:null}Guardar</button>
     <button type="button" className="button secondary" onClick={test} disabled={!!busy||!s?.has_token}>{busy==='test'?<Loader2 size={14} className="om-spin"/>:<Send size={14}/>}Enviar prueba</button>
    </div>
   </form>
   {msg&&<p className={`legend-note ${msg.ok?'':'om-ai-error'}`} role={msg.ok?'status':'alert'}>{msg.text}</p>}
  </div>
 </section>;
}
