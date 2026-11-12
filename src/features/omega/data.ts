// OMEGA · lectura de datos sin cambiar su forma.
// Demo: se lee del fixture src/data/report.json. Real: de los widgets de la API (mismos IDs de bloque).
// Nunca se mezclan: en modo real un dato que la API no trae se muestra como pendiente.
import reportData from '../../data/report.json';
import type {Report,ReportNode,ReportPage,Rich} from '../../types';
import type {Widget} from '../../data/api';

export const report=reportData as Report;
export const pageById=(id:string)=>report.pages.find(p=>p.id===id);

export function richText(nodes:Rich|undefined):string{
 if(!nodes)return '';
 return nodes.map(n=>n.kind==='text'?n.text:'children' in n&&Array.isArray(n.children)?richText(n.children as Rich):'').join('').replace(/\s+/g,' ').trim();
}

export type Kpi={id:string;label:string;value:string;deltaLabel:string;delta:string;tone:'g'|'a'|'r'};

const BLOCKS=new Set(['kpi','table','panel','list','ise','toggle','geo','matrix','metric','bars']);
/** Walk a page in document order with the same numbering as lib/blocks.mjs. */
export function blocksOf(page:ReportPage){
 const out:{id:string;node:ReportNode}[]=[];let i=0;
 const walk=(ns:Rich)=>{for(const n of ns){if(BLOCKS.has(n.kind)){i+=1;out.push({id:`${page.id}-${String(i).padStart(2,'0')}`,node:n});}if(n.kind==='element'||n.kind==='panel')walk(n.children);}};
 walk(page.nodes);return out;
}

/** KPIs of a page: demo from report.json; live from API widgets (no demo fallback). */
export function kpisOf(pageId:string,widgets?:Record<string,Widget>|null):Kpi[]{
 const page=pageById(pageId);if(!page)return [];
 const out:Kpi[]=[];
 for(const {id,node} of blocksOf(page)){
  if(node.kind!=='kpi'&&node.kind!=='metric')continue;
  if(widgets){
   const w=widgets[id];
   if(w&&(w.kind==='kpi'||w.kind==='metric'))out.push({id,label:node.label,value:w.value,deltaLabel:w.deltas[0]?.label||'',delta:w.deltas[0]?.value||'',tone:(w.deltas[0]?.tone as Kpi['tone'])||'a'});
   else out.push({id,label:node.label,value:'—',deltaLabel:w&&w.kind==='missing'?w.reason:'Sin dato publicado',delta:'',tone:'a'});
   continue;
  }
  const d=node.kind==='kpi'?node.deltas[0]:undefined;
  out.push({id,label:node.label,value:richText(node.value).replace(/ejemplo|ej\.$/g,'').trim(),deltaLabel:d?.label||(node.kind==='metric'?node.sub:''),delta:d?richText(d.value):'',tone:node.kind==='kpi'?node.tone:'a'});
 }
 return out;
}

export function tableRows(pageId:string,blockId:string,widgets?:Record<string,Widget>|null):string[][]{
 if(widgets){const w=widgets[blockId];return w&&w.kind==='table'?w.rows:[];}
 const b=blocksOf(pageById(pageId)!).find(x=>x.id===blockId);
 return b&&b.node.kind==='table'?b.node.rows.map(r=>r.map(c=>richText(c))):[];
}

export function listItems(pageId:string,blockId:string,widgets?:Record<string,Widget>|null){
 if(widgets)return [];
 const b=blocksOf(pageById(pageId)!).find(x=>x.id===blockId);
 return b&&b.node.kind==='list'?b.node.items.map(i=>({t:i.t,d:i.d,tone:/red/.test(i.c)?'r':/green/.test(i.c)?'g':'a' as 'r'|'a'|'g'})):[];
}

/** Parse "$2.276.387", "−$63.707", "104.2%", "1,842" into a number (es-EC and en formats). */
export function parseNumber(v:string):number|null{
 const neg=/^[−-]/.test(v.trim());
 let s=v.replace(/[^\d.,]/g,'');
 if(!s)return null;
 if(/\d\.\d{3}(\D|$)/.test(s)&&!/,\d{1,2}$/.test(s))s=s.replace(/\./g,'');
 s=s.replace(/,(?=\d{3}(\D|$))/g,'').replace(',','.');
 const n=Number(s);return Number.isFinite(n)?(neg?-n:n):null;
}

/** One-sentence reading of a page, built only from its own KPIs. */
export function pageReading(pageId:string,widgets?:Record<string,Widget>|null):string{
 const k=kpisOf(pageId,widgets).filter(x=>x.value&&x.value!=='—');
 if(!k.length)return widgets?'Aún no hay cifras publicadas para esta vista: Omega no inventa lecturas.':'Esta vista todavía no tiene indicadores.';
 const best=k.find((x,i)=>i>0&&x.tone==='g');const worst=k.find((x,i)=>i>0&&x.tone==='r');
 const lead=`${k[0].label}: ${k[0].value}${k[0].delta?` (${k[0].delta} ${k[0].deltaLabel.toLowerCase()})`:''}.`;
 if(worst&&best)return `${lead} A favor: ${best.label.toLowerCase()} ${best.value}. Para revisar: ${worst.label.toLowerCase()} ${worst.value}.`;
 if(worst)return `${lead} Para revisar: ${worst.label.toLowerCase()} ${worst.value}.`;
 if(best)return `${lead} A favor: ${best.label.toLowerCase()} ${best.value}.`;
 return lead;
}

export const fmtMoney=(n:number)=>n.toLocaleString('es-EC',{style:'currency',currency:'USD',maximumFractionDigits:0});

/** Bar series of a block (demo only; live mode has no monthly finance series until the accounting mapping exists). */
export function seriesOf(pageId:string,blockId:string,widgets?:Record<string,Widget>|null):{n:string;v:number;vt:string}[]{
 if(widgets)return [];
 const b=blocksOf(pageById(pageId)!).find(x=>x.id===blockId);
 if(!b||b.node.kind!=='bars')return [];
 return b.node.rows.map(r=>{const m=/^([−-]?)([\d.,]+)\s*([KkMm]?)/.exec(r.vt.trim());const base=m?parseNumber(`${m[1]}${m[2]}`)??0:0;const mult=m&&/k/i.test(m[3])?1e3:m&&/m/i.test(m[3])?1e6:1;return {n:r.n,v:base*mult,vt:r.vt};});
}
