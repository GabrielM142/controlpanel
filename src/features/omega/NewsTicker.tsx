// Cinta "Novedades": lo que pasó desde el cierre (nunca "en vivo"). Cada ítem lleva su hora o
// la frase "desde el cierre". Se pausa al pasar el cursor o con foco.
export type NewsItem={id:string;text:string;when:string;fin:'income'|'loss'|'goal'|'cash'|'ai'|'cost'};
export default function NewsTicker({items}:{items:NewsItem[]}){
 if(!items.length)return <footer className="mx-ticker-bar" aria-label="Novedades"><span className="mx-ticker-title">NOVEDADES</span><span className="mx-ticker-empty">Sin novedades desde el cierre.</span></footer>;
 const row=(dup:boolean)=>items.map(n=><span key={`${dup?'b':'a'}-${n.id}`} className="mx-ticker-item" aria-hidden={dup||undefined}><i className={`mx-dot fin-${n.fin}`}/>{n.text}<em>{n.when}</em></span>);
 return <footer className="mx-ticker-bar om-ticker" aria-label="Novedades" tabIndex={0}>
  <span className="mx-ticker-title">NOVEDADES</span>
  <div className="mx-ticker-viewport"><div className="om-ticker-track mx-ticker-track">{row(false)}{row(true)}</div></div>
 </footer>;
}
