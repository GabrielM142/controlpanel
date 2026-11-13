import {useEffect,useRef} from 'react';
import {Flame,Trophy,X} from 'lucide-react';
import type {Achievement,Motivation} from './useMotivation';
import {LEVEL_XP} from './useMotivation';

// Toast de logro (2,6 s; el resumen semanal dura 7 s). Solo motivación visual.
function Toast({a,onDone}:{a:Achievement;onDone:()=>void}){
 // El temporizador no se reinicia cuando la app vuelve a pintar: depende solo del logro.
 const done=useRef(onDone);done.current=onDone;
 useEffect(()=>{const t=setTimeout(()=>done.current(),a.weekly?7000:2600);return()=>clearTimeout(t);},[a.id,a.weekly]);
 return <div className={`ach-toast${a.weekly?' is-weekly':' om-reward'}${a.levelUp?' is-level':''}`} role="status">
  <span className="ach-icon" aria-hidden="true"><Trophy size={20} strokeWidth={1.8}/></span>
  <span className="ach-body">
   <strong>{a.levelUp?`¡Subiste a ${a.levelUp}!`:a.title}</strong>
   <span>{a.phrase}</span>
  </span>
  <span className="ach-xp">+{a.xp.toLocaleString('es-EC')} XP</span>
  <button type="button" className="ach-close" aria-label="Cerrar logro" onClick={onDone}><X size={14}/></button>
 </div>;
}

export default function AchievementToasts({m}:{m:Motivation}){
 const shown=m.toasts.slice(0,3);
 if(!shown.length)return null;
 return <div className="ach-stack" aria-live="polite">{shown.map(a=><Toast key={a.id} a={a} onDone={()=>m.dismiss(a.id)}/>)}</div>;
}

/** Nivel, avance y racha: cabecera del Centro de mando y de la Cartelera. */
export function LevelChip({m,compact}:{m:Pick<Motivation,'xp'|'level'|'streak'>;compact?:boolean}){
 const {level,streak,xp}=m;
 return <span className={`ach-chip${compact?' is-compact':''}`} title={level.toNext?`${xp.toLocaleString('es-EC')} XP · faltan ${level.toNext.toLocaleString('es-EC')} XP para el siguiente nivel (cada ${LEVEL_XP.toLocaleString('es-EC')})`:`${xp.toLocaleString('es-EC')} XP · nivel máximo`}>
  <span className="ach-chip-level">NV {level.number} · {level.name}</span>
  <span className="ach-chip-bar" role="progressbar" aria-label={`Avance al siguiente nivel ${level.progress}%`} aria-valuenow={level.progress} aria-valuemin={0} aria-valuemax={100}><i style={{width:`${level.progress}%`}}/></span>
  <span className={`ach-chip-streak${streak?'':' is-off'}`}><Flame size={13} aria-hidden="true"/>{streak} {streak===1?'día':'días'}</span>
 </span>;
}
