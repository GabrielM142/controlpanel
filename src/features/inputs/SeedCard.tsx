import {useState} from 'react';
import {Loader2,Sparkles} from 'lucide-react';
import {api} from '../../data/api';
import {clearCache} from '../live/cache';

// "Cargar valores sugeridos": presupuesto base, umbrales y unidades iniciales calculados con los
// datos publicados de la empresa. Nunca reemplaza lo que la empresa ya cargó.
export default function SeedCard({tenantId,onDone}:{tenantId:string;onDone?:()=>void}){
 const [growth,setGrowth]=useState(5);
 const [busy,setBusy]=useState(false);
 const [msg,setMsg]=useState<{ok:boolean;text:string}|null>(null);
 const run=async()=>{
  setBusy(true);setMsg(null);
  try{
   const r=await api<{units:number;thresholds:number;budget:Record<string,number>}>('/api/inputs/seed',{tenant:tenantId,method:'POST',body:{growth}});
   clearCache();
   const b=Object.entries(r.budget).filter(([,v])=>v>0).map(([k,v])=>`${k.replace('_',' ')} ${v} meses`).join(', ')||'ninguno nuevo';
   setMsg({ok:true,text:`Listo: presupuesto (${b}), ${r.thresholds} umbrales y ${r.units} unidades. Todo queda editable; lo que ya tenías no se tocó.`});
   onDone?.();
  }catch(e){setMsg({ok:false,text:(e as Error).message});}finally{setBusy(false);}
 };
 return <section className="panel om-seed" aria-labelledby="om-seed-t"><header className="panel-heading"><h2 id="om-seed-t">Valores sugeridos</h2><Sparkles size={15} aria-hidden="true"/></header>
  <div className="panel-body">
   <p className="legend-note">Carga en un clic un punto de partida con tus propios datos: presupuesto de ventas, compras y gastos fijos (mismo mes del año anterior + crecimiento), marketing al 1% de la venta, todos los umbrales con sus valores por defecto (meta mensual y ticket mínimo calculados de tu venta) y una unidad de negocio por equipo de venta si aún no tienes. No reemplaza nada de lo que ya cargaste.</p>
   <div className="om-ai-actions">
    <label htmlFor="om-seed-g" className="om-mkt-label"><span>Crecimiento sobre el año anterior</span><div className="om-cf-num"><input id="om-seed-g" type="number" value={growth} step={1} onChange={e=>setGrowth(Number(e.target.value))}/><em>%</em></div></label>
    <button type="button" className="button primary" onClick={run} disabled={busy}>{busy?<Loader2 size={14} className="om-spin"/>:<Sparkles size={14}/>}Cargar valores sugeridos</button>
   </div>
   {msg&&<p className={`legend-note ${msg.ok?'':'om-ai-error'}`} role={msg.ok?'status':'alert'}>{msg.text}</p>}
  </div></section>;
}
