import {useState} from 'react';
import {Pin,PinOff,Plus,StickyNote,Trash2} from 'lucide-react';
import {useNotes,type Note} from './useNotes';

const colorOptions:Note['color'][]=['gold','blue','green','red'];
const pageOptions=[
 {id:'',label:'Global'},
 {id:'nivel1',label:'Dirección Empresarial'},
 {id:'comercial',label:'Comercial'},
 {id:'financiero',label:'Financiero'},
 {id:'inventarios',label:'Inventarios'},
 {id:'clientes',label:'Clientes'},
 {id:'tickets',label:'Tickets Vigentes'},
 {id:'retailjuj',label:'Retail JUJ'},
 {id:'retailintorno',label:'Retail Intorno'},
];

function pageLabel(id?:string){if(!id)return 'Global';return pageOptions.find(p=>p.id===id)?.label||id;}

export default function NotesView(){
 const {notes,add,update,remove}=useNotes();
 const [text,setText]=useState('');
 const [color,setColor]=useState<Note['color']>('gold');
 const [linkedPageId,setLinkedPageId]=useState('');

 function save(){if(!text.trim())return;add({text,color,linkedPageId:linkedPageId||undefined});setText('');}

 return <>
  <h2 className="section-label"><span>Mis notas y anotaciones</span><i/></h2>
  <section className="panel">
   <header className="panel-heading"><h2><StickyNote size={13} style={{verticalAlign:'-2px',marginRight:6}}/>Nueva anotación</h2><span className="panel-mark"/></header>
   <div className="panel-body">
    <div className="note-form">
     <textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Escribí una nota rápida — se guarda automáticamente…" rows={3}/>
     <div className="note-form-row">
      <div className="note-colors" role="radiogroup" aria-label="Color de la nota">{colorOptions.map(c=><button key={c} type="button" role="radio" aria-checked={color===c} className={`note-color note-color-${c} ${color===c?'is-selected':''}`} onClick={()=>setColor(c)} aria-label={c}/>)}</div>
      <label className="note-link"><span>Vincular a</span>
       <select value={linkedPageId} onChange={e=>setLinkedPageId(e.target.value)}>{pageOptions.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select>
      </label>
      <button type="button" className="button primary" disabled={!text.trim()} onClick={save}><Plus size={13}/>Agregar</button>
     </div>
    </div>
   </div>
  </section>

  <h2 className="section-label"><span>Muro de notas ({notes.length})</span><i/></h2>
  {notes.length===0
   ?<p className="legend-note">Todavía no tenés notas. Escribí una arriba para arrancar.</p>
   :<div className="notes-grid">{notes.map(n=><article key={n.id} className={`note-card note-color-${n.color}${n.pinned?' is-pinned':''}`}>
    <div className="note-head">
     <span>{pageLabel(n.linkedPageId)}</span>
     <div className="note-actions">
      <button type="button" aria-label={n.pinned?'Desanclar':'Anclar'} title={n.pinned?'Desanclar':'Anclar'} onClick={()=>update(n.id,{pinned:!n.pinned})}>{n.pinned?<PinOff size={13}/>:<Pin size={13}/>}</button>
      <button type="button" aria-label="Eliminar nota" title="Eliminar" onClick={()=>{if(confirm('¿Eliminar la nota?'))remove(n.id);}}><Trash2 size={13}/></button>
     </div>
    </div>
    <p>{n.text}</p>
    <footer><em>{n.author}</em><span>{new Date(n.createdAt).toLocaleDateString('es-EC',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span></footer>
   </article>)}</div>}
  <p className="legend-note" style={{marginTop:14}}>Las notas ancladas aparecen como stickers en la vista vinculada. El copiloto también las lee al armar el resumen del período.</p>
 </>;
}
