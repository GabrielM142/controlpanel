import {useMemo,useState} from 'react';
import {AlertTriangle,Clock3,Filter,LifeBuoy,MessageSquare,Star,Timer,TrendingDown,TrendingUp,User} from 'lucide-react';

type Priority='alta'|'media'|'baja';
type Status='abierto'|'en_proceso'|'esperando_cliente'|'resuelto'|'cerrado';

type Ticket={id:string;cliente:string;asunto:string;prioridad:Priority;agente:string;status:Status;abierto:string;sla:number;cola:string;canal:'Email'|'Teléfono'|'WhatsApp'|'Portal'};

const tickets:Ticket[]=[
 {id:'JUJ-1042',cliente:'Comercial Andes',asunto:'Factura duplicada en Odoo — abril',prioridad:'alta',agente:'Andrea M.',status:'en_proceso',abierto:'hoy 09:12',sla:82,cola:'3h 40m',canal:'Email'},
 {id:'JUJ-1041',cliente:'Distribuidora El Oro',asunto:'Cortes en el POS de la sucursal Machala',prioridad:'alta',agente:'Bryan R.',status:'abierto',abierto:'hoy 08:20',sla:110,cola:'5h 05m',canal:'WhatsApp'},
 {id:'JUJ-1039',cliente:'Grupo Warenhaus',asunto:'Solicitud de reporte comparativo Q2',prioridad:'media',agente:'Andrea M.',status:'esperando_cliente',abierto:'ayer 17:28',sla:38,cola:'11h 22m',canal:'Portal'},
 {id:'JUJ-1037',cliente:'Chaide & Chaide',asunto:'Ajuste de precios mayoristas Q3',prioridad:'media',agente:'Camilo P.',status:'en_proceso',abierto:'ayer 14:03',sla:61,cola:'19h 48m',canal:'Email'},
 {id:'JUJ-1035',cliente:'Umco S.A.',asunto:'Onboarding nuevo usuario contable',prioridad:'baja',agente:'Camilo P.',status:'resuelto',abierto:'ayer 11:11',sla:12,cola:'—',canal:'Teléfono'},
 {id:'JUJ-1033',cliente:'Comercial Andes',asunto:'Tablero de cartera — filtro por vendedor',prioridad:'media',agente:'Andrea M.',status:'en_proceso',abierto:'martes 16:44',sla:74,cola:'1d 03h',canal:'Portal'},
 {id:'JUJ-1029',cliente:'Ferretería Loja',asunto:'Sincronización de inventarios Bodega Norte',prioridad:'alta',agente:'Bryan R.',status:'en_proceso',abierto:'lunes 10:19',sla:96,cola:'2d 04h',canal:'Email'},
 {id:'JUJ-1024',cliente:'Retail Intorno',asunto:'Alertas de stock crítico no llegan por correo',prioridad:'baja',agente:'Camilo P.',status:'resuelto',abierto:'lunes 08:02',sla:9,cola:'—',canal:'Email'},
 {id:'JUJ-1018',cliente:'Grupo Warenhaus',asunto:'Duplicidad de clientes en padrón',prioridad:'media',agente:'Andrea M.',status:'cerrado',abierto:'viernes 15:20',sla:22,cola:'—',canal:'Portal'},
];

const statusLabel:Record<Status,string>={abierto:'Abierto',en_proceso:'En proceso',esperando_cliente:'Esperando cliente',resuelto:'Resuelto',cerrado:'Cerrado'};
const statusTone:Record<Status,'g'|'a'|'r'|'muted'>={abierto:'r',en_proceso:'a',esperando_cliente:'a',resuelto:'g',cerrado:'muted'};
const priorityTone:Record<Priority,'r'|'a'|'g'>={alta:'r',media:'a',baja:'g'};

const timeline=[
 {at:'09:12',t:'Nuevo ticket',d:'Comercial Andes — factura duplicada',tone:'r' as const},
 {at:'08:47',t:'Ticket JUJ-1029 escalado',d:'Bryan R. → Nivel 2 · Sync inventarios',tone:'a' as const},
 {at:'ayer',t:'JUJ-1024 resuelto',d:'CSAT recibido: 5/5',tone:'g' as const},
 {at:'ayer',t:'SLA en riesgo — JUJ-1041',d:'Faltan 45 minutos para vencer',tone:'a' as const},
 {at:'lunes',t:'Cliente respondió JUJ-1039',d:'Warenhaus — solicita reunión',tone:'g' as const},
];

export default function TicketsView(){
 const [priority,setPriority]=useState<'todos'|Priority>('todos');
 const [status,setStatus]=useState<'todos'|Status>('todos');
 const [agent,setAgent]=useState<'todos'|string>('todos');

 const agents=useMemo(()=>Array.from(new Set(tickets.map(t=>t.agente))),[]);
 const filtered=useMemo(()=>tickets.filter(t=>(priority==='todos'||t.prioridad===priority)&&(status==='todos'||t.status===status)&&(agent==='todos'||t.agente===agent)),[priority,status,agent]);

 const abiertos=tickets.filter(t=>t.status==='abierto'||t.status==='en_proceso').length;
 const slaVencidos=tickets.filter(t=>t.sla>=100&&t.status!=='cerrado'&&t.status!=='resuelto').length;
 const enRiesgo=tickets.filter(t=>t.sla>=75&&t.sla<100&&t.status!=='cerrado'&&t.status!=='resuelto').length;
 const cerradosHoy=1; // demo

 return <>
  <h2 className="section-label"><span>Indicadores de Soporte</span><i/></h2>
  <div className="grid g-4">
   <article className="panel kpi tone-r">
    <div className="kpi-label"><span>Tickets abiertos</span><span className="status-dot r"/></div>
    <div className="kpi-value">{abiertos}</div>
    <div className="kpi-deltas">
     <div><span>vs semana pasada</span><strong className="up"><TrendingUp size={11} style={{verticalAlign:'-2px'}}/> +2</strong></div>
     <div><span>Prioridad alta</span><strong>3</strong></div>
    </div>
   </article>
   <article className="panel kpi tone-a">
    <div className="kpi-label"><span>En riesgo de SLA</span><span className="status-dot a"/></div>
    <div className="kpi-value">{enRiesgo}</div>
    <div className="kpi-deltas">
     <div><span>Faltan &lt; 4h</span><strong>2</strong></div>
     <div><span>Faltan &lt; 24h</span><strong>{Math.max(0,enRiesgo-2)}</strong></div>
    </div>
   </article>
   <article className="panel kpi tone-r">
    <div className="kpi-label"><span>SLA vencidos</span><span className="status-dot r"/></div>
    <div className="kpi-value">{slaVencidos}</div>
    <div className="kpi-deltas">
     <div><span>Cliente clave</span><strong>1</strong></div>
     <div><span>vs promedio</span><strong className="down"><TrendingDown size={11} style={{verticalAlign:'-2px'}}/> -1</strong></div>
    </div>
   </article>
   <article className="panel kpi tone-g">
    <div className="kpi-label"><span>Cerrados hoy</span><span className="status-dot g"/></div>
    <div className="kpi-value">{cerradosHoy}</div>
    <div className="kpi-deltas">
     <div><span>CSAT promedio</span><strong>4.7 / 5</strong></div>
     <div><span>Tiempo medio</span><strong>2h 08m</strong></div>
    </div>
   </article>
  </div>

  <h2 className="section-label"><span>Métricas del equipo</span><i/></h2>
  <div className="grid g-4">
   <article className="panel metric"><div className="kpi-label">Tiempo medio de respuesta</div><div className="metric-value">14 min</div><p>Meta interna: &lt; 15 min</p></article>
   <article className="panel metric"><div className="kpi-label">Tiempo medio de resolución</div><div className="metric-value">3h 42m</div><p>Meta interna: &lt; 4h</p></article>
   <article className="panel metric"><div className="kpi-label">Cumplimiento de SLA</div><div className="metric-value">92%</div><p>Objetivo trimestral: 95%</p></article>
   <article className="panel metric"><div className="kpi-label">Satisfacción (CSAT)</div><div className="metric-value">4.6 / 5</div><p>Sobre 42 encuestas del mes</p></article>
  </div>

  <h2 className="section-label"><span>Tickets vigentes · seguimiento operativo</span><i/></h2>
  <section className="panel" style={{overflow:'visible'}}>
   <header className="panel-heading" style={{flexWrap:'wrap',gap:10}}>
    <h2><LifeBuoy size={13} style={{verticalAlign:'-2px',marginRight:6}}/>Cola de soporte ({filtered.length})</h2>
    <div className="tickets-filters">
     <label><Filter size={12}/><span>Prioridad</span>
      <select value={priority} onChange={e=>setPriority(e.target.value as Priority|'todos')}>
       <option value="todos">Todas</option><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option>
      </select>
     </label>
     <label><span>Estado</span>
      <select value={status} onChange={e=>setStatus(e.target.value as Status|'todos')}>
       <option value="todos">Todos</option>
       {(Object.keys(statusLabel) as Status[]).map(s=><option key={s} value={s}>{statusLabel[s]}</option>)}
      </select>
     </label>
     <label><User size={12}/><span>Agente</span>
      <select value={agent} onChange={e=>setAgent(e.target.value)}>
       <option value="todos">Todos</option>
       {agents.map(a=><option key={a}>{a}</option>)}
      </select>
     </label>
    </div>
   </header>
   <div className="panel-body" style={{padding:0}}>
    <div className="table-scroll">
     <table>
      <thead><tr>
       <th>#</th><th>Cliente</th><th>Asunto</th><th>Prioridad</th><th>Agente</th><th>Estado</th><th className="num">SLA</th><th className="num">En cola</th><th>Canal</th>
      </tr></thead>
      <tbody>
       {filtered.map(t=><tr key={t.id}>
        <td><b>{t.id}</b></td>
        <td>{t.cliente}</td>
        <td className="ticket-subject">{t.asunto}</td>
        <td><span className={`tag ${priorityTone[t.prioridad]}`}>{t.prioridad.toUpperCase()}</span></td>
        <td>{t.agente}</td>
        <td><span className={`ticket-status s-${statusTone[t.status]}`}>{statusLabel[t.status]}</span></td>
        <td className="num"><span className={`sla-mini t-${t.sla>=100?'r':t.sla>=75?'a':'g'}`}><span style={{width:`${Math.min(100,t.sla)}%`}}/></span><em>{t.sla}%</em></td>
        <td className="num">{t.cola}</td>
        <td>{t.canal}</td>
       </tr>)}
       {filtered.length===0&&<tr><td colSpan={9} style={{padding:'22px 15px',color:'var(--muted)'}}>Sin tickets para los filtros seleccionados.</td></tr>}
      </tbody>
     </table>
    </div>
   </div>
  </section>

  <div className="grid g-2" style={{marginTop:14}}>
   <section className="panel">
    <header className="panel-heading"><h2><Timer size={13} style={{verticalAlign:'-2px',marginRight:6}}/>Últimas actualizaciones</h2><span className="panel-mark"/></header>
    <div className="panel-body"><div className="insight-list">{timeline.map((e,i)=><div className="insight" key={i}><span className="insight-accent" style={{background:e.tone==='r'?'var(--red)':e.tone==='a'?'var(--amber)':'var(--green)'}}/><div><strong>{e.at} · {e.t}</strong><p>{e.d}</p></div></div>)}</div></div>
   </section>
   <section className="panel">
    <header className="panel-heading"><h2><Star size={13} style={{verticalAlign:'-2px',marginRight:6}}/>Vista del gerente</h2><span className="panel-mark"/></header>
    <div className="panel-body">
     <div className="ticket-hints">
      <div className="ticket-hint"><AlertTriangle size={14}/><div><strong>2 tickets alta prioridad sin asignar en la última hora</strong><p>Comercial Andes y Distribuidora El Oro. Sugerido: escalar a Nivel 2.</p></div></div>
      <div className="ticket-hint"><Clock3 size={14}/><div><strong>SLA en riesgo — JUJ-1041</strong><p>Faltan 45 minutos. Andrea M. está en otro caso.</p></div></div>
      <div className="ticket-hint"><MessageSquare size={14}/><div><strong>Ticket JUJ-1039 requiere respuesta</strong><p>Warenhaus solicitó una reunión hace 11 horas.</p></div></div>
     </div>
    </div>
   </section>
  </div>
 </>;
}
