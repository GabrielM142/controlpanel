# Omega en cada reporte (IA contextual)

Cada uno de los 13 reportes trae el bloque **"Omega en este reporte"**, debajo de la lectura de Omega. El chat lateral (burbuja Ω) usa el mismo contexto cuando estás en un reporte.

## Qué lee Omega
`src/features/omega/reportAI.ts › buildReportContext()` arma el contexto con lo mismo que ves en pantalla:

| Parte | Demo (sin `VITE_NOVA_API_URL`) | En vivo |
|---|---|---|
| KPIs y métricas, con su comparación | `report.json` | widgets `kpi` y `metric` de `/api/reports/:id` |
| Series (barras, toggles, geografía) | `report.json` | widgets `bars`, `toggle` y `geo` |
| Tablas y matriz | `report.json` | widgets `table` |
| Hallazgos (listas) | `report.json` | aún no los entrega la API |
| Pendientes | — | widgets `missing` con su motivo |
| Filtros | los que se ven en pantalla, con su valor | los mismos (solo los que la API aplica) |
| Corte | "Datos de demostración" | `Cierre <business_date> · versión <n>` |

Los dos modos nunca se mezclan. En vivo, un bloque sin dato queda como pendiente y no entra en la lectura.

## Cómo responde
- **Intérprete local** (`interpretReport`). Es determinista y lee solo el contexto: titular, hasta 6 puntos (cada uno cita su bloque), decisión sugerida y notas de honestidad (modo demo, pendientes, filtros aplicados). Reconoce:
  - las preguntas de qué está peor o qué está mejor;
  - la comparación contra el año anterior o el presupuesto;
  - la concentración en pocos elementos;
  - qué decidir;
  - y las menciones directas de un KPI o de una fila (unidad, marca, provincia, cliente…).
- **Cambio de filtros**. Si cambias un filtro después de preguntar, Omega avisa y ofrece "Volver a interpretar". En vivo, esa nueva lectura usa los widgets recalculados por la API.
- **Consumo**. Cada pregunta descuenta 7 tokens del plan, igual que "Pregúntale a Omega".

## Gancho para el modelo de lenguaje (pendiente de backend)
Se activa con `VITE_NOVA_AI=1`, y solo en modo en vivo. El frontend llama a:

```
POST /api/ai/report
Headers: X-Nova-Tenant, X-Nova-Request: 1 (sesión por cookie)
Body: { page_id, question, filters: {clave: valor}, cut, context: "<resumen en texto de la pantalla>" }
200:  { headline, points?: [{text, tone?: "g"|"a"|"r", source?}], suggestion?, sources?: [] }
```

Reglas para quien lo implemente:
- Responde solo desde `context` o desde los marts del tenant de la sesión. Nunca consulta Odoo en vivo.
- Cita las fuentes por bloque, por ejemplo `Bloque comercial-11`.
- Si falla o no existe, el frontend usa el intérprete local y lo avisa.
