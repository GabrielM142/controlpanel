export const units=['Mayorista Hogar','Mayorista Intorno','Retail JUJ','Retail Intorno'];
export function validateRows(rows){
 if(!Array.isArray(rows)||rows.length>100000) throw Error('Snapshot inválido');
 for(const r of rows){if(!/^\d{4}-\d{2}$/.test(r.period)||!units.includes(r.unit)||typeof r.brand!=='string'||typeof r.province!=='string'||!['sales','cost','receivable','overdue','inventory','orders','customers'].every(k=>Number.isFinite(r[k])&&r[k]>=0)) throw Error('Fila inválida');}
 return rows;
}
export function summarize(rows){const total=Object.fromEntries(['sales','cost','receivable','overdue','inventory','orders'].map(k=>[k,rows.reduce((s,r)=>s+r[k],0)]));return {...total,margin:total.sales?(total.sales-total.cost)/total.sales*100:0};}
export function demoRows(){return Array.from({length:24},(_,i)=>({period:`2026-${String(Math.floor(i/4)+1).padStart(2,'0')}`,unit:units[i%4],brand:['UMCO','Chaide','Warenhaus'][i%3],province:['Azuay','Loja','El Oro'][i%3],sales:Math.round((72000+i*1650)*[2.4,.18,.8,.35][i%4]),cost:Math.round((72000+i*1650)*[2.4,.18,.8,.35][i%4]*.72),receivable:12000+i*310,overdue:2000+i*75,inventory:18000+i*810,orders:80+i*3,customers:50+i}));}
