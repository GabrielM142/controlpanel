// Boceto AI Copilot: canned interpretations & Q&A per page. No LLM required yet.
import {useEffect,useMemo,useRef,useState} from 'react';
import {Bot,CheckCircle2,CircleUser,ListTodo,Loader2,Send,Sparkles,StickyNote,Wand2,X,Zap} from 'lucide-react';
import {useTokens} from '../tokens/useTokens';
import {useTasks,type Task} from '../tasks/useTasks';
import {useNotes} from '../notes/useNotes';

type Msg={role:'bot'|'user';text:string;at:number};

const summaries:Record<string,string[]>={
 nivel1:[
  'La lectura general es positiva: el ISE está sobre 70 con mejora leve intermensual y las ventas sostienen la tendencia del trimestre.',
  'Puntos a mirar: cartera vencida sigue arriba del umbral gerencial y el mix de canales muestra rotación acelerada en Retail JUJ.',
  'Recomendación: pedir a Comercial la explicación del top 3 clientes con crecimiento negativo y priorizar la campaña de cobranza que ya está aprobada.',
 ],
 comercial:[
  'Comercial cierra la semana con avance sobre meta pero apoyado en pocos clientes; concentración de riesgo alta.',
  'La geografía muestra Azuay estable y Loja perdiendo participación por rotación de ejecutivos.',
  'Sugerido: reforzar cobertura Loja + revisar precios promocionales que están bajando margen.',
 ],
 financiero:[
  'La cartera vencida creció por dos casos puntuales; sin ellos el promedio quedaría por debajo del objetivo.',
  'La liquidez proyectada aguanta el trimestre incluso con esos dos casos si Comercial cumple la cobranza semanal.',
  'Riesgo: dependencia alta de un solo banco para líneas revolventes.',
 ],
 compras:[
  'Buen ritmo de compras con margen negociado por sobre 8 puntos y quiebres controlados.',
  'Alerta: dos proveedores concentran 62% del volumen del mes — plan B en marcha.',
 ],
 inventarios:[
  'Rotación al alza y stock crítico contenido; hay obsolescencia lenta acumulada que conviene liquidar antes del cierre.',
 ],
 clientes:[
  'Base de clientes activos creció 3.4% con retención saludable; se detectan 12 clientes clave sin visita en los últimos 30 días.',
 ],
 logistica:[
  'On-time delivery estable y costo por pedido en baja; hay una ruta con desvíos que golpea el resto del kpi.',
 ],
 marketing:[
  'Campañas rinden bajo el ROAS objetivo salvo la de UMCO — replantear mix de canales.',
 ],
 riesgos:['Módulo en pausa. Los indicadores de riesgo consolidado se activarán cuando estén cargadas las políticas del comité.'],
 mayoristahogar:[
  'Mayorista Hogar sostiene margen pero pierde volumen frente a Intorno; conviene revisar la política comercial.',
 ],
 mayoristaintorno:[
  'Intorno crece dos dígitos con margen estable — validar capacidad logística para el próximo mes.',
 ],
 retailjuj:[
  'Retail JUJ recupera ticket promedio; la sucursal Cuenca centro concentra el 41% del margen.',
 ],
 retailintorno:[
  'Retail Intorno estable, sin cambios materiales; la campaña de fidelización arranca la semana que viene.',
 ],
 tickets:[
  'Cola de soporte con 5 tickets activos, 2 en riesgo de SLA. Andrea M. está sobrecargada con 3 casos en paralelo.',
  'Recomendación: redistribuir un caso de Andrea a Bryan (menor carga) para asegurar el SLA de Distribuidora El Oro.',
 ],
 trueque:['Estás en Trueque Factory. Contame qué módulo necesitás y armo la solicitud paso a paso.'],
 'trueque-list':['Historial de solicitudes enviadas. Podés recargar para traer las que persistieron en la base analítica.'],
};

const followUps=[
 '¿Qué contribuye más a esa variación?',
 'Compará contra el trimestre anterior en pocas líneas.',
 '¿Qué acción concreta recomendás para la próxima reunión gerencial?',
 '¿Qué riesgo puntual debería vigilar esta semana?',
];

function cannedAnswer(question:string,pageId:string,pageLabel:string){
 const trimmed=question.trim().toLowerCase();
 if(!trimmed)return 'Contame qué te interesa profundizar de la vista actual.';
 if(trimmed.includes('riesgo')||trimmed.includes('alert'))return `En ${pageLabel} el foco de riesgo está en la concentración de resultados en pocos clientes/canales. Sugerido: pedir a Comercial detalle del top 3 en caída.`;
 if(trimmed.includes('recomend')||trimmed.includes('acción')||trimmed.includes('accion'))return `Tres pasos accionables: (1) revisar con el líder de área los 2 KPIs en ámbar; (2) redistribuir carga donde haya cuellos; (3) marcar seguimiento semanal en el tablero.`;
 if(trimmed.includes('compar')||trimmed.includes('mes')||trimmed.includes('trimestre'))return `El comparativo intertrimestral se activa cuando conectemos Odoo. Sobre los datos actuales de ${pageLabel}, se observa mejora leve pero apoyada en pocos actores.`;
 if(trimmed.includes('proyecc')||trimmed.includes('forecast'))return `La proyección requiere serie histórica cargada. Con los snapshots de ejemplo, la tendencia se sostiene si Comercial mantiene ritmo y Cartera no crece por encima del 5%.`;
 return `Buena pregunta. Sobre ${pageLabel}: la lectura combinada de KPIs y gráficos muestra un escenario mixto — puntos positivos en ventas y foco de atención en cartera y concentración por cliente. En la próxima etapa la IA responderá con datos vivos de Odoo y series históricas.`;
}

export function AIDrawer({open,onClose,pageId,pageLabel}:{open:boolean;onClose:()=>void;pageId:string;pageLabel:string}){
 const tokens=useTokens();
 const {tasks,setStatus,markAiReview,counts}=useTasks();
 const {forPage}=useNotes();
 const [msgs,setMsgs]=useState<Msg[]>([]);
 const [input,setInput]=useState('');
 const [busy,setBusy]=useState(false);
 const [tab,setTab]=useState<'chat'|'tareas'|'notas'>('chat');
 const scrollRef=useRef<HTMLDivElement>(null);

 useEffect(()=>{if(!open)return;setMsgs([]);setInput('');setTab('chat');},[open,pageId]);
 useEffect(()=>{scrollRef.current?.scrollTo({top:scrollRef.current.scrollHeight,behavior:'smooth'});},[msgs,busy]);

 const summary=useMemo(()=>summaries[pageId]||[`Interpretación IA para ${pageLabel} — se activará al conectar la base analítica.`],[pageId,pageLabel]);

 function interpret(){
  if(busy)return;
  const ok=tokens.spend(12,`IA · resumen ${pageLabel}`);
  if(!ok){setMsgs(m=>[...m,{role:'bot',at:Date.now(),text:'Se agotaron los tokens del período. Renuevan a inicio de mes o podés escalar el plan.'}]);return;}
  setBusy(true);
  setTimeout(()=>{setMsgs(m=>[...m,{role:'bot',at:Date.now(),text:summary.join(' ')}]);setBusy(false);},700);
 }

 function ask(qOverride?:string){
  const q=(qOverride??input).trim();if(!q||busy)return;
  const ok=tokens.spend(7,`IA · consulta ${pageLabel}`);
  if(!ok){setMsgs(m=>[...m,{role:'user',at:Date.now(),text:q},{role:'bot',at:Date.now(),text:'Se agotaron los tokens del período. Renuevan a inicio de mes o podés escalar el plan.'}]);setInput('');return;}
  setMsgs(m=>[...m,{role:'user',at:Date.now(),text:q}]);setInput('');setBusy(true);
  setTimeout(()=>{setMsgs(m=>[...m,{role:'bot',at:Date.now(),text:cannedAnswer(q,pageId,pageLabel)}]);setBusy(false);},650);
 }

 function reviewTask(t:Task){
  if(busy)return;
  const ok=tokens.spend(5,`IA · revisión tarea "${t.title.slice(0,40)}"`);
  if(!ok){setMsgs(m=>[...m,{role:'bot',at:Date.now(),text:'Se agotaron los tokens del período para revisar tareas.'}]);return;}
  const suggestion=t.priority==='alta'?'Sugerido: bloquear 30 min hoy para cerrarla, es la de mayor impacto.':t.dueDate?'Sugerido: agendarla en el bloque de la mañana, antes del vencimiento.':'Sugerido: convertirla en subtareas concretas para destrabarla.';
  markAiReview(t.id,suggestion);
  setMsgs(m=>[...m,{role:'bot',at:Date.now(),text:`Revisé "${t.title}": ${suggestion}`}]);
 }

 function completeTask(t:Task){
  setStatus(t.id,'done');
  setMsgs(m=>[...m,{role:'bot',at:Date.now(),text:`✅ Marcada como hecha: "${t.title}".`}]);
 }

 const pendingTasks=tasks.filter(t=>t.status==='pending'||t.status==='in_progress').slice(0,10);
 const pageNotes=forPage(pageId);

 return <aside className={`ai-drawer ${open?'open':''}`} role="dialog" aria-label="Copiloto de Análisis" aria-hidden={!open}>
  <header className="ai-head">
   <div><Sparkles size={16}/><strong>Copiloto de Análisis</strong><small>· {pageLabel}</small></div>
   <button type="button" aria-label="Cerrar copiloto" onClick={onClose}><X size={16}/></button>
  </header>
  <div className="ai-tabs" role="tablist">
   <button type="button" role="tab" aria-selected={tab==='chat'} className={tab==='chat'?'is-active':''} onClick={()=>setTab('chat')}><Wand2 size={12}/>Chat</button>
   <button type="button" role="tab" aria-selected={tab==='tareas'} className={tab==='tareas'?'is-active':''} onClick={()=>setTab('tareas')}><ListTodo size={12}/>Tareas <span className="ai-tab-badge">{counts.pending}</span></button>
   <button type="button" role="tab" aria-selected={tab==='notas'} className={tab==='notas'?'is-active':''} onClick={()=>setTab('notas')}><StickyNote size={12}/>Notas <span className="ai-tab-badge">{pageNotes.length}</span></button>
  </div>
  <div className="ai-body" ref={scrollRef}>
   {tab==='chat'&&<>
   <div className="ai-intro">
    <p>Puedo <b>interpretar</b> los datos que estás viendo y responder consultas puntuales sobre la vista <b>{pageLabel}</b>.</p>
    <button type="button" className="ai-action" onClick={interpret} disabled={busy}><Zap size={13}/> Generar interpretación de la pantalla ({busy?'…':'-12 tk'})</button>
    <div className="ai-suggest">
     <span>Sugerencias rápidas:</span>
     {followUps.map(q=><button key={q} type="button" onClick={()=>ask(q)}>{q}</button>)}
    </div>
   </div>
   {msgs.map((m,i)=><div key={i} className={`chat-msg ${m.role}`}>
    <span className="chat-avatar">{m.role==='bot'?<Bot size={14}/>:<CircleUser size={14}/>}</span>
    <div className="chat-bubble">{m.text}</div>
   </div>)}
   {busy&&<div className="chat-msg bot"><span className="chat-avatar"><Bot size={14}/></span><div className="chat-bubble ai-thinking"><Loader2 size={12} className="spin"/> Pensando…</div></div>}
   </>}

   {tab==='tareas'&&<div className="ai-tasks">
    <p className="ai-tasks-intro"><b>{counts.pending}</b> pendientes · <b>{counts.in_progress}</b> en curso · <b className="down">{counts.overdue}</b> vencidas. Marcá hechas rápido o pedí una sugerencia por tarea.</p>
    {pendingTasks.length===0
     ?<p className="ai-empty">Todo cerrado por ahora. Buen trabajo.</p>
     :<ul className="ai-task-list">{pendingTasks.map(t=><li key={t.id} className={`ai-task p-${t.priority}`}>
      <div className="ai-task-head"><strong>{t.title}</strong><span className={`tag ${t.priority==='alta'?'r':t.priority==='baja'?'g':'a'}`}>{t.priority}</span></div>
      {t.description&&<p>{t.description}</p>}
      {t.aiSuggestion&&<p className="ai-task-suggestion"><Sparkles size={11}/> {t.aiSuggestion}</p>}
      <div className="ai-task-actions">
       <button type="button" onClick={()=>reviewTask(t)} disabled={busy}><Sparkles size={12}/> Revisar (-5 tk)</button>
       <button type="button" className="primary" onClick={()=>completeTask(t)}><CheckCircle2 size={12}/> Marcar hecha</button>
      </div>
     </li>)}</ul>}
   </div>}

   {tab==='notas'&&<div className="ai-notes">
    <p className="ai-tasks-intro">Notas vinculadas a <b>{pageLabel}</b>: {pageNotes.length}.</p>
    {pageNotes.length===0
     ?<p className="ai-empty">No hay anotaciones para esta vista. Podés crearlas desde “Espacio Personal · Mis Notas”.</p>
     :<ul className="ai-note-list">{pageNotes.map(n=><li key={n.id} className={`ai-note note-color-${n.color}`}><p>{n.text}</p><em>{new Date(n.createdAt).toLocaleDateString('es-EC',{day:'2-digit',month:'short'})}</em></li>)}</ul>}
   </div>}
  </div>
  {tab==='chat'&&<footer className="ai-composer">
   <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();ask();}}} placeholder="Preguntá sobre esta pantalla…" aria-label="Consulta al copiloto"/>
   <button type="button" className="chat-send" aria-label="Enviar" onClick={()=>ask()} disabled={!input.trim()||busy}><Send size={14}/></button>
  </footer>}
  <div className="ai-foot">Los tokens y respuestas son parte del boceto. Al conectar la base analítica, el copiloto trabajará con datos vivos. Provisto por Trueque Labs.</div>
 </aside>;
}
