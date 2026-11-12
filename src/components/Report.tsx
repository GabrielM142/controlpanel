import {createElement,createContext,useContext,useState,useId,type CSSProperties,type ReactNode} from 'react';
import {ChevronDown,ChevronRight,CircleSlash,Info,MapPin} from 'lucide-react';
import type {Rich,ReportNode,BarRow} from '../types';
import type {GeoRow,Widget} from '../data/api';
import {WidgetsContext} from '../features/live/LiveData';
export const NavigateContext=createContext<(id:string)=>void>(()=>{});

// Stable widget catalog: same numbering rule as lib/blocks.mjs and the 166-block matrix.
export const BLOCK_KINDS=new Set(['kpi','table','panel','list','ise','toggle','geo','matrix','metric','bars']);
export function blockIds(pageId:string,nodes:Rich){
 const ids=new WeakMap<object,string>();let i=0;
 const walk=(list:Rich)=>{for(const n of list){if(BLOCK_KINDS.has(n.kind)){i+=1;ids.set(n,`${pageId}-${String(i).padStart(2,'0')}`);}if(n.kind==='element'||n.kind==='panel')walk(n.children);}};
 walk(nodes);return ids;
}

export function Panel({title,children,span,className='',blockId}:{title:string;children:ReactNode;span?:number;className?:string;blockId?:string}){
 return <section className={`panel ${className}`} data-block={blockId} style={span?{gridColumn:`span ${span}`}:undefined}><header className="panel-heading"><h2>{title}</h2><span className="panel-mark" aria-hidden="true"/></header><div className="panel-body">{children}</div></section>;
}
function Inline({nodes}:{nodes:Rich}){return <ReportNodes nodes={nodes}/>;}
export function Bars({rows,max}:{rows:BarRow[];max?:number}){
 if(!rows.length)return <p className="block-missing"><CircleSlash size={13}/>Sin datos para los filtros seleccionados.</p>;
 const signed=rows.some(r=>r.v<0);const limit=max||Math.max(...rows.map(r=>Math.abs(r.v)),1);
 return <div className={`bar-list ${signed?'signed':''}`}>{rows.map((row,i)=><div className="bar-row" key={`${row.n}-${i}`}><span className="bar-name" title={row.n}>{row.n}</span><div className="bar-track" role="img" aria-label={`${row.n}: ${row.vt}`}><div className={`bar-fill ${row.v<0?'negative':''}`} style={{width:`${Math.min(100,Math.abs(row.v)/limit*100)*(signed?.5:1)}%`,...(signed?{left:row.v<0?`${50-Math.min(100,Math.abs(row.v)/limit*100)*.5}%`:'50%'}:{}),...(row.color?{background:row.color}:{})}}/></div><strong>{row.vt}</strong></div>)}</div>;
}
function ToggleChart({node,data,note}:{node:Extract<ReportNode,{kind:'toggle'}>;data?:Record<string,BarRow[]>;note?:string}){
 const [selected,setSelected]=useState(node.defaultOption);const id=useId();
 const source=data||node.data;
 return <Panel title={node.title}><div className="segmented" role="group" aria-label={node.title}>{node.options.map(option=><button key={option} aria-pressed={selected===option} aria-controls={id} onClick={()=>setSelected(option)}>{option}</button>)}</div><div id={id}><Bars rows={source[selected]||[]}/></div>{note&&<p className="block-note">{note}</p>}</Panel>;
}
function Ise({node}:{node:Extract<ReportNode,{kind:'ise'}>}){
 const [open,setOpen]=useState(false);const id=useId();
 return <section className="panel ise-card"><div className="ise-top"><div className="score-orbit" style={{'--score-color':node.color,'--score-angle':`${node.score*3.6}deg`} as CSSProperties}><div><strong>{node.score}</strong><span>/100</span></div></div><div><span className="eyebrow">ISE</span><strong className="ise-status" style={{color:node.color}}>{node.status}</strong></div></div><div className="ise-components">{node.components.map(([label,weight])=><div key={label}><span>{label} ({weight}%)</span><div className="weight-track"><span style={{width:`${weight}%`,background:node.color}}/></div></div>)}</div><button className="text-button" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}><Info size={13}/>¿Cómo se calcula?<ChevronDown size={13} className={open?'rotate':''}/></button>{open&&<p className="formula" id={id}>{node.formula}</p>}</section>;
}
// Demo fixture geography (labelled example data). Live mode receives the real parent→child tree from the API.
const provinces:GeoRow[]=[{n:'Azuay',v:44,clientes:612,ticket:'$44.10',rent:'12.8%'},{n:'Cañar',v:22,clientes:301,ticket:'$38.20',rent:'10.1%'},{n:'Loja',v:19,clientes:264,ticket:'$35.90',rent:'6.4%'},{n:'El Oro',v:15,clientes:198,ticket:'$41.00',rent:'11.2%'}];
const cantons:GeoRow[]=[{n:'Cuenca',v:70,clientes:420,ticket:'$45.00',rent:'13.1%'},{n:'Gualaceo',v:18,clientes:110,ticket:'$40.50',rent:'11.0%'},{n:'Girón',v:12,clientes:82,ticket:'$37.80',rent:'9.4%'}];
const zones:GeoRow[]=[{n:'Zona 1',v:52,clientes:210,ticket:'$46.20',rent:'13.5%'},{n:'Zona 2',v:48,clientes:210,ticket:'$43.90',rent:'12.6%'}];
function Geography({tree,note}:{tree?:GeoRow[];note?:string}){
 const [path,setPath]=useState<string[]>([]);
 let rows:GeoRow[];
 if(tree){rows=tree;for(const p of path)rows=rows.find(r=>r.n===p)?.children||[];}
 else rows=path.length===0?provinces:path.length===1?cantons:zones;
 return <Panel title="Cobertura Comercial — Provincia → Cantón → Zona"><div className="geo-breadcrumb"><MapPin size={14}/><button onClick={()=>setPath([])}>Todas las provincias</button>{path.map((p,i)=><span key={i}><ChevronRight size={12}/><button onClick={()=>setPath(path.slice(0,i+1))}>{p}</button></span>)}</div><div className="table-scroll"><table><thead><tr>{[path.length===0?'Provincia':path.length===1?'Cantón':'Zona','Ventas %','Clientes Fact.','Ticket Prom.','Rentabilidad'].map((h,i)=><th className={i?'num':''} key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.n}><td>{path.length<2?<button className="row-link" onClick={()=>setPath([...path,r.n])}>{r.n}<ChevronRight size={14}/></button>:r.n}</td><td className="num">{r.v}%</td><td className="num">{r.clientes}</td><td className="num">{r.ticket}</td><td className="num">{r.rent}</td></tr>)}</tbody></table></div>{note&&<p className="block-note">{note}</p>}</Panel>;
}
const allowedTags=new Set(['div','span','b','strong','i','em','br','p','small','button']);
function ElementNode({node}:{node:Extract<ReportNode,{kind:'element'}>}){
 const navigate=useContext(NavigateContext);const {live}=useContext(WidgetsContext);const props:Record<string,unknown>={};
 if(node.attrs.class)props.className=node.attrs.class; if(node.attrs.style?.includes("font-size:52px"))props.className="visual-score";
 // Only semantic colors/alignment survive; typography and spacing belong to the design system.
 const style:Record<string,string>={};for(const rule of (node.attrs.style||'').split(';')){const colon=rule.indexOf(':');const key=rule.slice(0,colon).trim();const value=rule.slice(colon+1).trim();if(['color','text-align','background','font-weight'].includes(key))style[key.replace(/-([a-z])/g,(_,c:string)=>c.toUpperCase())]=value;}
 if(Object.keys(style).length)props.style=style;
 let tag=allowedTags.has(node.tag)?node.tag:'div';
 if(node.navigate){tag='button';props.onClick=()=>navigate(node.navigate!);props.className='row-link';delete props.style;}
 if(tag==='button'&&!node.navigate){props.type='button';props.onClick=()=>window.dispatchEvent(new CustomEvent('report-notice',{detail:live?'Esta acción todavía no tiene detalle conectado.':'Vista de demostración. El análisis con datos de Odoo se conectará en la siguiente etapa.'}));}
 if(node.attrs.class==='section-label')return <h2 className="section-label"><span><Inline nodes={node.children}/></span><i/></h2>;
 return createElement(tag,props,...(tag==='br'?[]:[<Inline key="children" nodes={node.children}/>]));
}
// The original report uses status emojis; they stay in the markup (preserved content) but are drawn as design-system marks.
const GLYPHS:Record<string,{cls:string;label:string}>={'\u{1F7E2}':{cls:'is-g',label:'verde'},'\u{1F7E1}':{cls:'is-a',label:'ámbar'},'\u{1F534}':{cls:'is-r',label:'rojo'},'✨':{cls:'is-ai',label:'IA'}};
const GLYPH_RE=/(\u{1F7E2}|\u{1F7E1}|\u{1F534}|✨)/u;
function GlyphText({text}:{text:string}){
 if(!GLYPH_RE.test(text))return <>{text}</>;
 return <>{text.split(GLYPH_RE).map((part,i)=>GLYPHS[part]?<span key={i} className={`om-glyph ${GLYPHS[part].cls}`} role="img" aria-label={GLYPHS[part].label}><span className="om-glyph-raw" aria-hidden="true">{part}</span></span>:part)}</>;
}
export function ReportNodes({nodes}:{nodes:Rich}){return nodes.map((node,i)=><ReportBlock key={i} node={node}/>);}

function titleOf(node:ReportNode){return 'label' in node?node.label:'title' in node?node.title:node.kind==='ise'?'Índice de Salud Empresarial':node.kind==='geo'?'Cobertura Comercial — Provincia → Cantón → Zona':node.kind==='matrix'?'Matriz Comercial — mejor resultado / mayor riesgo':'';}

// Insight widgets computed by the API from the published close (lists, summaries, matrix, ISE).
type Tone='g'|'a'|'r';
type InsightWidget=
 |{kind:'list';items:{t:string;d?:string;tone:Tone}[]}
 |{kind:'text';paragraphs:string[]}
 |{kind:'matrix';rows:string[][];note?:string}
 |{kind:'ise';score:number;status:string;tone:Tone;components:[string,number,number|null][];formula:string};
const TONE_VAR:Record<Tone,string>={g:'var(--fin-income)',a:'var(--fin-risk)',r:'var(--fin-loss)'};
function LiveIse({w,title}:{w:Extract<InsightWidget,{kind:'ise'}>;title:string}){
 const [open,setOpen]=useState(false);const fid=useId();const color=TONE_VAR[w.tone]||TONE_VAR.a;
 return <section className="panel ise-card" aria-label={title}><div className="ise-top"><div className="score-orbit" style={{'--score-color':color,'--score-angle':`${w.score*3.6}deg`} as CSSProperties}><div><strong>{w.score}</strong><span>/100</span></div></div><div><span className="eyebrow">ISE · propuesta OMEGA</span><strong className="ise-status" style={{color}}>{w.status}</strong></div></div><div className="ise-components">{w.components.map(([label,weight,score])=><div key={label}><span>{label} ({weight}%) · {score===null?'sin dato':`${score}/100`}</span><div className="weight-track"><span style={{width:`${score??0}%`,background:color}}/></div></div>)}</div><button type="button" className="text-button" aria-expanded={open} aria-controls={fid} onClick={()=>setOpen(!open)}><Info size={13}/>¿Cómo se calcula?<ChevronDown size={13} className={open?'rotate':''}/></button>{open&&<p className="formula" id={fid}>{w.formula}</p>}</section>;
}

/** Live rendering of one block. Never falls back to the demo numbers. */
function LiveBlock({node,id,w,loading}:{node:ReportNode;id:string;w?:Widget|InsightWidget;loading:boolean}){
 const reason=loading?'Cargando…':w&&w.kind==='missing'?w.reason:'Sin dato publicado.';
 if(!w||w.kind==='missing'){
  if(node.kind==='kpi'||node.kind==='metric')return <article className={`panel ${node.kind} tone-a is-missing`} data-block={id} aria-busy={loading}><div className="kpi-label"><span>{node.label}</span></div><div className={node.kind==='kpi'?'kpi-value':'metric-value'}>—</div><p className="block-missing"><CircleSlash size={12}/>{reason}</p></article>;
  if(node.kind==='panel')return <Panel title={node.title} span={node.span} blockId={id} className="is-missing"><p className="block-missing"><CircleSlash size={13}/>{reason}</p></Panel>;
  return <Panel title={titleOf(node)} blockId={id} className="is-missing"><p className="block-missing"><CircleSlash size={13}/>{reason}</p></Panel>;
 }
 if((node.kind==='kpi'||node.kind==='metric')&&(w.kind==='kpi'||w.kind==='metric')){
  const tone=w.deltas[0]?.tone||'a';
  if(node.kind==='metric')return <article className="panel metric" data-block={id} title={w.metric}><div className="kpi-label">{node.label}</div><div className="metric-value">{w.value}</div>{(w.note||node.sub)&&<p>{w.note||''}</p>}</article>;
  return <article className={`panel kpi tone-${tone}`} data-block={id} title={w.metric}><div className="kpi-label"><span>{node.label}</span><span className={`status-dot ${tone}`} aria-hidden="true"/></div><div className="kpi-value">{w.value}</div><div className="kpi-deltas">{w.deltas.map((d,i)=><div key={i}><span>{d.label}</span><strong className={d.tone}>{d.value}</strong></div>)}</div>{w.note&&<p className="block-note">{w.note}</p>}</article>;
 }
 if(node.kind==='table'&&w.kind==='table')return <Panel title={node.title} span={node.span} className="table-panel" blockId={id}><div className="table-scroll"><table><thead><tr>{node.headers.map((h,i)=><th className={h.num?'num':''} key={i}>{h.t}</th>)}</tr></thead><tbody>{w.rows.length?w.rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td className={node.headers[j]?.num?'num':''} key={j}>{cell}</td>)}</tr>):<tr><td colSpan={node.headers.length}><span className="block-missing"><CircleSlash size={13}/>Sin datos para los filtros seleccionados.</span></td></tr>}</tbody></table></div></Panel>;
 if(node.kind==='bars'&&w.kind==='bars')return <Panel title={node.title} blockId={id}><Bars rows={w.rows}/></Panel>;
 if(node.kind==='toggle'&&w.kind==='toggle')return <ToggleChart node={node} data={w.data} note={w.note}/>;
 if(node.kind==='geo'&&w.kind==='geo')return <Geography tree={w.rows} note={w.note}/>;
 if(node.kind==='list'&&w.kind==='list')return <Panel title={node.title} blockId={id}><div className="insight-list">{w.items.map((item,i)=><div className="insight" key={i}><span className="insight-accent" style={{background:TONE_VAR[item.tone]||TONE_VAR.a}}/><div><strong>{item.t}</strong>{item.d&&<p>{item.d}</p>}</div></div>)}</div></Panel>;
 if(node.kind==='panel'&&w.kind==='text')return <Panel title={node.title} span={node.span} blockId={id}><div className="live-summary">{w.paragraphs.map((p,i)=><p key={i}>{p}</p>)}</div></Panel>;
 if((node.kind==='ise'||node.kind==='panel')&&w.kind==='ise')return <LiveIse w={w} title={titleOf(node)}/>;
 if(node.kind==='matrix'&&w.kind==='matrix')return <Panel title={titleOf(node)} blockId={id}><div className="table-scroll"><table className="matrix"><thead><tr><th>Dimensión</th><th>Mejor resultado</th><th>Mayor riesgo</th></tr></thead><tbody>{w.rows.map((r,i)=><tr key={i}><td><b>{r[0]}</b></td><td>{r[1]!=='—'?<span className="tag g">{r[1]}</span>:'—'}</td><td>{r[2]!=='—'?<span className="tag r">{r[2]}</span>:'—'}</td></tr>)}</tbody></table></div>{w.note&&<p className="legend-note">{w.note}</p>}</Panel>;
 return <Panel title={titleOf(node)} blockId={id} className="is-missing"><p className="block-missing"><CircleSlash size={13}/>Formato de dato no soportado.</p></Panel>;
}

function ReportBlock({node}:{node:ReportNode}){
 const ctx=useContext(WidgetsContext);
 const id=BLOCK_KINDS.has(node.kind)?ctx.ids.get(node):undefined;
 if(ctx.live&&id)return <LiveBlock node={node} id={id} w={ctx.widgets?.[id]} loading={ctx.loading}/>;
 switch(node.kind){
 case 'text':return <GlyphText text={node.text}/>;
 case 'element':return <ElementNode node={node}/>;
 case 'panel':return <Panel title={node.title} span={node.span} blockId={id}><Inline nodes={node.children}/></Panel>;
 case 'kpi':return <article className={`panel kpi tone-${node.tone}`} data-block={id}><div className="kpi-label"><span>{node.label}</span><span className={`status-dot ${node.tone}`} aria-hidden="true"/></div><div className="kpi-value"><Inline nodes={node.value}/></div><div className="kpi-deltas">{node.deltas.map((d,i)=><div key={i}><span>{d.label}</span><strong className={d.tone}><Inline nodes={d.value}/></strong></div>)}</div></article>;
 case 'metric':return <article className="panel metric" data-block={id}><div className="kpi-label">{node.label}</div><div className="metric-value"><Inline nodes={node.value}/></div>{node.sub&&<p>{node.sub}</p>}</article>;
 case 'bars':return <Panel title={node.title} blockId={id}><Bars rows={node.rows} max={node.max}/></Panel>;
 case 'table':return <Panel title={node.title} span={node.span} className="table-panel" blockId={id}><div className="table-scroll"><table><thead><tr>{node.headers.map((h,i)=><th className={h.num?'num':''} key={i}>{h.t}</th>)}</tr></thead><tbody>{node.rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td className={node.headers[j]?.num?'num':''} key={j}><Inline nodes={cell}/></td>)}</tr>)}</tbody></table></div></Panel>;
 case 'list':return <Panel title={node.title} blockId={id}><div className="insight-list">{node.items.map((item,i)=><div className="insight" key={i}><span className="insight-accent" style={{background:item.c}}/><div><strong>{item.t}</strong>{item.d&&<p>{item.d}</p>}</div></div>)}</div></Panel>;
 case 'ise':return <Ise node={node}/>;
 case 'toggle':return <ToggleChart node={node}/>;
 case 'geo':return <Geography/>;
 case 'matrix':return <Panel title="Matriz Comercial — mejor resultado / mayor riesgo" blockId={id}><div className="table-scroll"><table className="matrix"><thead><tr><th>Dimensión</th><th>Mejor resultado</th><th>Mayor riesgo</th></tr></thead><tbody>{node.rows.map((r,i)=><tr key={i}><td><b>{r[0]}</b></td><td><span className="tag g">{r[1]}</span></td><td><span className="tag r">{r[2]}</span></td></tr>)}</tbody></table></div></Panel>;
 }
}
