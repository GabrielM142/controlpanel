# FASE D · Rediseño "Nueva era" de OMEGA (solo diseño)

> **Esta fase cambia únicamente cómo se ve OMEGA.** No agrega ni quita funciones, menús, reportes, filtros, opciones, datos ni lógica.
> Mockup de referencia (la fuente de verdad visual): https://claude.ai/artifact/5i9jLoF985nKLZwJsqohXK
> Pantallas: Dirección · Tema por empresa · Decisiones y tickets · Pregúntale a Omega.

## 0. Punto de partida
- En `main` ya están publicadas **F0** (`22607b5`: tokens, fuentes, `theme.css` sin hex) y **F1** (`993c511`: tema obsidiana, marca Omega, menú de 3 grupos y header nuevo), ambas con el diseño **anterior**: obsidiana, oro e Instrument Serif.
- Puede haber trabajo de F2–F4 sin commit (`src/features/omega/`, `src/styles/omega-views.css`, `App.tsx`, `TicketsView.tsx`). **Antes de empezar:** si existe ese trabajo, termínalo y haz commit, o pregúntale al dueño. Nunca lo borres.
- Esta fase **reemplaza el aspecto** de F0, F1 y lo que exista de F2–F4 por el de la nueva era. Funciona como una capa de piel: los componentes y su comportamiento quedan iguales.

## 1. Qué SÍ se cambia (solo archivos de presentación)
- `src/styles/omega-tokens.css`, `src/styles/omega-shell.css`, `src/styles/omega-views.css`, `src/theme.css` y `src/styles/legacy-palette.css`.
- Clases, `className` y estructura visual (envoltorios, orden visual) dentro de los `.tsx` de `src/`, sin cambiar props, estado, handlers, datos ni textos que vengan de los datos.
- Fuentes en `package.json` y `src/main.tsx`.
- Nuevo `src/features/theme/useBrandTheme.ts` y nueva vista visual *Configuración › Tema de la empresa* (persistencia local, ver §4).

## 2. Qué NO se toca (si hace falta tocarlo, para y pregunta)
- `server/`, `api/`, `worker/`, `lib/`, `sql/`, `contracts/`, `odoo_addons/`, `infra/`, `src/data/api.ts`, `src/data/report.json`.
- Nombres, orden y cantidad de entradas del menú, de los 13 reportes, de los filtros y de sus opciones.
- Hooks de datos (`use*.tsx` existentes) y su lógica.
- Claves de `localStorage` `nova.*` existentes.
- `tests/`, sobre todo `tests/preservation.test.mjs`. Si falla, el cambio está mal: arregla el diseño, nunca el test.

## 3. Cambios de diseño a aplicar

### 3.1 Tokens (reemplazar en `omega-tokens.css`)
```css
:root {
  --brand:#6c63ff; --on-brand:#ffffff;
  --bg:#070816; --surface:rgba(255,255,255,.045); --surface-solid:#11132a;
  --line:rgba(255,255,255,.10); --line-strong:rgba(255,255,255,.18);
  --text:#f4f4ff; --text-2:#b9bad6; --text-3:#8d8fb0;
  --fin-income:#2ee6a8; --fin-loss:#ff5a6e; --fin-loss-text:#ff8a99;
  --fin-goal:#ffc94d; --fin-cash:#38d9ff; --fin-risk:#ff9f43; --fin-risk-text:#ffb470;
  --fin-ai:#c4a1ff;
  --radius:14px; --radius-lg:22px; --radius-xl:26px;
  --font-display:"Bricolage Grotesque Variable","Bricolage Grotesque",system-ui,sans-serif;
  --font-ui:"Geist Variable",Geist,Inter,system-ui,sans-serif;
  --font-num:"Geist Mono Variable","Geist Mono",ui-monospace,monospace;
  --glow-brand:0 10px 26px color-mix(in srgb,var(--brand) 35%,transparent);
}
:root[data-mode="light"]{--bg:#f6f6fb;--surface:#ffffff;--surface-solid:#ffffff;--line:#e3e4ef;--text:#12132a;--text-2:#454766;--text-3:#6b6d8c}
```
- Mapeo desde los tokens anteriores:
  - `--omega-gold`: los usos de **marca** pasan a `--brand` y los de **meta** a `--fin-goal`;
  - `--good` → `--fin-income`, `--bad` → `--fin-loss`, `--warn` → `--fin-risk`, `--info` → `--fin-cash`, `--ai` → `--fin-ai`.
- Si quedan alias antiguos por compatibilidad, que apunten a los nuevos. No dejes hex sueltos en componentes.

### 3.2 Colores: dos capas
| Capa | Dónde | Regla |
|---|---|---|
| Financiera (fija) | KPIs, gráficas, chips, montos, estados | Ingreso = verde, costo o pérdida = rojo, meta = dorado, caja = cian, riesgo = naranja, IA = lila |
| Marca (por empresa) | Logo Ω, ítem activo del menú, botones principales, anillo del Pulso, halo del fondo, pestañas activas | Nunca pinta datos |
- Gráfica de ventas: ingresos (línea verde con área degradada) contra costos (línea roja) y presupuesto en dorado punteado.
- Chips: fondo del color al 13% y texto en el color pleno (o su variante `-text`).
- Leyenda fija "Código de color" al pie del menú lateral.

### 3.3 Tipografía
- Instalar `@fontsource-variable/bricolage-grotesque`, `@fontsource-variable/geist` y `@fontsource-variable/geist-mono` (verifica que existan y la versión).
- Retirar Instrument Serif (y Manrope si ya no se usa).
- Titulares, briefing y cifras KPI → `--font-display` 700, letter-spacing negativo.
- Interfaz → `--font-ui`. Montos en tablas, códigos y fuentes de datos → `--font-num`.

### 3.4 Superficies y fondo
- Fondo de la app: `radial-gradient(900px 520px at 12% -8%, color-mix(in srgb,var(--brand) 20%,transparent), transparent 62%), radial-gradient(700px 480px at 100% 0%, rgb(56 217 255 / .08), transparent 60%), var(--bg)`.
- Tarjetas: `var(--surface)`, borde `var(--line)`, radio `--radius-lg`. En las tarjetas KPI, una línea de 3 px arriba con el color financiero y un brillo (`box-shadow 0 0 22px`).
- Botón principal: `background: var(--brand); color: var(--on-brand); box-shadow: var(--glow-brand)`.

### 3.5 Efectos (crear `src/styles/omega-motion.css`)
| Clase | Efecto | Uso |
|---|---|---|
| `.om-spin` | rotación de 0,9 s por vuelta | Icono ↻ de recarga mientras sincroniza; spinner en botones de acción |
| `.om-skel` | shimmer de 1,1 s | KPIs, tablas y respuestas de Omega mientras cargan |
| `.om-ring` | dibuja el anillo del Pulso en 1,6 s | Pulso ISE |
| `.om-draw` | dibuja las líneas de sparklines y gráficas en 1,8 s | Gráficas |
| `.om-rise` | entrada con fade y subida de 10 px | Bloques al montar |
| `.om-card:hover` | `translateY(-3px)` más sombra | Tarjetas |
| `.om-live` | pulso de opacidad | Punto "datos sincronizados", SLA |
| `.om-d1/2/3` | 3 puntos animados | "Omega está pensando…" |
- Todo se desactiva con `@media (prefers-reduced-motion: reduce)`.
- **Recarga:** usar el mecanismo de recarga que ya existe (si existe). Mientras corre: icono con `.om-spin`, chip "Sincronizando…" y skeleton en los KPIs; al terminar, "Actualizado hace un momento". Si no existe ninguna recarga, solo agregar el estado visual sobre la carga actual, **sin** crear llamadas nuevas a la API.

### 3.6 Tema por empresa (solo frontend)
- `useBrandTheme(tenantId)`: lee `localStorage["nova.theme.<tenantId>"]` (`{brandColor, mode}`); por defecto `#6c63ff` y `dark`.
- Aplica `--brand`, `--on-brand` (blanco u oscuro según contraste WCAG ≥ 4.5) y `data-mode` en `<html>`. Se reaplica al cambiar de empresa en `TenantSwitcher`.
- Vista *Configuración › Tema de la empresa* igual al mockup:
  - 8 colores sugeridos (Índigo `#6c63ff`, Azul real `#2f7bff`, Magenta `#ff3ea5`, Grafito `#4b5170`, Esmeralda `#10b981`, Coral `#ff6b5b`, Turquesa `#14b8a6`, Violeta `#9333ea`);
  - revisión automática de **contraste** y de **choque de tono** (menos de 18° respecto a un color financiero → aviso "Se parece al color de …");
  - modo oscuro, claro o automático, botón de logo (solo visual), vista previa en vivo, Restablecer y Guardar con spinner.
- Se agrega como una entrada nueva dentro de **Configuración**. Es la única entrada de menú nueva permitida en esta fase; no se quita ni se renombra ninguna otra.

## 4. Orden de trabajo (un commit por paso, `npm test` y `npm run build` en verde en cada uno)
1. **D1 Tokens y fuentes:** §3.1 y §3.3; mapear los tokens anteriores.
2. **D2 Superficies y colores:** §3.2 y §3.4 en el shell, Dirección, Decisiones, Tickets, Pregúntale a Omega y la plantilla común de reportes (`Report.tsx`, solo estilos).
3. **D3 Efectos:** §3.5.
4. **D4 Tema por empresa:** §3.6.
5. **D5 Revisión visual:** comparar cada pantalla con el mockup, en escritorio y con un ancho de 375 px.

## 5. Criterios de aceptación
- [ ] `npm test` en verde, incluido `preservation.test.mjs`: los 13 reportes, filtros y opciones están intactos.
- [ ] `npm run build` en verde.
- [ ] El menú tiene las mismas entradas que antes, más "Tema de la empresa".
- [ ] No quedan hex sueltos fuera de `omega-tokens.css`.
- [ ] Ingresos siempre en verde y pérdidas siempre en rojo, en todas las empresas.
- [ ] Al cambiar de empresa cambia el color de marca; los colores financieros no cambian.
- [ ] Contraste AA en textos y botones.
- [ ] Con `prefers-reduced-motion` no hay animaciones.
- [ ] El diff no toca nada de la lista §2.

## 6. Publicación
- Se trabaja en `main`. **Commit por paso, pero `git push` solo cuando el dueño apruebe** (cada push publica en Vercel).
- Para revertir algo publicado: `git revert <commit>` y luego `git push`.
