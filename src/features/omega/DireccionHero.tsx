import {useMemo,useState} from 'react';
import {ArrowRight,ShieldAlert,Signature} from 'lucide-react';
import type {Widget} from '../../data/api';
import {fmtMoney,kpisOf,listItems,parseNumber,tableRows} from './data';
import {useDecisions,type Decision} from './useDecisions';
import {Chip,ConfirmDialog,Eyebrow,OmegaGlyph,useUndoToast} from './ui';

const toneChip=(t:string)=>t==='g'?'good':t==='r'?'bad':'warn';
const today=()=>new Date().toLocaleDateString('es-EC',{weekday:'long',day:'numeric',month:'long'}).toUpperCase();

function Pulse({score,status}:{score:number|null;status:string}){
 const r=58,c=2*Math.PI*r,frac=score===null?0:Math.max(0,Math.min(100,score))/100;
 return <div className="om-pulse">
  <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label={score===null?'Pulso pendiente':`Índice de salud empresarial ${score} de 100`}>
   <circle cx="70" cy="70" r={r} className="om-pulse-track"/>
   <circle cx="70" cy="70" r={r} className="om-pulse-value" strokeDasharray={`${c*frac} ${c}`} transform="rotate(-90 70 70)"/>
   <text x="70" y="76" textAnchor="middle" className="om-pulse-num">{score===null?'—':score}</text>
   <text x="70" y="98" textAnchor="middle" className="om-pulse-of">DE 100</text>
  </svg>
  <div><Eyebrow>Pulso OMEGA</Eyebrow><strong>{status||'Pendiente'}</strong><span>Índice de salud empresarial (ISE)</span></div>
 </div>;
}

function UnitsChart({rows}:{rows:string[][]}){
 const data=rows.filter(r=>r[0]&&!/total/i.test(r[0])).map(r=>({n:r[0],real:parseNumber(r[1]),ppto:parseNumber(r[2]),prev:parseNumber(r[3])})).filter(d=>d.real!==null);
 if(!data.length)return <p className="om-empty">Sin ventas por unidad para comparar.</p>;
 const max=Math.max(...data.flatMap(d=>[d.real||0,d.ppto||0,d.prev||0]),1);
 const W=640,H=220,gw=W/data.length,bw=Math.min(28,gw/5);
 const y=(v:number|null)=>H-30-((v||0)/max)*(H-50);
 const best=data.reduce((a,b)=>(b.real||0)>(a.real||0)?b:a);
 return <figure className="om-chart">
  <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Ventas reales, presupuesto y año anterior por unidad de negocio">
   {data.map((d,i)=>{const x=i*gw+gw/2;return <g key={d.n}>
    <rect x={x-bw*1.6} y={y(d.real)} width={bw} height={H-30-y(d.real)} rx="4" className={d===best?'om-bar-real om-bar-best':'om-bar-real'}><title>{`${d.n} real ${fmtMoney(d.real||0)}`}</title></rect>
    {d.ppto!==null&&<rect x={x-bw*0.5} y={y(d.ppto)} width={bw} height={H-30-y(d.ppto)} rx="4" className="om-bar-ppto"><title>{`${d.n} presupuesto ${fmtMoney(d.ppto)}`}</title></rect>}
    {d.prev!==null&&<rect x={x+bw*0.6} y={y(d.prev)} width={bw} height={H-30-y(d.prev)} rx="4" className="om-bar-prev"><title>{`${d.n} año anterior ${fmtMoney(d.prev)}`}</title></rect>}
    <text x={x} y={H-10} textAnchor="middle" className="om-axis">{d.n}</text>
   </g>;})}
  </svg>
  <figcaption className="om-legend"><span><i className="om-key om-key--real"/>Real</span><span><i className="om-key om-key--ppto"/>Presupuesto</span><span><i className="om-key om-key--prev"/>Año anterior</span><span className="om-legend-note">Mayor venta: {best.n}</span></figcaption>
 </figure>;
}

export function DecisionRow({d,onDecide}:{d:Decision;onDecide:(d:Decision,s:'aprobada'|'rechazada')=>void}){
 return <li className="om-firma-row">
  <div className="om-firma-main">
   <div className="om-firma-top"><Chip tone={d.kind==='compra'?'info':d.kind==='descuento'?'warn':d.kind==='umbral'?'gold':'bad'}>{d.kind==='compra'?'Compra':d.kind==='descuento'?'Descuento':d.kind==='umbral'?'Umbral':d.kind==='omega'?'Omega':'Reclamo'}</Chip><span className="om-muted">{d.age}</span></div>
   <strong>{d.title}{d.amount?` · ${fmtMoney(d.amount)}`:''}</strong>
   <p>{d.detail}</p>
   <p className="om-ai-line"><OmegaGlyph/>{d.recommendation}</p>
  </div>
  <div className="om-firma-actions">
   <button type="button" className="om-btn om-btn--good" onClick={()=>onDecide(d,'aprobada')}>Aprobar</button>
   <button type="button" className="om-btn om-btn--ghost" onClick={()=>onDecide(d,'rechazada')}>Rechazar</button>
  </div>
 </li>;
}

/** Shared approve/reject flow: Dialog for amounts above $10 k, toast with Deshacer. */
export function useDecisionFlow(){
 const {decide,undo}=useDecisions();
 const toast=useUndoToast();
 const [confirm,setConfirm]=useState<{d:Decision;s:'aprobada'|'rechazada'|'escalada'|'reasignada'}|null>(null);
 const run=(d:Decision,s:'aprobada'|'rechazada'|'escalada'|'reasignada')=>{decide(d.id,s);toast.show(`${d.title}: ${s}.`,()=>undo(d.id));};
 const request=(d:Decision,s:'aprobada'|'rechazada'|'escalada'|'reasignada')=>{if((d.amount||0)>10000&&(s==='aprobada'||s==='rechazada'))setConfirm({d,s});else run(d,s);};
 const dialog=<ConfirmDialog open={!!confirm} title={confirm?(confirm.s==='aprobada'?'¿Aprobar esta decisión?':'¿Rechazar esta decisión?'):''}
  body={confirm?confirm.d.title:''} amount={confirm?.d.amount?fmtMoney(confirm.d.amount):undefined}
  confirmLabel={confirm?.s==='aprobada'?'Sí, aprobar':'Sí, rechazar'} tone={confirm?.s==='rechazada'?'bad':'gold'}
  onCancel={()=>setConfirm(null)} onConfirm={()=>{if(confirm)run(confirm.d,confirm.s);setConfirm(null);}}/>;
 return {request,dialog,toast:toast.node};
}

export default function DireccionHero({widgets,live,onNavigate,onAsk}:{widgets:Record<string,Widget>|null;live:boolean;onNavigate:(id:string)=>void;onAsk:(q:string)=>void}){
 const source=live?widgets:null;
 const kpis=useMemo(()=>kpisOf('nivel1',source),[source]);
 const byLabel=(l:string)=>kpis.find(k=>k.label===l);
 const ventas=byLabel('Ventas'),cumpl=byLabel('Cumplimiento'),util=byLabel('Utilidad'),rent=byLabel('Rentabilidad'),ise=byLabel('ISE General');
 const units=useMemo(()=>tableRows('nivel1','nivel1-07',source),[source]);
 const iseRows=useMemo(()=>tableRows('nivel1','nivel1-08',source),[source]);
 const risks=useMemo(()=>listItems('nivel1','nivel1-10',source),[source]);
 const {decisions}=useDecisions();
 const firma=decisions.filter(d=>d.status==='pendiente'&&d.amount).slice(0,3);
 const flow=useDecisionFlow();

 const c=cumpl?parseNumber(cumpl.value):null,u=util?parseNumber(util.value):null;
 const weakest=units.filter(r=>!/total/i.test(r[0])).map(r=>({n:r[0],g:parseNumber(r[4]||'')})).filter(x=>x.g!==null).sort((a,b)=>(a.g||0)-(b.g||0))[0];
 const atStake=firma.reduce((s,d)=>s+(d.amount||0),0);
 const head1=c===null?'Tus cifras del cierre':c>=100?'Vendes por encima de lo previsto,':'Vendes por debajo de lo previsto,';
 const head2=u===null?'en una sola mirada.':u<0?'pero estás perdiendo margen.':'y la operación deja utilidad.';
 const score=ise?parseNumber(ise.value.split('/')[0]):null;

 const neg=(k?:{value:string})=>!!k&&(parseNumber(k.value)??0)<0;
 const big=[
  {k:ventas,label:'Ventas',fin:'income',note:ventas?.delta?`${ventas.delta} ${ventas.deltaLabel.toLowerCase()}`:'vs año anterior'},
  {k:util,label:'Utilidad',fin:neg(util)?'loss':'income',note:util?.deltaLabel||'vs año anterior'},
  {k:rent,label:'Margen bruto',fin:rent?.tone==='g'?'income':'risk',note:rent?.deltaLabel||''},
  {k:cumpl,label:'Cumplimiento',fin:'goal',note:'vs presupuesto'},
 ];

 return <div className="om-dir">
  <section className="om-card om-briefing" aria-label="Briefing">
   <div className="om-briefing-text">
    <Eyebrow>Briefing · {today()}</Eyebrow>
    <h2 className="om-headline">{head1} <em className={u!==null&&u<0?'om-bad':'om-good'}>{head2}</em></h2>
    <p>{weakest?`La unidad más rezagada es ${weakest.n} (${weakest.g!>0?'+':''}${weakest.g}% vs año anterior). `:''}{firma.length?`${firma.length} decisiones esperan tu firma por ${fmtMoney(atStake)}.`:'No hay decisiones con monto pendientes.'}</p>
    <div className="om-cta-row">
     <button type="button" className="om-btn om-btn--light" onClick={()=>onNavigate('decisiones')}>Revisar decisiones<ArrowRight size={14}/></button>
     <button type="button" className="om-btn om-btn--ai" onClick={()=>onAsk('¿Por qué cae la utilidad?')}><OmegaGlyph/>¿Por qué cae la utilidad?</button>
    </div>
   </div>
   <Pulse score={score} status={ise?.deltaLabel||''}/>
  </section>

  <section className="om-kpis" aria-label="Indicadores clave">
   {big.map(({k,label,note,fin})=><article key={label} className={`om-card om-kpi om-kpi--${fin}`}>
    <Eyebrow>{label}</Eyebrow>
    <strong className={`om-figure${k&&parseNumber(k.value)!==null&&parseNumber(k.value)!<0?' om-bad':''}`}>{k?.value||'—'}</strong>
    <div className="om-kpi-foot">{k&&<Chip tone={toneChip(k.tone)}>{k.tone==='g'?'A favor':k.tone==='r'?'En contra':'Revisar'}</Chip>}<span>{note}</span></div>
   </article>)}
  </section>

  <div className="om-split">
   <section className="om-card" aria-label="Real vs presupuesto vs año anterior">
    <header className="om-card-head"><div><Eyebrow>Ventas por unidad</Eyebrow><h3>Real vs presupuesto vs año anterior</h3></div></header>
    <UnitsChart rows={units}/>
   </section>
   <section className="om-card om-firma" aria-label="Tu firma">
    <header className="om-card-head"><div><Eyebrow>Tu firma</Eyebrow><h3>Lo que espera tu decisión</h3></div><Signature size={18} aria-hidden="true"/></header>
    {firma.length?<ul>{firma.map(d=><DecisionRow key={d.id} d={d} onDecide={flow.request}/>)}</ul>:<p className="om-empty">Todo firmado. Omega te avisará si algo cambia.</p>}
    <button type="button" className="om-link" onClick={()=>onNavigate('decisiones')}>Ver toda la bandeja<ArrowRight size={13}/></button>
   </section>
  </div>

  <div className="om-split">
   <section className="om-card" aria-label="Unidades de negocio">
    <header className="om-card-head"><div><Eyebrow>Unidades de negocio</Eyebrow><h3>Pulso por unidad</h3></div></header>
    {iseRows.length?<ul className="om-units">{iseRows.map(r=>{const v=parseNumber(r[1]||'');return <li key={r[0]}>
     <span>{r[0]}</span><div className="om-unit-bar"><i style={{width:`${v===null?0:v}%`}} className={v===null?'':v>=75?'om-good-bg':v>=50?'om-warn-bg':'om-bad-bg'}/></div><strong>{v===null?'—':v}</strong><Chip tone={v===null?'neutral':v>=75?'good':v>=50?'warn':'bad'}>{r[2]||'—'}</Chip>
    </li>;})}</ul>:<p className="om-empty">{live?'El pulso por unidad requiere la fórmula ISE aprobada.':'Sin unidades.'}</p>}
   </section>
   <section className="om-card" aria-label="Lo que podría salir mal">
    <header className="om-card-head"><div><Eyebrow>Riesgos</Eyebrow><h3>Lo que podría salir mal</h3></div><ShieldAlert size={18} aria-hidden="true"/></header>
    {risks.length?<ul className="om-risks">{risks.map(r=><li key={r.t}><i className={r.tone==='r'?'om-bad-bg':'om-warn-bg'} aria-hidden="true"/><div><strong>{r.t}</strong><p>{r.d}</p></div></li>)}</ul>:<p className="om-empty">{live?'Los riesgos automáticos requieren métricas y umbrales aprobados.':'Sin riesgos registrados.'}</p>}
   </section>
  </div>
  {flow.dialog}{flow.toast}
 </div>;
}
