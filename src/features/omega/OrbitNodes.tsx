// Seis nodos en órbita alrededor del reactor. Cada uno muestra su valor y una lectura corta;
// al tocarlo, el panel Enfoque muestra su serie. Los colores son los financieros fijos.
export type OrbitNode={id:string;label:string;value:string;delta:string;fin:'income'|'goal'|'cash'|'ai'|'loss'|'cost';angle:number};
export default function OrbitNodes({nodes,selected,onSelect}:{nodes:OrbitNode[];selected:string;onSelect:(id:string)=>void}){
 return <>{nodes.map(n=>{const rad=n.angle*Math.PI/180;const on=selected===n.id;
  // Radio 43,4 % del contenedor (330 de 760 px en el mockup), centrado.
  const left=50+43.4*Math.cos(rad),top=50+43.4*Math.sin(rad);
  return <button key={n.id} type="button" className={`mx-node fin-${n.fin}${on?' is-on':''}`} style={{left:`${left}%`,top:`${top}%`}}
   aria-pressed={on} aria-label={`${n.label}: ${n.value}. ${n.delta}`} onClick={()=>onSelect(n.id)}>
   <span className="mx-node-label">{n.label}</span>
   <span className="mx-node-value">{n.value}</span>
   <span className="mx-node-delta">{n.delta}</span>
  </button>;})}</>;
}
