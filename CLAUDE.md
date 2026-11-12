# CLAUDE.md — OMEGA (panel gerencial)

OMEGA es el panel gerencial multiempresa: reportes de ventas, compras, finanzas y riesgo, unidades de negocio, tickets de soporte, decisiones y un chat con IA sobre toda la data ("Pregúntale a Omega").
Lema: **"La última palabra en tus datos."** Omega es la última letra griega: lo último que revisa un gerente antes de decidir.

Stack: React 19 + TypeScript + Vite · lucide-react · API Node (`server/`, `api/`) · worker NOVA + PostgreSQL · addons Odoo 16. Node ≥ 22.12.
Los datos son **diferidos al cierre anterior** (lote nocturno desde las 03:00). OMEGA nunca consulta Odoo al abrir una vista y la interfaz siempre debe mostrarlo.

> Este repo NO es Trueque WPP. Si ves instrucciones de Angular, Firebase o `ux/rediseno-2026`, no aplican aquí.

## Antes de actuar, lee
1. `REDISENO_OMEGA.md`: identidad, psicología del color, tokens, pantallas y fases F0–F6.
2. `docs/STATUS.md` y `docs/ARCHITECTURE.md`: estado real y arquitectura.
3. Mockup aprobado: https://claude.ai/artifact/5i9jLoF985nKLZwJsqohXK

## Reglas que no se rompen
- Se trabaja **directo en `main`**: es un demo publicado y el dueño lo decidió así. Cada push a `main` publica en Vercel, por eso **no hagas push sin aprobación** y nunca hagas force-push.
- **Solo cambia el diseño.** Se conservan todos los menús, reportes, filtros, opciones, textos de datos y su orden. Nada se elimina ni se fusiona; si una vista se reubica en el menú, sigue existiendo con el mismo nombre de reporte.
- `tests/preservation.test.mjs` verifica que los 13 reportes conserven contenido, orden y valores, y que se mantengan todos los filtros. **Si falla, el cambio está mal: corrígelo y nunca edites ese test.**
- **El rediseño es solo de frontend (`src/`).** No tocar `server/`, `api/`, `worker/`, `lib/`, `sql/`, `contracts/`, `odoo_addons/`, `infra/` ni `src/data/api.ts` sin aprobación explícita (problema, solución, archivos, riesgo y reversión).
- No cambiar la forma de los datos (`src/data/report.json`, contratos `nova.export.v1`, respuestas de la API).
- El cambio de marca es **visual**: OMEGA reemplaza "Nova Business" en textos y logo. Los nombres técnicos internos (`NOVA`, `nova_connector`, variables `VITE_NOVA_*`) y las claves de `localStorage` `nova.*` se mantienen para no perder las preferencias de los usuarios.
- Conservar el modo demo (sin `VITE_NOVA_API_URL`) y todas las vistas actuales: los 13 reportes y las 12 vistas auxiliares.
- Una fase = un commit en `main`. Al terminar cada fase: `npm test` y `npm run build` en verde, resumen del diff y esperar aprobación antes del commit y del push.

## Sistema de diseño OMEGA (obligatorio)
- Tokens únicos en `src/styles/omega-tokens.css` (variables CSS). **Prohibido** escribir hex sueltos en componentes o en `theme.css`: siempre `var(--…)`.
- Estilo "nueva era": fondo oscuro profundo `#070816` con halo del color de la empresa, tarjetas de cristal y brillos sutiles. Detalle completo en `REDISENO_OMEGA.md` §3.
- **Dos capas de color:**
  1. **Financieros fijos**, iguales en todas las empresas: `--fin-income` verde (ingresos, a favor), `--fin-loss` rojo (costos, pérdidas, urgente), `--fin-goal` dorado (meta, presupuesto), `--fin-cash` cian (caja, liquidez), `--fin-risk` naranja (riesgo, por vencer), `--fin-ai` lila (Omega IA).
  2. **Marca por empresa**: `--brand` y `--on-brand`, que salen del tema de cada empresa. Solo pintan logo, menú activo, botones principales, anillo del Pulso y halo. **Nunca pintan datos.**
- `--on-brand` se calcula por contraste WCAG (≥ 4.5:1). Si el color de marca está a menos de 18° de tono de un color financiero, se avisa y no se acepta sin confirmar.
- Tipografía: **Bricolage Grotesque** para titulares y cifras grandes, **Geist** para la interfaz y **Geist Mono** para montos, códigos y fuentes.
- Efectos obligatorios: recarga con icono que gira y skeleton con shimmer mientras sincroniza, anillo y líneas que se dibujan al entrar, elevación al pasar el cursor y spinner en los botones que ejecutan acciones. Todo se apaga con `prefers-reduced-motion`.
- Iconos: `lucide-react` (ya instalado), con trazo de 1.8. La Ω es el logotipo y el símbolo de la IA. Sin emojis.
- Cada número importante lleva comparación (vs presupuesto o vs año anterior) y una lectura en una frase.
- Cada vista responde una pregunta gerencial en su encabezado ("¿Dónde estoy perdiendo margen?").
- Copy en español, tuteo, directo y ejecutivo: "Tu firma", "Lo que podría salir mal", "Decisión sugerida".

## Accesibilidad y calidad
- Contraste AA sobre el fondo oscuro: texto secundario como mínimo `--text-3` (#8d8fb0 sobre #070816).
- La recarga nunca consulta Odoo en vivo: vuelve a pedir a la API NOVA la última publicación.
- Colores que se deben distinguir (bien/mal) también difieren en claridad, no solo en tono.
- Elementos reales (`button`, `a`, `label` + `input`), `aria-label` en botones de solo icono y foco visible con anillo del color de marca.
- Animaciones de 150–250 ms y respetar `prefers-reduced-motion`.
- Responsive: menos de 768 px → menú en cajón; tablas con scroll horizontal propio.
- Modo presentación: tipografía más grande y sin chrome. Modo impresión: fondo claro.

## Comandos
- Instalar: `npm ci`
- Frontend demo: `npm run dev` (http://localhost:3000)
- Verificar: `npm test` y `npm run build`
