import type {ReactNode} from 'react';
import type {LucideIcon} from 'lucide-react';

// Tarjeta tipo póster de la cartelera (crece 6 % al pasar el cursor).
export default function PosterCard({title,sub,icon:Icon,tone='brand',progress,rank,onOpen,children}:{title:string;sub?:string;icon?:LucideIcon;tone?:'brand'|'income'|'loss'|'goal'|'cash'|'ai';
 progress?:number;rank?:number;onOpen?:()=>void;children?:ReactNode}){
 const body=<>
  {Icon&&<span className={`bb-poster-icon tone-${tone}`} aria-hidden="true"><Icon size={22} strokeWidth={1.8}/></span>}
  <span className="bb-poster-title">{title}</span>
  {sub&&<span className="bb-poster-sub">{sub}</span>}
  {children}
  {progress!==undefined&&<span className="bb-progress" role="progressbar" aria-label={`Leído ${progress}%`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><i className={`tone-${tone}`} style={{width:`${progress}%`}}/></span>}
 </>;
 const card=onOpen?<button type="button" className={`bb-poster om-hover-grow tone-${tone}`} onClick={onOpen}>{body}</button>:<div className={`bb-poster tone-${tone}`}>{body}</div>;
 if(rank===undefined)return card;
 return <div className="bb-ranked"><span className="bb-rank" aria-hidden="true">{rank}</span>{card}</div>;
}
