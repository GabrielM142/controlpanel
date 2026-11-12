import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Check,Undo2,X} from 'lucide-react';

/** Ω mark used as logo and as the IA symbol. */
export const OmegaGlyph=({className=''}:{className?:string})=><span className={`omega-glyph ${className}`} aria-hidden="true">Ω</span>;

export function Eyebrow({children}:{children:ReactNode}){return <span className="om-eyebrow">{children}</span>;}

export function Chip({tone='neutral',children}:{tone?:'good'|'bad'|'warn'|'info'|'ai'|'gold'|'neutral';children:ReactNode}){
 return <span className={`om-chip om-chip--${tone}`}>{children}</span>;
}

/** Confirmation with the amount visible (decisions above $10 k). Native <dialog>: focus trap + Escape. */
export function ConfirmDialog({open,title,body,amount,confirmLabel,tone='gold',onConfirm,onCancel}:{open:boolean;title:string;body:string;amount?:string;confirmLabel:string;tone?:'gold'|'bad';onConfirm:()=>void;onCancel:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const d=ref.current;if(!d)return;if(open&&!d.open)d.showModal();if(!open&&d.open)d.close();},[open]);
 return <dialog ref={ref} className="om-dialog" onCancel={e=>{e.preventDefault();onCancel();}} aria-labelledby="om-dialog-title">
  <h2 id="om-dialog-title">{title}</h2>
  <p>{body}</p>
  {amount&&<p className="om-dialog-amount">{amount}</p>}
  <div className="om-dialog-actions">
   <button type="button" className="om-btn om-btn--ghost" onClick={onCancel}>Cancelar</button>
   <button type="button" className={`om-btn ${tone==='bad'?'om-btn--bad':'om-btn--gold'}`} onClick={onConfirm} autoFocus>{confirmLabel}</button>
  </div>
 </dialog>;
}

/** Toast with "Deshacer" after approving or rejecting. */
export function useUndoToast(){
 const [toast,setToast]=useState<{msg:string;undo?:()=>void}|null>(null);
 useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(null),6000);return()=>clearTimeout(t);},[toast]);
 const node=toast?<div className="om-toast" role="status" aria-live="polite">
  <Check size={16} aria-hidden="true"/><span>{toast.msg}</span>
  {toast.undo&&<button type="button" onClick={()=>{toast.undo?.();setToast(null);}}><Undo2 size={14} aria-hidden="true"/>Deshacer</button>}
  <button type="button" aria-label="Cerrar aviso" className="om-toast-x" onClick={()=>setToast(null)}><X size={14}/></button>
 </div>:null;
 return {show:(msg:string,undo?:()=>void)=>setToast({msg,undo}),node};
}
