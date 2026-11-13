// Cash flow: real cash by month (cash accounts of the trial balance), what is already committed
// (receivables by due date, supplier payables, pending purchase receipts) and the run-rate or
// budget of sales, purchases and expenses. The projection and the scenarios run on top of this
// base in the panel, so every lever (sales, promotions, investments, collection days) is explicit.

const num = v => (v === null || v === undefined ? null : Number(v));
const ym = d => d.slice(0, 7);
const addMonths = (month, n) => {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`;
};

export async function cashflowBase(c, cutoff, companies = null, horizon = 6) {
  const p = [cutoff];
  const sc = a => companies ? `AND (${a}.source_id::text || ':' || ${a}.company_id) = ANY($2::text[])` : '';
  if (companies) p.push(companies);
  const q = async sql => (await c.query(sql, p)).rows;

  // 1. Real: cash in and out per month and the closing balance (cumulative since the first entry).
  const hist = (await q(`SELECT to_char(f.month, 'YYYY-MM') AS month, sum(f.debit)::text AS inflow, sum(f.credit)::text AS outflow
      FROM core.fact_account_month f WHERE f.account_type = 'asset_cash' AND f.month <= $1::date ${sc('f')} GROUP BY 1 ORDER BY 1`))
    .map(r => ({month: r.month, inflow: num(r.inflow), outflow: num(r.outflow)}));
  let balance = 0;
  const history = hist.map(h => { balance += h.inflow - h.outflow; return {...h, net: h.inflow - h.outflow, balance}; });
  const hasLedger = history.length > 0;

  // 2. Committed: receivables by due month (overdue apart), supplier payables, pending receipts.
  const recv = await q(`SELECT CASE WHEN coalesce(r.date_maturity, r.doc_date) < $1::date THEN 'overdue'
          ELSE to_char(coalesce(r.date_maturity, r.doc_date), 'YYYY-MM') END AS bucket, sum(r.residual)::text AS amount
      FROM core.fact_receivable_item r WHERE r.residual > 0 ${sc('r')} GROUP BY 1`);
  const overdue = num(recv.find(r => r.bucket === 'overdue')?.amount) || 0;
  const dueByMonth = Object.fromEntries(recv.filter(r => r.bucket !== 'overdue').map(r => [r.bucket, num(r.amount)]));
  const payables = -(num((await q(`SELECT coalesce(sum(f.balance), 0)::text AS v FROM core.fact_account_month f
      WHERE f.account_type = 'liability_payable' AND f.month <= $1::date ${sc('f')}`))[0].v) || 0);
  const pendingReceipts = num((await q(`SELECT coalesce(sum(CASE WHEN pl.qty > pl.qty_received THEN (pl.qty - pl.qty_received) * pl.amount / nullif(pl.qty, 0) END), 0)::text AS v
      FROM core.fact_purchase_line pl WHERE coalesce(pl.receipt_status, '') <> 'full' AND pl.approve_date <= $1::date ${sc('pl')}`))[0].v) || 0;

  // 3. Run-rate: average of the last 3 complete months (the month of the close is incomplete).
  const lastFull = addMonths(ym(cutoff), -1);
  const from3 = `${addMonths(lastFull, -2)}-01`;
  const p3 = [from3, `${lastFull}-01`];
  const sc3 = a => companies ? `AND (${a}.source_id::text || ':' || ${a}.company_id) = ANY($3::text[])` : '';
  if (companies) p3.push(companies);
  const avg = async sql => (num((await c.query(sql, p3)).rows[0].v) || 0) / 3;
  const salesAvg = await avg(`SELECT coalesce(sum(s.net_amount), 0)::text AS v FROM core.fact_sales_line s
      WHERE s.business_date >= $1::date AND s.business_date < ($2::date + interval '1 month') ${sc3('s')}`);
  const purchasesAvg = await avg(`SELECT coalesce(sum(pl.amount), 0)::text AS v FROM core.fact_purchase_line pl
      WHERE pl.approve_date >= $1::date AND pl.approve_date < ($2::date + interval '1 month') ${sc3('pl')}`);
  const expensesAvg = await avg(`SELECT coalesce(sum(f.balance), 0)::text AS v FROM core.fact_account_month f
      WHERE f.month BETWEEN $1::date AND $2::date AND (f.code LIKE '601%' OR f.code LIKE '602%' OR f.code LIKE '603%' OR f.code LIKE '604%'
             OR f.code LIKE '7%' OR (f.code LIKE '5%' AND f.code NOT LIKE '50101%')) ${sc3('f')}`);
  // Expenses = selling, administrative, financial and other expenses plus the labor and overhead
  // booked in cost (5xx outside 50101, the cost of the goods sold, which purchases already cover).
  const cost = (await c.query(`SELECT coalesce(sum(s.cost_amount), 0)::text AS cost,
        coalesce(sum(s.net_amount) FILTER (WHERE s.cost_amount IS NOT NULL), 0)::text AS known FROM core.fact_sales_line s
      WHERE s.business_date >= $1::date AND s.business_date < ($2::date + interval '1 month') ${sc3('s')}`, p3)).rows[0];
  const marginPct = num(cost.known) ? (num(cost.known) - num(cost.cost)) / num(cost.known) * 100 : null;

  // Collection and payment days (12 months), same definitions as Financiero.
  const sales12 = num((await q(`SELECT coalesce(sum(s.net_amount), 0)::text AS v FROM core.fact_sales_line s
      WHERE s.business_date > $1::date - 365 AND s.business_date <= $1::date ${sc('s')}`))[0].v) || 0;
  const buys12 = num((await q(`SELECT coalesce(sum(pl.amount), 0)::text AS v FROM core.fact_purchase_line pl
      WHERE pl.approve_date > $1::date - 365 AND pl.approve_date <= $1::date ${sc('pl')}`))[0].v) || 0;
  const receivable = overdue + Object.values(dueByMonth).reduce((s, v) => s + v, 0);
  const daysCollect = sales12 ? receivable / sales12 * 365 : null;
  const daysPay = buys12 && payables > 0 ? payables / buys12 * 365 : null;
  // Days of the current (not overdue) portfolio at today's sales pace: how long a new sale takes to
  // be collected. The overdue balance is a separate bucket with its own recovery assumption.
  const current = receivable - overdue;
  const daysCollectCurrent = salesAvg > 0 ? current / (salesAvg * 1.15 / 30) : null;
  // What really came in and went out of the cash accounts in the last 3 complete months.
  const lastReal = history.filter(h => h.month <= lastFull).slice(-3);
  const cashIn = lastReal.length ? lastReal.reduce((s, h) => s + h.inflow, 0) / lastReal.length : null;
  const cashOut = lastReal.length ? lastReal.reduce((s, h) => s + h.outflow, 0) / lastReal.length : null;

  // 4. Budget of the projected months, when the company loaded one.
  const months = Array.from({length: horizon}, (_, i) => addMonths(ym(cutoff), i + 1));
  const bud = (await c.query(`SELECT kind, to_char(month, 'YYYY-MM') AS month, sum(amount)::text AS amount FROM app.budgets
      WHERE unit_name IS NULL AND brand IS NULL AND to_char(month, 'YYYY-MM') = ANY($1::text[]) GROUP BY 1, 2`, [months])).rows;
  const budget = {};
  for (const b of bud) (budget[b.kind] ??= {})[b.month] = num(b.amount);

  return {
    cutoff, months, hasLedger, history,
    opening: hasLedger ? balance : null,
    committed: {overdue, dueByMonth, payables, pendingReceipts},
    runRate: {sales: salesAvg, purchases: purchasesAvg, expenses: expensesAvg, basis: `${ym(from3)} a ${lastFull}`},
    marginPct, daysCollect, daysCollectCurrent, daysPay, cashIn, cashOut, budget,
    notes: [
      hasLedger ? 'Caja real: movimientos de las cuentas de efectivo y bancos de la contabilidad publicada.' : 'Sin balance de comprobación publicado: no hay caja real.',
      'El saldo parte del primer mes contable publicado: si falta el asiento de apertura, súmalo como saldo inicial.',
    ],
  };
}
