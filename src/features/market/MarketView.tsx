import {useMemo,useState} from 'react';
import {ArrowRight,Search,Star,Store,Wand2} from 'lucide-react';
import {CATEGORY_META,marketCatalog,type MarketCategory,type MarketItem} from './data';

function priceCell(item:MarketItem){
 if(!item.price)return <span className="market-quote">A cotizar</span>;
 return <div className="market-price"><strong>{item.price.label}</strong></div>;
}

function highlightLabel(h?:string){if(!h)return null;const m={nuevo:'Nuevo',popular:'Popular',bundle:'Bundle'} as Record<string,string>;return <span className={`market-badge market-badge-${h}`}>{m[h]||h}</span>;}

// The MarketView accepts a preset category (from the sidebar) or "all" as a catch-all landing.
export default function MarketView({category:presetCategory}:{category?:MarketCategory|'all'}){
 const [active,setActive]=useState<MarketCategory|'all'>(presetCategory||'all');
 const [q,setQ]=useState('');

 const filtered=useMemo(()=>{
  const term=q.trim().toLowerCase();
  return marketCatalog.filter(i=>(active==='all'||i.category===active)&&(!term||`${i.name} ${i.tagline} ${i.description} ${i.tags.join(' ')}`.toLowerCase().includes(term)));
 },[active,q]);

 const counts=useMemo(()=>{const c:Record<string,number>={all:marketCatalog.length};(Object.keys(CATEGORY_META) as MarketCategory[]).forEach(k=>{c[k]=marketCatalog.filter(i=>i.category===k).length;});return c;},[]);

 function contact(item:MarketItem){
  const msg=item.price
   ?`Solicitud registrada — ${item.name}. Nuestro equipo te contactará con la propuesta comercial.`
   :`Solicitud de cotización — ${item.name}. Vamos a Nova Factory para armar el pedido a medida.`;
  window.dispatchEvent(new CustomEvent('report-notice',{detail:msg}));
  if(!item.price)location.hash='trueque';
 }

 return <>
  <h2 className="section-label"><span>Catálogo Nova Business</span><i/></h2>
  <div className="grid g-4">
   {(Object.keys(CATEGORY_META) as MarketCategory[]).map(cat=>{
    const meta=CATEGORY_META[cat];const Icon=meta.icon;
    return <article key={cat} className={`panel market-cat ${active===cat?'is-active':''}`} onClick={()=>setActive(cat)} role="button" tabIndex={0} onKeyDown={e=>{if(e.key==='Enter')setActive(cat);}}>
     <div className="market-cat-icon"><Icon size={22} strokeWidth={1.6}/></div>
     <div>
      <strong>{meta.label}</strong>
      <p>{meta.description}</p>
      <em>{counts[cat]} items disponibles</em>
     </div>
    </article>;
   })}
  </div>

  <section className="panel market-shell">
   <header className="panel-heading" style={{gap:12,flexWrap:'wrap'}}>
    <h2><Store size={13} style={{verticalAlign:'-2px',marginRight:6}}/>Marketplace ({filtered.length})</h2>
    <div className="market-toolbar">
     <div className="market-search"><Search size={13}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar por nombre, tag o descripción…" aria-label="Buscar en el marketplace"/></div>
     <div className="market-filters" role="tablist" aria-label="Filtro por categoría">
      <button type="button" role="tab" aria-selected={active==='all'} className={active==='all'?'is-active':''} onClick={()=>setActive('all')}>Todos <em>{counts.all}</em></button>
      {(Object.keys(CATEGORY_META) as MarketCategory[]).map(cat=>{
       const meta=CATEGORY_META[cat];
       return <button key={cat} type="button" role="tab" aria-selected={active===cat} className={active===cat?'is-active':''} onClick={()=>setActive(cat)}>{meta.label} <em>{counts[cat]}</em></button>;
      })}
     </div>
    </div>
   </header>
   <div className="panel-body" style={{padding:'14px 18px 20px'}}>
    {filtered.length===0
     ?<p className="legend-note">Sin resultados. Probá con otra búsqueda o cambiá la categoría.</p>
     :<div className="market-grid">
      {filtered.map(item=>{const Icon=item.icon;const CatIcon=CATEGORY_META[item.category].icon;return <article key={item.id} className={`market-card cat-${item.category}`}>
       <header>
        <div className="market-card-icon"><Icon size={20} strokeWidth={1.6}/></div>
        <div className="market-card-tag"><CatIcon size={10}/>{CATEGORY_META[item.category].label}</div>
        {highlightLabel(item.highlight)}
       </header>
       <div className="market-card-body">
        <strong>{item.name}</strong>
        <em>{item.tagline}</em>
        <p>{item.description}</p>
        <div className="market-tags">{item.tags.map(t=><span key={t}>#{t}</span>)}</div>
       </div>
       <footer>
        <div>
         {priceCell(item)}
         <span className="market-delivery">Entrega: {item.delivery}</span>
        </div>
        <button type="button" className={`market-cta ${item.price?'primary':'quote'}`} onClick={()=>contact(item)}>
         {item.price?<>Solicitar propuesta <ArrowRight size={13}/></>:<><Wand2 size={13}/> Cotizar en Factory</>}
        </button>
       </footer>
      </article>;})}
     </div>}
   </div>
  </section>

  <p className="legend-note" style={{marginTop:14}}><Star size={12} style={{verticalAlign:'-2px',marginRight:6}}/>Los precios son referenciales. La propuesta final la valida tu ejecutivo Nova Business luego de tomar el requerimiento. Los ítems <b>"A cotizar"</b> pasan directo a <b>Nova Factory</b> para el flujo guiado.</p>
 </>;
}
