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

## 3. Color, tipografía y efectos (versión "nueva era")

### 3.1 Dos capas de color
1. **Colores financieros FIJOS**: iguales para todas las empresas. Verde siempre es ingreso y rojo siempre es pérdida, para que ningún gerente lea mal un número.
2. **Color de marca POR EMPRESA**: lo elige cada empresa en *Configuración › Tema de la empresa*. Solo pinta el "envase": logo, menú activo, botones principales, anillo del Pulso y halo del fondo. Nunca pinta datos.

### 3.2 Psicología del color financiero (fijo)
| Token | Hex | Significado | Uso |
|---|---|---|---|
| `--fin-income` | `#2ee6a8` | Dinero que entra, crecimiento | Ingresos, variaciones a favor, Aprobar |
| `--fin-loss` | `#ff5a6e` (texto `#ff8a99`) | Dinero que sale, pérdida | Costos, utilidad negativa, urgente |
| `--fin-goal` | `#ffc94d` | Meta, logro | Presupuesto, % de meta, badge de decisiones |
| `--fin-cash` | `#38d9ff` | Flujo, disponibilidad | Caja, liquidez, información neutra |
| `--fin-risk` | `#ff9f43` (texto `#ffb470`) | Atención | Riesgo medio, SLA por vencer |
| `--fin-ai` | `#c4a1ff` | Inteligencia | Todo lo que dice Omega (siempre con la Ω) |

Reglas:
- Una gráfica de ingresos contra costos siempre es verde contra rojo, y el presupuesto siempre va en dorado punteado.
- Los chips de estado usan el color al 13% de opacidad de fondo y el color pleno como texto.
- La barra lateral muestra una leyenda fija, "Código de color", para que nadie tenga que adivinar.

### 3.3 Tema por empresa (parametrizable)
- Guardar en la configuración de cada empresa (tenant): `brandColor`, `logoUrl` y `mode` (`dark` | `light` | `auto`). Se aplica en el arranque como `--brand` y `--on-brand` sobre `:root`.
- `--on-brand` se calcula solo: texto blanco u oscuro según el contraste WCAG (como mínimo 4.5:1).
- **Validación al guardar**:
  - si el contraste no llega a AA, la marca se usa solo en bordes y fondos suaves;
  - si el tono está a menos de 18° de un color financiero (por ejemplo una marca verde o roja), se avisa: *"Se parece al color de Ingresos"*.
- Vista previa en vivo antes de guardar y botón Restablecer.
- Hasta que exista el campo en la API, el tema se guarda en `localStorage` con la clave `nova.theme.<tenantId>`, siguiendo el prefijo `nova.*`. **No cambiar el backend sin aprobación.**
- Ejemplos del mockup: Grupo JUJ Índigo `#6c63ff`, Distribuidora Andes Azul real `#2f7bff`, Ferremax Magenta `#ff3ea5`.

### 3.4 Tokens (`src/styles/omega-tokens.css`)
```css
:root {
  --brand:#6c63ff; --on-brand:#ffffff;           /* los sobrescribe el tema de la empresa */
  --bg:#070816; --surface:rgba(255,255,255,.045); --surface-solid:#11132a;
  --line:rgba(255,255,255,.10); --line-strong:rgba(255,255,255,.18);
  --text:#f4f4ff; --text-2:#b9bad6; --text-3:#8d8fb0;
  --fin-income:#2ee6a8; --fin-loss:#ff5a6e; --fin-loss-text:#ff8a99;
  --fin-goal:#ffc94d;   --fin-cash:#38d9ff; --fin-risk:#ff9f43; --fin-risk-text:#ffb470;
  --fin-ai:#c4a1ff;
  --radius:14px; --radius-lg:22px; --radius-xl:26px;
  --font-display:"Bricolage Grotesque", system-ui, sans-serif;
  --font-ui:"Geist", Inter, system-ui, sans-serif;
  --font-num:"Geist Mono", ui-monospace, monospace;
  --glow-brand:0 10px 26px color-mix(in srgb, var(--brand) 35%, transparent);
}
:root[data-mode="light"] { --bg:#f6f6fb; --surface:#ffffff; --line:#e3e4ef; --text:#12132a; --text-2:#454766; --text-3:#6b6d8c; }
@media print { :root { --bg:#ffffff; --surface:#ffffff; --text:#12132a; } }
```
- Fondo: halo suave del color de marca arriba a la izquierda y otro cian a la derecha (`radial-gradient`) sobre `--bg`.
- Tarjetas tipo cristal: `--surface` con borde `--line` y, en las tarjetas KPI, una línea de 3 px arriba con brillo del color financiero.

### 3.5 Tipografía
- **Bricolage Grotesque** (700–800): titulares, briefing y cifras grandes, con mucho carácter y aire 2026.
- **Geist**: interfaz y textos.
- **Geist Mono**: montos en tablas, códigos y fuentes de datos (alineación perfecta).
- Instalar con `@fontsource-variable/bricolage-grotesque`, `@fontsource-variable/geist` y `@fontsource-variable/geist-mono`, verificando antes que existan.

### 3.6 Efectos y estados de carga
| Efecto | Dónde | Detalle |
|---|---|---|
| **Recarga con giro** | Chip "Cierre 11 nov · 03:00" con botón ↻ | Al pulsarlo, el icono gira (0,9 s por vuelta), el chip dice "Sincronizando…" y los KPIs muestran skeleton con brillo; al terminar dice "Actualizado hace un momento" |
| Skeleton con shimmer | KPIs, tablas y respuestas de Omega | En lugar de pantallas en blanco |
| Anillo animado | Pulso | Se dibuja al entrar (1,6 s, ease-out) |
| Líneas que se dibujan | Sparklines y gráficas | `stroke-dashoffset` al montar |
| Elevación al pasar el cursor | Tarjetas | `translateY(-3px)` más una sombra |
| "Omega está pensando" | Chat IA | Spinner, 3 puntos y "cruzando 48.210 registros de 3 fuentes" |
| Botón con spinner | Aprobar y Guardar tema | Evita el doble clic y confirma la acción |
| Punto vivo | Datos sincronizados y SLA | Pulso de opacidad |
- Duración de 150–250 ms en interacciones y hasta 1,8 s en animaciones de entrada. Todo se desactiva con `prefers-reduced-motion`.
- **Importante:** la recarga no consulta Odoo en vivo. Vuelve a pedir a la API NOVA la última publicación del lote nocturno.

## 4. Arquitectura de información
**Ejecutivo:** Dirección · Ventas · Compras · Finanzas y riesgo
**Unidades:** Mayorista · Retail (y las que existan por empresa)
**Gestión:** Decisiones (badge dorado de meta) · Tickets de soporte (badge rojo de pérdida) · Tareas y notas
**Pregúntale a Omega** (vista propia)
**Configuración** (abajo): Fuentes de datos · Umbrales · Mercado/Catálogo · Empresas · **Tema de la empresa**

- Mantener todas las vistas y rutas actuales; solo se reagrupa el menú. Conservar la clave `nova.nav` del estado expandido.
- Header fijo: breadcrumb · chip de frescura "Cierre 11 nov · sincronizado 03:00" · barra "Pregúntale a Omega" (Ctrl K, reutilizar `CommandPalette`) · notificaciones (`AlertsDrawer`) · botón "Presentar" en color de marca (modo presentación existente).
- Selector de empresa (`TenantSwitcher`) arriba del menú, con nombre legible.

## 5. Pantallas
1. **Dirección:**
   - **Briefing**: titular en Bricolage de 1 frase, más 1 párrafo y 2 CTAs.
   - **Pulso OMEGA**: anillo con el ISE /100 y su variación.
   - 4 KPIs grandes (ventas, utilidad, margen, caja), cada uno con chip de comparación, sparkline y nota.
   - Gráfica real vs presupuesto vs año anterior, con el mes récord resaltado.
   - **Tu firma**: decisiones con la sugerencia de Omega y Aprobar/Rechazar.
   - Unidades de negocio con barra de Pulso.
   - "Lo que podría salir mal" (riesgos).
2. **Decisiones y tickets:** título "Lo que espera tu decisión"; KPIs (abiertos, SLA en riesgo, solución promedio, dinero en juego); pestañas; filas con prioridad, barra de SLA y monto; detalle con "Omega recomienda" y una acción de un clic más Reasignar o Escalar. Reutilizar `TicketsView` y `useThresholds`.
3. **Pregúntale a Omega:** evolución de `AIDrawer` a vista completa. Historial y consultas guardadas; cada respuesta lleva conclusión en titular grande, 3 cifras, porqué numerado, **Decisión sugerida** (botón "Llevar a decisiones") y **fuentes** (datasets). Indicar que es de solo lectura y la fecha de los datos. Respetar `useTokens` (consumo de tokens) ya existente.
4. **Reportes (los 13):** misma plantilla en `components/Report.tsx`: pregunta gerencial, lectura de Omega, KPIs, gráfica principal, tabla y exportar.
5. **Tema de la empresa:** lista de empresas del grupo, 8 colores sugeridos, revisión automática (contraste y choque con colores financieros), modo oscuro/claro/automático, logo y vista previa en vivo.
6. **Login:** fondo oscuro con halo del color de la empresa y la Ω, "La última palabra en tus datos", formulario sobrio.

### Patrones UX
- Una idea por tarjeta; etiquetas en versalitas pequeñas (11 px, `letter-spacing: 2px`) y cifras en Bricolage (montos de tablas en Geist Mono).
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
