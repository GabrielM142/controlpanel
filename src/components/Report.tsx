import {createElement,createContext,useContext,useState,useId,type CSSProperties,type ReactNode} from 'react';
import {ChevronDown,ChevronRight,Info,MapPin} from 'lucide-react';
import type {Rich,ReportNode,BarRow} from '../types';
export const NavigateContext=createContext<(id:string)=>void>(()=>{});
export function Panel({title,children,span,className=''}:{title:string;children:ReactNode;span?:number;className?:string}){
 return <section className={`panel ${className}`} style={span?{gridColumn:`span ${span}`}:undefined}><header className="panel-heading"><h2>{title}</h2><span className="panel-mark" aria-hidden="true"/></header><div className="panel-body">{children}</div></section>;
}
function Inline({nodes}:{nodes:Rich}){return <ReportNodes nodes={nodes}/>;}
export function Bars({rows,max}:{rows:BarRow[];max?:number}){
 const signed=rows.some(r=>r.v<0);const limit=max||Math.max(...rows.map(r=>Math.abs(r.v)),1);
 return <div className={`bar-list ${signed?'signed':''}`}>{rows.map((row,i)=><div className="bar-row" key={`${row.n}-${i}`}><span className="bar-name" title={row.n}>{row.n}</span><div className="bar-track" aria-label={`${row.n}: ${row.vt}`}><div className={`bar-fill ${row.v<0?'negative':''}`} style={{width:`${Math.min(100,Math.abs(row.v)/limit*100)*(signed?.5:1)}%`,...(signed?{left:row.v<0?`${50-Math.min(100,Math.abs(row.v)/limit*100)*.5}%`:'50%'}:{}),...(row.color?{background:row.color}:{})}}/></div><strong>{row.vt}</strong></div>)}</div>;
}
function ToggleChart({node}:{node:Extract<ReportNode,{kind:'toggle'}>}){
 const [selected,setSelected]=useState(node.defaultOption);const id=useId();
 return <Panel title={node.title}><div className="segmented" role="group" aria-label={node.title}>{node.options.map(option=><button key={option} aria-pressed={selected===option} aria-controls={id} onClick={()=>setSelected(option)}>{option}</button>)}</div><div id={id}><Bars rows={node.data[selected]}/></div></Panel>;
}
function Ise({node}:{node:Extract<ReportNode,{kind:'ise'}>}){
 const [open,setOpen]=useState(false);const id=useId();
 return <section className="panel ise-card"><div className="ise-top"><div className="score-orbit" style={{'--score-color':node.color,'--score-angle':`${node.score*3.6}deg`} as CSSProperties}><div><strong>{node.score}</strong><span>/100</span></div></div><div><span className="eyebrow">ISE</span><strong className="ise-status" style={{color:node.color}}>{node.status}</strong></div></div><div className="ise-components">{node.components.map(([label,weight])=><div key={label}><span>{label} ({weight}%)</span><div className="weight-track"><span style={{width:`${weight}%`,background:node.color}}/></div></div>)}</div><button className="text-button" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}><Info size={13}/>¿Cómo se calcula?<ChevronDown size={13} className={open?'rotate':''}/></button>{open&&<p className="formula" id={id}>{node.formula}</p>}</section>;
}
const provinces=[{n:'Azuay',v:44,clientes:612,ticket:'$44.10',rent:'12.8%'},{n:'Cañar',v:22,clientes:301,ticket:'$38.20',rent:'10.1%'},{n:'Loja',v:19,clientes:264,ticket:'$35.90',rent:'6.4%'},{n:'El Oro',v:15,clientes:198,ticket:'$41.00',rent:'11.2%'}];
const cantons=[{n:'Cuenca',v:70,clientes:420,ticket:'$45.00',rent:'13.1%'},{n:'Gualaceo',v:18,clientes:110,ticket:'$40.50',rent:'11.0%'},{n:'Girón',v:12,clientes:82,ticket:'$37.80',rent:'9.4%'}];
const zones=[{n:'Zona 1',v:52,clientes:210,ticket:'$46.20',rent:'13.5%'},{n:'Zona 2',v:48,clientes:210,ticket:'$43.90',rent:'12.6%'}];
function Geography(){
 const [path,setPath]=useState<string[]>([]);const rows=path.length===0?provinces:path.length===1?cantons:zones;
 return <Panel title="Cobertura Comercial — Provincia → Cantón → Zona"><div className="geo-breadcrumb"><MapPin size={14}/><button onClick={()=>setPath([])}>Todas las provincias</button>{path.map((p,i)=><span key={i}><ChevronRight size={12}/><button onClick={()=>setPath(path.slice(0,i+1))}>{p}</button></span>)}</div><div className="table-scroll"><table><thead><tr>{[path.length===0?'Provincia':path.length===1?'Cantón':'Zona','Ventas %','Clientes Fact.','Ticket Prom.','Rentabilidad'].map((h,i)=><th className={i?'num':''} key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.n}><td>{path.length<2?<button className="row-link" onClick={()=>setPath([...path,r.n])}>{r.n}<ChevronRight size={14}/></button>:r.n}</td><td className="num">{r.v}%</td><td className="num">{r.clientes}</td><td className="num">{r.ticket}</td><td className="num">{r.rent}</td></tr>)}</tbody></table></div></Panel>;
}
const allowedTags=new Set(['div','span','b','strong','i','em','br','p','small','button']);
function ElementNode({node}:{node:Extract<ReportNode,{kind:'element'}>}){
 const navigate=useContext(NavigateContext);const props:Record<string,unknown>={};
 if(node.attrs.class)props.className=node.attrs.class; if(node.attrs.style?.includes("font-size:52px"))props.className="visual-score";
 // Only semantic colors/alignment survive; typography and spacing belong to the design system.
 const style:Record<string,string>={};for(const rule of (node.attrs.style||'').split(';')){const colon=rule.indexOf(':');const key=rule.slice(0,colon).trim();const value=rule.slice(colon+1).trim();if(['color','text-align','background','font-weight'].includes(key))style[key.replace(/-([a-z])/g,(_,c:string)=>c.toUpperCase())]=value;}
 if(Object.keys(style).length)props.style=style;
 let tag=allowedTags.has(node.tag)?node.tag:'div';
 if(node.navigate){tag='button';props.onClick=()=>navigate(node.navigate!);props.className='row-link';delete props.style;}
 if(tag==='button'&&!node.navigate){props.type='button';props.onClick=()=>window.dispatchEvent(new CustomEvent('report-notice',{detail:'Vista de demostración. El análisis con datos de Odoo se conectará en la siguiente etapa.'}));}
 if(node.attrs.class==='section-label')return <h2 className="section-label"><span><Inline nodes={node.children}/></span><i/></h2>;
 return createElement(tag,props,...(tag==='br'?[]:[<Inline key="children" nodes={node.children}/>]));
}
export function ReportNodes({nodes}:{nodes:Rich}){return nodes.map((node,i)=><ReportBlock key={i} node={node}/>);}
function ReportBlock({node}:{node:ReportNode}){
 switch(node.kind){
 case 'text':return node.text;
 case 'element':return <ElementNode node={node}/>;
 case 'panel':return <Panel title={node.title} span={node.span}><Inline nodes={node.children}/></Panel>;
 case 'kpi':return <article className={`panel kpi tone-${node.tone}`}><div className="kpi-label"><span>{node.label}</span><span className={`status-dot ${node.tone}`} aria-hidden="true"/></div><div className="kpi-value"><Inline nodes={node.value}/></div><div className="kpi-deltas">{node.deltas.map((d,i)=><div key={i}><span>{d.label}</span><strong className={d.tone}><Inline nodes={d.value}/></strong></div>)}</div></article>;
 case 'metric':return <article className="panel metric"><div className="kpi-label">{node.label}</div><div className="metric-value"><Inline nodes={node.value}/></div>{node.sub&&<p>{node.sub}</p>}</article>;
 case 'bars':return <Panel title={node.title}><Bars rows={node.rows} max={node.max}/></Panel>;
 case 'table':return <Panel title={node.title} span={node.span} className="table-panel"><div className="table-scroll"><table><thead><tr>{node.headers.map((h,i)=><th className={h.num?'num':''} key={i}>{h.t}</th>)}</tr></thead><tbody>{node.rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td className={node.headers[j]?.num?'num':''} key={j}><Inline nodes={cell}/></td>)}</tr>)}</tbody></table></div></Panel>;
 case 'list':return <Panel title={node.title}><div className="insight-list">{node.items.map((item,i)=><div className="insight" key={i}><span className="insight-accent" style={{background:item.c}}/><div><strong>{item.t}</strong>{item.d&&<p>{item.d}</p>}</div></div>)}</div></Panel>;
 case 'ise':return <Ise node={node}/>;
 case 'toggle':return <ToggleChart node={node}/>;
 case 'geo':return <Geography/>;
 case 'matrix':return <Panel title="Matriz Comercial — mejor resultado / mayor riesgo"><div className="table-scroll"><table className="matrix"><thead><tr><th>Dimensión</th><th>Mejor resultado</th><th>Mayor riesgo</th></tr></thead><tbody>{node.rows.map((r,i)=><tr key={i}><td><b>{r[0]}</b></td><td><span className="tag g">{r[1]}</span></td><td><span className="tag r">{r[2]}</span></td></tr>)}</tbody></table></div></Panel>;
 }
}


