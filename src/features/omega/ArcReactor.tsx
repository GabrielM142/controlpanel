// Reactor central del Centro de mando: anillos animados, arco dorado del Pulso (ISE de la
// empresa, el mismo dato de Dirección) y el número grande. Sin dato, el arco queda vacío.
export default function ArcReactor({value,delta,label='PULSO DE LA EMPRESA',size=640,tone='goal'}:{value:number|null;delta?:string;label?:string;size?:number;tone?:'income'|'goal'|'loss'}){
 const C=2*Math.PI*236;const frac=value===null?0:Math.max(0,Math.min(100,value))/100;
 return <svg className="mx-reactor" width={size} height={size} viewBox="0 0 640 640" role="img" aria-label={value===null?'Pulso de la empresa pendiente':`Pulso de la empresa ${value} de 100${delta?`, ${delta}`:''}`}>
  <g className="om-orbit-40"><circle cx="320" cy="320" r="304" className="mx-ring-dots"/></g>
  <g className="om-orbit-22"><circle cx="320" cy="320" r="276" className="mx-ring-ticks"/></g>
  <circle cx="320" cy="320" r="236" className="mx-ring-track"/>
  <circle cx="320" cy="320" r="236" className="mx-ring-pulse om-ring" strokeDasharray={`${(C*frac).toFixed(1)} ${C.toFixed(1)}`} style={{['--ring-len' as string]:C*frac}} transform="rotate(-90 320 320)"/>
  <g className="om-orbit-14"><path d="M320 120a200 200 0 0 1 200 200" className="mx-ring-arc"/><path d="M320 520a200 200 0 0 1-200-200" className="mx-ring-arc is-dim"/></g>
  <circle cx="320" cy="320" r="150" className="mx-core om-glow-pulse"/>
  <text x="320" y="298" textAnchor="middle" className="mx-reactor-label">{label}</text>
  <text x="320" y="378" textAnchor="middle" className="mx-reactor-num">{value===null?'—':value}</text>
  {delta&&<text x="320" y="414" textAnchor="middle" className={`mx-reactor-delta fin-${tone}`}>{delta}</text>}
 </svg>;
}
