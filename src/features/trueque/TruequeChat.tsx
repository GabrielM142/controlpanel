// Boceto Trueque Factory: guided intake with 7 questions. AI responses are canned
// so the demo shows the flow without depending on an external LLM.
import {useEffect,useMemo,useRef,useState} from 'react';
import {Bot,Check,CircleUser,Cpu,Loader2,Send,Sparkles,X} from 'lucide-react';
import {useTokens} from '../tokens/useTokens';

type Msg={role:'bot'|'user';text:string;at:number};

type Step={key:'title'|'process'|'actors'|'data_sources'|'integrations'|'outputs'|'priority'|'timeline'|'budget'|'client_name'|'email'|'plan';q:string;placeholder:string;options?:string[];optional?:boolean};

const steps:Step[]=[
 {key:'title',q:'Perfecto. En una frase, ¿qué módulo o proceso te gustaría automatizar con SIDE?',placeholder:'Ej: Alertas de cartera vencida por WhatsApp'},
 {key:'process',q:'Contame el proceso actual: ¿cómo lo hacen hoy y dónde se traba?',placeholder:'Ej: revisamos Excel a mano cada lunes y perdemos tiempo…'},
 {key:'actors',q:'¿Quiénes participan? (roles, equipos)',placeholder:'Ej: cartera, comercial, gerencia'},
 {key:'data_sources',q:'¿De dónde salen los datos? (Odoo, Excel, otro sistema)',placeholder:'Ej: Odoo módulo Contabilidad + Excel de comerciales'},
 {key:'integrations',q:'¿Con qué necesita integrarse? (WhatsApp, email, ERP, etc.)',placeholder:'Ej: WhatsApp Business + Odoo'},
 {key:'outputs',q:'¿Qué salida esperás? ¿reporte, alerta, acción automática?',placeholder:'Ej: mensaje diario al gerente + alerta cuando vence'},
 {key:'priority',q:'¿Qué prioridad tiene?',placeholder:'Elegí una',options:['baja','media','alta','urgente']},
 {key:'timeline',q:'¿Cuándo lo necesitarías listo?',placeholder:'Ej: fin de mes / próximo trimestre',optional:true},
 {key:'budget',q:'¿Tenés un presupuesto tentativo? (opcional)',placeholder:'Ej: rango USD 800 a 1500',optional:true},
 {key:'client_name',q:'Antes de enviar: ¿a nombre de qué empresa registro la solicitud?',placeholder:'Ej: Comercial Andes SA'},
 {key:'email',q:'¿A qué correo te respondemos? (opcional, sino te contactamos por el canal habitual)',placeholder:'gerencia@empresa.com',optional:true},
 {key:'plan',q:'¿Bajo qué plan queda registrada esta solicitud?',placeholder:'Elegí un plan',options:['free','pro','enterprise']},
];

const openingBot:Msg={role:'bot',at:Date.now(),text:'Hola, soy Trueque IA. Voy a hacerte 12 preguntas cortas para armar tu solicitud de módulo. Al final el equipo SIDE la recibe y te envía una cotización. Empecemos…'};

function planLabel(p:string){return p==='free'?'Free · 100 tk':p==='pro'?'Pro · 500 tk/mes':'Enterprise · 2000 tk/mes';}

export default function TruequeChat({onSubmitted}:{onSubmitted?:()=>void}){
 const tokens=useTokens();
 const [msgs,setMsgs]=useState<Msg[]>([openingBot,{role:'bot',at:Date.now(),text:steps[0].q}]);
 const [values,setValues]=useState<Record<string,string>>({});
 const [input,setInput]=useState('');
 const [stepIdx,setStepIdx]=useState(0);
 const [sending,setSending]=useState(false);
 const [submitted,setSubmitted]=useState<null|{id:string;fallback?:boolean}>(null);
 const scrollRef=useRef<HTMLDivElement>(null);

 useEffect(()=>{scrollRef.current?.scrollTo({top:scrollRef.current.scrollHeight,behavior:'smooth'});},[msgs,stepIdx]);

 const step=steps[stepIdx];
 const done=stepIdx>=steps.length;

 function nextBotLine(nextValues:Record<string,string>,nextIdx:number){
  const remaining=steps.length-nextIdx;
  if(nextIdx>=steps.length){setMsgs(m=>[...m,{role:'bot',at:Date.now(),text:`Genial. Ya tengo todo (${Object.keys(nextValues).length} respuestas). Revisá el resumen y enviámelo cuando quieras.`}]);return;}
  const previewKey=steps[nextIdx-1]?.key;const prevAck=previewKey==='priority'?`Anotado — prioridad ${nextValues[previewKey]}.`:previewKey==='plan'?`Perfecto — plan ${planLabel(nextValues[previewKey])}.`:remaining>3?'Anotado.':'Casi listos.';
  setMsgs(m=>[...m,{role:'bot',at:Date.now(),text:`${prevAck} ${steps[nextIdx].q}`}]);
 }

 function submit(rawValue?:string){
  if(done||sending)return;
  const value=(rawValue??input).trim();
  if(!value&&!step.optional)return;
  const nextValues={...values,[step.key]:value};
  const nextIdx=stepIdx+1;
  setMsgs(m=>[...m,{role:'user',at:Date.now(),text:value||'(saltado)'}]);
  setValues(nextValues);setStepIdx(nextIdx);setInput('');
  // Small delay to simulate thinking and consume 1 token per turn (mock).
  setTimeout(()=>{tokens.spend(1,'Trueque Factory · turno de captación');nextBotLine(nextValues,nextIdx);},420);
 }

 async function send(){
  if(!done||sending||submitted)return;
  setSending(true);
  const payload={
   client_name:values.client_name||'Sin nombre',
   client_email:values.email||null,
   plan:values.plan||'free',
   title:values.title||'Solicitud sin título',
   process:values.process||'',
   actors:values.actors||'',
   data_sources:values.data_sources||'',
   integrations:values.integrations||'',
   outputs:values.outputs||'',
   priority:values.priority||'media',
   budget:values.budget||null,
   timeline:values.timeline||null,
   conversation:msgs,
   tokens_used:steps.length,
  };
  try{
   const r=await fetch('/api/trueque',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   if(r.ok){const j=await r.json();setSubmitted({id:j.id});}
   else{throw new Error(String(r.status));}
  }catch{
   // Fallback: persist locally so the boceto works even without DATABASE_URL configured.
   try{
    const raw=localStorage.getItem('side.trueque.local');
    const list=raw?JSON.parse(raw):[];
    const local={...payload,id:'local-'+Date.now(),created_at:new Date().toISOString(),status:'received',tokens_used:steps.length};
    localStorage.setItem('side.trueque.local',JSON.stringify([local,...list].slice(0,30)));
    setSubmitted({id:local.id,fallback:true});
   }catch{}
  }finally{setSending(false);onSubmitted?.();}
 }

 return <div className="trueque-shell">
  <aside className="trueque-summary">
   <div className="trueque-summary-head">
    <div className="trueque-brand"><Sparkles size={16}/><strong>Trueque Factory</strong></div>
    <p>Contanos qué módulo necesitás. Nuestro equipo lo diseña, cotiza y construye.</p>
   </div>
   <div className="trueque-plans">
    <div className="plan"><strong>Free</strong><em>100 tk/mes</em><span>Un módulo por trimestre · soporte comunidad</span></div>
    <div className="plan is-highlight"><strong>Pro</strong><em>500 tk/mes</em><span>Hasta 3 módulos · soporte prioritario</span></div>
    <div className="plan"><strong>Enterprise</strong><em>2000 tk/mes</em><span>Módulos ilimitados · SLA dedicado</span></div>
    <p className="plan-note">Tokens no acumulables. Renuevan cada mes según tu plan.</p>
   </div>
   <div className="trueque-progress">
    <span>Avance de captación</span>
    <div><span style={{width:`${Math.min(100,(stepIdx/steps.length)*100)}%`}}/></div>
    <em>{Math.min(stepIdx,steps.length)} / {steps.length}</em>
   </div>
   {Object.keys(values).length>0&&<div className="trueque-recap">
    <h3>Resumen</h3>
    <dl>
     {values.title&&<><dt>Módulo</dt><dd>{values.title}</dd></>}
     {values.process&&<><dt>Proceso</dt><dd>{values.process}</dd></>}
     {values.actors&&<><dt>Actores</dt><dd>{values.actors}</dd></>}
     {values.data_sources&&<><dt>Datos</dt><dd>{values.data_sources}</dd></>}
     {values.integrations&&<><dt>Integra con</dt><dd>{values.integrations}</dd></>}
     {values.outputs&&<><dt>Salida</dt><dd>{values.outputs}</dd></>}
     {values.priority&&<><dt>Prioridad</dt><dd>{values.priority}</dd></>}
     {values.timeline&&<><dt>Plazo</dt><dd>{values.timeline}</dd></>}
     {values.budget&&<><dt>Presupuesto</dt><dd>{values.budget}</dd></>}
     {values.client_name&&<><dt>Empresa</dt><dd>{values.client_name}</dd></>}
     {values.email&&<><dt>Contacto</dt><dd>{values.email}</dd></>}
     {values.plan&&<><dt>Plan</dt><dd>{planLabel(values.plan)}</dd></>}
    </dl>
   </div>}
  </aside>

  <section className="trueque-chat">
   <div className="chat-scroll" ref={scrollRef}>
    {msgs.map((m,i)=><div key={i} className={`chat-msg ${m.role}`}>
     <span className="chat-avatar">{m.role==='bot'?<Bot size={14}/>:<CircleUser size={14}/>}</span>
     <div className="chat-bubble">{m.text}</div>
    </div>)}
    {submitted&&<div className="chat-msg bot"><span className="chat-avatar"><Bot size={14}/></span><div className="chat-bubble success">
     <strong><Check size={13} style={{verticalAlign:'-2px'}}/> Solicitud enviada a SIDE</strong>
     <p>ID interno: <code>{submitted.id}</code>{submitted.fallback?' · guardado en modo boceto (todavía no hay base analítica conectada)':''}</p>
     <p>El equipo revisa tu solicitud y te contactamos con la cotización. Consumidos {steps.length} tokens del período.</p>
    </div></div>}
   </div>
   <footer className="chat-composer">
    {!done&&step&&<>
     {step.options
      ?<div className="chat-options">{step.options.map(o=><button key={o} type="button" onClick={()=>submit(o)}>{step.key==='plan'?planLabel(o):o}</button>)}
       {step.optional&&<button type="button" className="chat-skip" onClick={()=>submit('')}>Saltar</button>}
      </div>
      :<>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();submit();}}} placeholder={step.placeholder} aria-label={step.q}/>
        <button type="button" className="chat-send" aria-label="Enviar" onClick={()=>submit()} disabled={!input.trim()&&!step.optional}><Send size={14}/></button>
        {step.optional&&<button type="button" className="chat-skip" onClick={()=>submit('')}>Saltar</button>}
      </>}
    </>}
    {done&&!submitted&&<button type="button" className="chat-submit" onClick={send} disabled={sending}>{sending?<><Loader2 size={14} className="spin"/> Enviando…</>:<><Cpu size={14}/> Enviar solicitud a SIDE</>}</button>}
    {submitted&&<button type="button" className="chat-submit" onClick={()=>{setMsgs([openingBot,{role:'bot',at:Date.now(),text:steps[0].q}]);setValues({});setStepIdx(0);setInput('');setSubmitted(null);}}><Sparkles size={14}/> Nueva solicitud</button>}
   </footer>
  </section>
 </div>;
}
