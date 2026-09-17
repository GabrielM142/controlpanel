import {useMemo} from 'react';
import {AlertTriangle,ArrowRight,CheckCircle2,Coins,LifeBuoy,Package,RotateCcw,SlidersHorizontal,Sparkles,Store,TrendingUp} from 'lucide-react';
import {AREA_LABEL,useThresholds,type ThresholdArea,type ThresholdRule} from './useThresholds';

const areaIcon:Record<ThresholdArea,typeof Store>={comercial:TrendingUp,financiero:Coins,compras:Store,inventarios:Package,soporte:LifeBuoy};

function fmt(v:number,unit:string){
 if(unit==='USD')return v.toLocaleString('es-EC',{style:'currency',currency:'USD',maximumFractionDigits:0});
 if(unit==='%')return `${v}%`;
 return `${v} ${unit}`;
}

function status(r:ThresholdRule){
 if(!r.enabled)return 'off';
 const tri=(r.operator==='>'&&r.current>r.threshold)||(r.operator==='>='&&r.current>=r.threshold)||(r.operator==='<'&&r.current<r.threshold)||(r.operator==='<='&&r.current<=r.threshold);
 return tri?(r.tone==='r'?'critical':'warning'):'ok';
}

const statusLabel:Record<string,string>={ok:'Dentro del umbral',warning:'Cerca del límite',critical:'Umbral excedido',off:'Alerta desactivada'};

export default function ThresholdsView(){
 const {rules,updateThreshold,toggleEnabled,resetOne,resetAll,stats}=useThresholds();
 const grouped=useMemo(()=>{const g:Record<ThresholdArea,ThresholdRule[]>={comercial:[],financiero:[],compras:[],inventarios:[],soporte:[]};for(const r of rules)g[r.area].push(r);return g;},[rules]);
 const cumplimiento=stats.enabled?Math.round(((stats.enabled-stats.triggered)/stats.enabled)*100):100;

 return <>
  <h2 className="section-label"><span>Estado global de umbrales</span><i/></h2>
  <div className="grid g-4">
   <article className="panel kpi tone-a"><div className="kpi-label"><span>Umbrales activos</span><span className="status-dot a"/></div><div className="kpi-value">{stats.enabled}</div><div className="kpi-deltas"><div><span>Total configurados</span><strong>{stats.total}</strong></div><div><span>Desactivados</span><strong>{stats.total-stats.enabled}</strong></div></div></article>
   <article className={`panel kpi tone-${stats.critical>0?'r':stats.triggered>0?'a':'g'}`}><div className="kpi-label"><span>Alertas disparadas</span><span className={`status-dot ${stats.critical>0?'r':stats.triggered>0?'a':'g'}`}/></div><div className="kpi-value">{stats.triggered}</div><div className="kpi-deltas"><div><span>Críticas</span><strong className={stats.critical>0?'down':''}>{stats.critical}</strong></div><div><span>De atención</span><strong>{stats.triggered-stats.critical}</strong></div></div></article>
   <article className="panel kpi tone-g"><div className="kpi-label"><span>Cumplimiento del tablero</span><span className="status-dot g"/></div><div className="kpi-value">{cumplimiento}%</div><div className="kpi-deltas"><div><span>Umbrales ok</span><strong>{stats.enabled-stats.triggered}</strong></div><div><span>Excedidos</span><strong>{stats.triggered}</strong></div></div></article>
   <article className="panel metric"><div className="kpi-label">Consejo del copiloto</div><div className="metric-value" style={{fontSize:14,lineHeight:1.55}}>{stats.critical>0?`Tenés ${stats.critical} umbral(es) crítico(s). Revisá el detalle antes de tu próxima reunión gerencial.`:stats.triggered>0?'Hay alertas de atención — ajustá con el líder de área.':'Todos los indicadores están dentro de los umbrales configurados.'}</div><p>El copiloto lee estos umbrales al armar el resumen de cada vista.</p></article>
  </div>

  <div className="thresholds-toolbar">
   <span><SlidersHorizontal size={13}/> Ajustá umbrales por área. Los cambios se guardan automáticamente y disparan alertas en la campana superior.</span>
   <button type="button" className="button secondary" onClick={()=>{if(confirm('¿Restaurar los umbrales por defecto?'))resetAll();}}><RotateCcw size={13}/>Restaurar defaults</button>
  </div>

  {(Object.keys(grouped) as ThresholdArea[]).map(area=>{
   const rulesArea=grouped[area];if(rulesArea.length===0)return null;
   const Icon=areaIcon[area];
   const triggered=rulesArea.filter(r=>status(r)==='critical'||status(r)==='warning').length;
   return <section className="panel threshold-area" key={area}>
    <header className="panel-heading" style={{gap:12,flexWrap:'wrap'}}>
     <h2><Icon size={13} style={{verticalAlign:'-2px',marginRight:6}}/>{AREA_LABEL[area]} <em style={{fontStyle:'normal',color:'var(--muted)',fontWeight:500,marginLeft:6}}>({rulesArea.length} umbral{rulesArea.length===1?'':'es'})</em></h2>
     {triggered>0&&<span className={`ticket-status s-${rulesArea.some(r=>status(r)==='critical')?'r':'a'}`} style={{marginLeft:'auto'}}><AlertTriangle size={11}/>{triggered} activa{triggered===1?'':'s'}</span>}
    </header>
    <div className="panel-body threshold-body">
     {rulesArea.map(r=>{
      const st=status(r);
      const distance=Math.abs(r.current-r.threshold);
      const near=st==='ok'&&r.threshold!==0&&distance/Math.max(1,Math.abs(r.threshold))<0.1;
      return <div key={r.id} className={`threshold-row st-${st}${near?' is-near':''}`}>
       <div className="th-head">
        <div>
         <strong>{r.label}</strong>
         <p>{r.description}</p>
        </div>
        <label className="th-toggle" title={r.enabled?'Desactivar alerta':'Activar alerta'}>
         <input type="checkbox" checked={r.enabled} onChange={e=>toggleEnabled(r.id,e.target.checked)}/>
         <span/>
        </label>
       </div>
       <div className="th-body">
        <div className="th-cell">
         <span>Valor actual</span>
         <strong>{fmt(r.current,r.unit)}</strong>
        </div>
        <div className="th-cell">
         <span>Condición</span>
         <strong>{r.metric} {r.operator} {fmt(r.threshold,r.unit)}</strong>
        </div>
        <div className="th-cell th-input">
         <span>Umbral</span>
         <div>
          <input type="number" value={r.threshold} step={r.unit==='%'?0.1:r.unit==='USD'?10000:1} onChange={e=>updateThreshold(r.id,parseFloat(e.target.value))} disabled={!r.enabled} aria-label={`Umbral de ${r.label}`}/>
          <em>{r.unit}</em>
         </div>
        </div>
        <div className="th-cell th-status">
         <span>Estado</span>
         <strong className={`th-badge tone-${st}`}>
          {st==='ok'&&<CheckCircle2 size={11}/>}
          {(st==='critical'||st==='warning')&&<AlertTriangle size={11}/>}
          {st==='off'&&<Sparkles size={11}/>}
          {statusLabel[st]}
         </strong>
        </div>
        <div className="th-cell th-actions">
         <a className="row-link" href={'#'+r.linkedPageId}>Ver vista <ArrowRight size={12}/></a>
         <button type="button" className="link-button" onClick={()=>resetOne(r.id)}><RotateCcw size={11}/>Default ({fmt(r.defaultThreshold,r.unit)})</button>
        </div>
       </div>
      </div>;
     })}
    </div>
   </section>;
  })}

  <p className="legend-note" style={{marginTop:14}}><b>Cómo funciona.</b> Cada umbral genera una alerta que aparece en la campana superior y en el copiloto de análisis. Cuando conectemos la base analítica, los valores actuales se van a leer directo de Odoo y estas reglas van a activar notificaciones en tiempo real.</p>
 </>;
}
