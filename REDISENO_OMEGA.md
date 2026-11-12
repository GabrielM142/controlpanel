# OMEGA — Plan de rediseño del panel gerencial

Repo: `GabrielM142/controlpanel` · se trabaja directo en `main` (cada push publica en Vercel) · Mockup aprobado: https://claude.ai/artifact/5i9jLoF985nKLZwJsqohXK
Alcance: **solo diseño del frontend (`src/`)**. Backend, worker, contratos y addons no cambian (ver `CLAUDE.md`).

> **Regla de oro:** cambia cómo se ve, no lo que hay. Todos los menús, reportes, filtros y opciones actuales se conservan. Lo que este plan llama "reagrupar" es mover entradas de lugar en el menú, nunca quitarlas.

---

## 1. Por qué OMEGA
Omega (Ω) es la última letra del alfabeto griego: **lo último que revisa un gerente antes de decidir**. El panel deja de ser "un lugar con muchos reportes" y pasa a ser **la última palabra**: te dice qué pasa, por qué pasa y qué decidir.

Tres promesas que guían cada pantalla:
1. **Entiendes en 5 segundos.** Cada vista abre con una frase que la resume y una pregunta gerencial.
2. **Decides en un clic.** Lo que requiere tu firma aparece con la recomendación de Omega y los botones Aprobar o Rechazar.
3. **Preguntas como hablas.** "Pregúntale a Omega" está siempre a mano (Ctrl K) y cita sus fuentes.

## 2. Diagnóstico de la interfaz actual
| # | Hoy | Problema | OMEGA |
|---|---|---|---|
| 1 | Marca "Nova Business / JUJ" con dorado y azul marino | Muchas tarjetas con el mismo peso | Jerarquía: briefing, Pulso, 4 KPIs, decisiones |
| 2 | `theme.css` minificado de unos 128 KB con hex sueltos | No escala y no permite cambiar el tema | Tokens en `omega-tokens.css`; `theme.css` solo consume `var(--…)` |
| 3 | Menú con super-grupos y más de 25 entradas | Cuesta encontrar lo importante | 3 grupos: Ejecutivo, Unidades y Gestión, más Pregúntale a Omega |
| 4 | Tour emergente al entrar | Interrumpe | Tour solo a pedido (botón "Repetir tour") |
| 5 | IA en un cajón lateral (`AIDrawer`) | Se siente secundaria | Vista propia, más acceso desde el header y desde cada tarjeta |
| 6 | KPIs sin lectura | El gerente tiene que interpretarlos | Cada cifra trae comparación más una frase |
| 7 | Tickets y umbrales separados | Las decisiones quedan dispersas | Bandeja única "Lo que espera tu decisión" |

## 3. Psicología del color

| Token | Hex | Qué comunica | Uso exclusivo |
|---|---|---|---|
| `--bg` obsidiana | `#0a0b10` | Seriedad, foco | Fondo general |
| `--surface` | `#111319` | Profundidad | Tarjetas |
| `--omega-gold` | `#d9b46c` | Prestigio, prioridad | Logo Ω, CTA "Presentar al directorio", anillo del Pulso, foco |
| `--good` esmeralda | `#3ecf8e` | Avanza, a favor | Aprobar, variaciones positivas |
| `--bad` bermellón | `#ff7a59` | Pérdida, urgencia | Utilidad negativa, urgente, SLA vencido |
| `--warn` ámbar | `#f2c14e` | Revisar | Riesgo medio, descuentos |
| `--info` zafiro | `#6ea8ff` | Dato neutro y confiable | Series de gráficas, áreas |
| `--ai` amatista | `#b49cff` | Inteligencia | Todo lo de Omega IA |

Reglas:
- El **oro es escaso**: como máximo un CTA dorado por pantalla. Si todo brilla, nada es importante.
- El bermellón solo marca pérdidas reales o vencimientos; no se usa como decoración.
- Lo que dice la IA siempre va en amatista con la Ω: el gerente sabe qué es dato y qué es recomendación.

### Tokens (`src/styles/omega-tokens.css`)
```css
:root {
  --bg:#0a0b10; --bg-2:#0d0e14; --surface:#111319; --surface-2:#171a22;
  --line:#1e2129; --line-2:#23262f; --line-3:#2e323d;
  --text:#f1efe9; --text-2:#b4b3bb; --text-3:#8c8e9b; --text-4:#6f7280;
  --omega-gold:#d9b46c; --gold-text:#e8c98a; --gold-soft:#2a2418; --gold-line:#5c4b2a; --on-gold:#15110a;
  --good:#3ecf8e; --good-text:#6ee3ad; --good-soft:#11261d; --on-good:#06170f;
  --bad:#ff7a59;  --bad-text:#ff9d84;  --bad-soft:#2b1712;
  --warn:#f2c14e; --warn-text:#f5d27c; --warn-soft:#2a2312;
  --info:#6ea8ff; --info-text:#9cc2ff; --info-soft:#121d30; --info-muted:#2b4a7d;
  --ai:#b49cff;   --ai-text:#cbbaff;   --ai-soft:#1e1830;   --ai-line:#3a3150;
  --radius-sm:10px; --radius:14px; --radius-lg:20px; --radius-xl:24px;
  --font-ui:"Geist Variable", Geist, Inter, system-ui, sans-serif;
  --font-display:"Instrument Serif", Georgia, serif;
}
/* Impresión y PDF para el directorio: fondo claro */
@media print { :root { --bg:#ffffff; --surface:#ffffff; --text:#0a0b10; --text-2:#3a3d47; --line:#e3e5ea; } }
```
Fuentes: añadir `@fontsource-variable/geist` y `@fontsource/instrument-serif`, verificando antes que existan y sean compatibles. Se puede retirar Manrope cuando ya no se use.

## 4. Arquitectura de información
**Ejecutivo:** Dirección · Ventas · Compras · Finanzas y riesgo
**Unidades:** Mayorista · Retail (y las que existan por empresa)
**Gestión:** Decisiones (badge dorado) · Tickets de soporte (badge bermellón) · Tareas y notas
**Pregúntale a Omega** (vista propia)
**Configuración** (abajo): Fuentes de datos · Umbrales · Mercado/Catálogo · Empresas

- Mantener todas las vistas y rutas actuales; solo se reagrupa el menú. Conservar la clave `nova.nav` del estado expandido.
- Header fijo: breadcrumb · chip de frescura "Cierre 11 nov · sincronizado 03:00" · barra "Pregúntale a Omega" (Ctrl K, reutilizar `CommandPalette`) · notificaciones (`AlertsDrawer`) · botón oro "Presentar al directorio" (modo presentación existente).
- Selector de empresa (`TenantSwitcher`) arriba del menú, con nombre legible.

## 5. Pantallas
1. **Dirección:**
   - **Briefing**: titular en serif de 1 frase, más 1 párrafo y 2 CTAs.
   - **Pulso OMEGA**: anillo con el ISE /100 y su variación.
   - 4 KPIs grandes (ventas, utilidad, margen, caja), cada uno con chip de comparación, sparkline y nota.
   - Gráfica real vs presupuesto vs año anterior, con el mes récord resaltado.
   - **Tu firma**: decisiones con la sugerencia de Omega y Aprobar/Rechazar.
   - Unidades de negocio con barra de Pulso.
   - "Lo que podría salir mal" (riesgos).
2. **Decisiones y tickets:** título "Lo que espera tu decisión"; KPIs (abiertos, SLA en riesgo, solución promedio, dinero en juego); pestañas; filas con prioridad, barra de SLA y monto; detalle con "Omega recomienda" y una acción de un clic más Reasignar o Escalar. Reutilizar `TicketsView` y `useThresholds`.
3. **Pregúntale a Omega:** evolución de `AIDrawer` a vista completa. Historial y consultas guardadas; cada respuesta lleva conclusión en serif, 3 cifras, porqué numerado, **Decisión sugerida** (botón "Llevar a decisiones") y **fuentes** (datasets). Indicar que es de solo lectura y la fecha de los datos. Respetar `useTokens` (consumo de tokens) ya existente.
4. **Reportes (los 13):** misma plantilla en `components/Report.tsx`: pregunta gerencial, lectura de Omega, KPIs, gráfica principal, tabla y exportar.
5. **Login:** obsidiana con la Ω dorada, "La última palabra en tus datos", formulario sobrio.

### Patrones UX
- Una idea por tarjeta; etiquetas en versalitas pequeñas (11 px, `letter-spacing: 2px`) y cifras en serif.
- Drawer lateral para el detalle; Dialog para confirmar decisiones de más de $10 k, con el monto visible.
- Estados vacíos con acción ("Todo firmado. Omega te avisará si algo cambia.").
- Toast con "Deshacer" tras aprobar o rechazar.
- Atajos: Ctrl K preguntar o buscar · `D` decisiones · `P` presentar · `?` ayuda.

## 6. Fases (un commit en `main` por fase, con `npm test` en verde)
| Fase | Alcance | Cierre |
|---|---|---|
| **F0 · Tokens** | `omega-tokens.css`, fuentes, reemplazar hex de `theme.css` por variables (des-minificar por secciones) | `npm test` y `npm run build` en verde; aspecto aún equivalente |
| **F1 · Shell y marca** | Logo Ω, OMEGA, menú en 3 grupos, header con chip de frescura y Ctrl K, tour solo a pedido | Todas las vistas accesibles; claves `nova.*` intactas |
| **F2 · Dirección** | Briefing, Pulso, KPIs, gráfica, Tu firma, unidades, riesgos | Usa los datos actuales de `report.json` y la API, sin cambiar su forma |
| **F3 · Decisiones y tickets** | Bandeja única con recomendación y acción | Flujo aprobar, rechazar y escalar con confirmación |
| **F4 · Pregúntale a Omega** | Vista completa, fuentes, guardar consulta | Siempre cita las fuentes; solo lectura |
| **F5 · Reportes** | Plantilla común para los 13 reportes, modo presentación e impresión | Lighthouse de accesibilidad ≥ 95 |
| **F6 · Pulido** | Responsive, microinteracciones y estados vacíos | Revisión en móvil y tablet |
