// Cash-flow projection (pure): base from the API + explicit levers. Kept apart from the view so the
// rules are readable and testable.
export type Base={cutoff:string;months:string[];hasLedger:boolean;history:{month:string;inflow:number;outflow:number;net:number;balance:number}[];
 opening:number|null;committed:{overdue:number;dueByMonth:Record<string,number>;payables:number;pendingReceipts:number};
 runRate:{sales:number;purchases:number;expenses:number;basis:string};marginPct:number|null;daysCollect:number|null;daysCollectCurrent:number|null;daysPay:number|null;
 cashIn:number|null;cashOut:number|null;
 budget:Record<string,Record<string,number>>};
export type Investment={month:string;amount:number;concept:string};
export type Params={
 opening:number|null;        // real bank balance when the ledger lacks the opening entry
 salesGrowth:number;         // % over run-rate (ignored for months with a sales budget)
 collectDays:number;         // days to collect new sales
 overdueRecovery:number;     // % of the overdue portfolio collected within the horizon
 promoMonths:string[];promoDiscount:number;promoUplift:number;promoCost:number; // promotion
 marketing:number;           // extra monthly marketing spend
 marginBoost:number;         // gross-margin points gained by price or mix
 vat:number;                 // IVA charged on new sales and paid on new purchases (%)
 investments:Investment[];
};
export type Month={month:string;taxes:number;sales:number;collections:number;fromNewSales:number;fromPortfolio:number;suppliers:number;expenses:number;
 marketing:number;investments:number;outflow:number;net:number;balance:number;gross:number};
export type Projection={rows:Month[];opening:number;closing:number;min:{month:string;balance:number};negativeMonths:number;financing:number;
 grossProfit:number;operatingResult:number;sales:number};

export function defaults(b:Base):Params{
 return {opening:null,salesGrowth:0,collectDays:Math.round(Math.min(120,Math.max(0,b.daysCollectCurrent??30))),overdueRecovery:20,vat:15,
  promoMonths:[],promoDiscount:10,promoUplift:15,promoCost:0,marketing:0,marginBoost:0,investments:[]};
}

/** Spread an amount `lagDays` after month index i into the rows (fractional months split in two). */
function lagged(target:number[],i:number,amount:number,lagDays:number){
 const lag=Math.max(0,lagDays)/30;const k=Math.floor(lag);const frac=lag-k;
 if(i+k<target.length)target[i+k]+=amount*(1-frac);
 if(frac>0&&i+k+1<target.length)target[i+k+1]+=amount*frac;
}

export function project(b:Base,p:Params):Projection{
 const n=b.months.length;
 const margin=((b.marginPct??0)+(p.marginBoost||0))/100;
 // Purchases follow units sold; a better margin means a lower cost per unit sold.
 const buyRatio=(b.runRate.sales?b.runRate.purchases/b.runRate.sales:1-margin)*(1-(p.marginBoost||0)/100/Math.max(0.01,1-(b.marginPct??0)/100));
 const sales=b.months.map(m=>{
  const base=b.budget.ventas?.[m]??b.runRate.sales*(1+p.salesGrowth/100);
  return p.promoMonths.includes(m)?base*(1+p.promoUplift/100)*(1-p.promoDiscount/100):base;
 });
 // Units sold drive purchases; a discount lowers the price, not the cost.
 const volume=b.months.map((m,i)=>p.promoMonths.includes(m)?sales[i]/(1-p.promoDiscount/100):sales[i]);
 const fromNew=Array(n).fill(0),fromPortfolio=Array(n).fill(0),suppliers=Array(n).fill(0);
 const tax=1+(p.vat??15)/100;
 sales.forEach((s,i)=>lagged(fromNew,i,s*tax,p.collectDays));
 // Receivables already invoiced: due amounts on their month (this month's remainder goes to the first).
 for(const [m,v] of Object.entries(b.committed.dueByMonth)){if(m>b.months[n-1])continue;fromPortfolio[m<b.months[0]?0:b.months.indexOf(m)]+=v;}
 const recovered=b.committed.overdue*p.overdueRecovery/100;
 for(let i=0;i<n;i++)fromPortfolio[i]+=recovered/n;
 // Suppliers: what is owed today next month, pending receipts after delivery, new purchases with the payment days.
 suppliers[0]+=b.committed.payables;
 lagged(suppliers,0,b.committed.pendingReceipts,b.daysPay??30);
 volume.forEach((v,i)=>{const buy=b.budget.compras?.[b.months[i]]??v*buyRatio;lagged(suppliers,i,buy*tax,b.daysPay??30);});
 const opening=p.opening??b.opening??0;
 let bal=opening;let min={month:b.months[0],balance:Infinity};let neg=0;
 const rows:Month[]=b.months.map((m,i)=>{
  const expenses=b.budget.gastos_fijos?.[m]??b.runRate.expenses;
  const marketing=(b.budget.marketing?.[m]??0)+p.marketing+(p.promoMonths.includes(m)?p.promoCost:0);
  const investments=p.investments.filter(x=>x.month===m).reduce((s,x)=>s+x.amount,0);
  // IVA collected minus IVA paid on purchases, declared and paid to the SRI the following month.
  const taxes=i===0?0:Math.max(0,(sales[i-1]-(b.budget.compras?.[b.months[i-1]]??volume[i-1]*buyRatio))*(tax-1));
  const collections=fromNew[i]+fromPortfolio[i];
  const outflow=suppliers[i]+expenses+marketing+investments+taxes;
  const net=collections-outflow;bal+=net;
  if(bal<min.balance)min={month:m,balance:bal};if(bal<0)neg++;
  const gross=sales[i]-volume[i]*(1-margin);
  return {month:m,taxes,sales:sales[i],collections,fromNewSales:fromNew[i],fromPortfolio:fromPortfolio[i],suppliers:suppliers[i],expenses,marketing,investments,outflow,net,balance:bal,gross};
 });
 const grossProfit=rows.reduce((s,r)=>s+r.gross,0);
 return {rows,opening,closing:bal,min,negativeMonths:neg,financing:min.balance<0?-min.balance:0,grossProfit,
  operatingResult:grossProfit-rows.reduce((s,r)=>s+r.expenses+r.marketing,0),sales:rows.reduce((s,r)=>s+r.sales,0)};
}

/** Levers to raise sales and cash: each one alone against the current scenario. */
export function levers(b:Base,p:Params){
 const cur=project(b,p);
 const test=(label:string,detail:string,q:Partial<Params>)=>{const r=project(b,{...p,...q});
  return {label,detail,cash:r.closing-cur.closing,profit:r.operatingResult-cur.operatingResult,sales:r.sales-cur.sales};};
 return [
  test(p.collectDays<=30?'Cobrar de contado':'Cobrar 30 días antes',`Días de cobro ${Math.max(0,p.collectDays-30)} en lugar de ${p.collectDays}`,{collectDays:Math.max(0,p.collectDays-30)}),
  test('Recuperar 30% más de la cartera vencida','Gestión de cobranza sobre lo vencido',{overdueRecovery:Math.min(100,p.overdueRecovery+30)}),
  test('Vender 10% más','Crecimiento sobre el ritmo actual',{salesGrowth:p.salesGrowth+10}),
  test('Promoción en el primer mes',`${p.promoDiscount}% de descuento con +${p.promoUplift}% de volumen`,{promoMonths:[...new Set([...p.promoMonths,b.months[0]])]}),
  test('Subir margen 1 punto','Precio o mezcla de productos: +1 punto de margen bruto',{marginBoost:(p.marginBoost||0)+1}),
 ];
}
