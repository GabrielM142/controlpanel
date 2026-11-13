# Métricas v1 (estado: propuesta, pendiente de aprobación la empresa)

Catálogo ejecutable: `lib/metrics.mjs` (`GET /api/metrics`, MCP `get_metric_definition`).

| Métrica | Fórmula | Reglas |
|---|---|---|
| `sales_net` | Σ −balance de líneas `product` de `out_invoice`/`out_refund` publicadas + Σ `price_subtotal` POS pagado/hecho **sin** factura | NC restan; POS facturado solo vía factura; moneda compañía; fecha = `invoice_date` (POS: `date_order` en zona del tenant) |
| `gross_profit` | Σ venta con costo conocido − Σ costo | Costo = COGS anglosajón (`expense_direct_cost`) prorrateado por cantidad, o `total_cost` POS. Sin costo ⇒ excluido y se informa cobertura |
| `gross_margin_pct` | utilidad / venta con costo conocido | Numerador y denominador sumados; nunca promedio de % |
| `customers_invoiced` | COUNT DISTINCT socio comercial | Desde hechos, no suma de conteos |
| `ticket_avg` | venta / COUNT DISTINCT documentos | Mismo universo que la venta |
| `orders_pending_invoice`, `backorder_value` | (pedido − facturado/entregado) × precio neto unitario | Pedido ≠ venta |
| `inventory_value`, `sku_active` | Σ valor de capas de valoración al corte; productos con existencia interna > 0 | Saldo al corte: no se suma entre fechas |
| `receivable_open` + aging | Σ residual de apuntes por cobrar publicados; tramos por días desde vencimiento al corte | Saldo "capturado en el intervalo del lote", no exacto a 00:00. Aging se recalcula cada día aunque no haya cambios |

Pendientes que bloquean bloques: presupuesto/metas, ISE (rangos, pesos, faltantes), mapeo contable
(EBITDA, gastos, liquidez, ROE/ROA, punto de equilibrio), OTIF, atribución de marketing, reglas de
hallazgos/alertas por tenant. Ver `docs/BLOCKS_MATRIX.md`.
