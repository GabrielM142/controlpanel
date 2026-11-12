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
- Tema base **oscuro obsidiana**. Cada color tiene un solo trabajo:
  - **oro** `--omega-gold`: marca, lo prioritario, "Presentar al directorio" (texto oscuro encima);
  - **esmeralda** `--good`: a favor, aprobar;
  - **bermellón** `--bad`: pérdida, urgente, vencido;
  - **ámbar** `--warn`: revisar, riesgo medio;
  - **zafiro** `--info`: datos neutros y series de gráficas;
  - **amatista** `--ai`: todo lo que dice o hace Omega IA.
- Los colores vivos se usan como texto sobre obsidiana o como chip (fondo `-soft` + texto `-text`). Nada de gradientes decorativos.
- Tipografía: **Instrument Serif** para titulares y cifras grandes (`tabular-nums`), **Geist** para la interfaz.
- Iconos: `lucide-react` (ya instalado), con trazo de 1.7. La Ω es el logotipo y el símbolo de la IA. Sin emojis.
- Cada número importante lleva comparación (vs presupuesto o vs año anterior) y una lectura en una frase.
- Cada vista responde una pregunta gerencial en su encabezado ("¿Dónde estoy perdiendo margen?").
- Copy en español, tuteo, directo y ejecutivo: "Tu firma", "Lo que podría salir mal", "Decisión sugerida".

## Accesibilidad y calidad
- Contraste AA sobre obsidiana: texto secundario como mínimo `--text-3` (#8c8e9b sobre #111319).
- Colores que se deben distinguir (bien/mal) también difieren en claridad, no solo en tono.
- Elementos reales (`button`, `a`, `label` + `input`), `aria-label` en botones de solo icono y foco visible con anillo dorado.
- Animaciones de 150–250 ms y respetar `prefers-reduced-motion`.
- Responsive: menos de 768 px → menú en cajón; tablas con scroll horizontal propio.
- Modo presentación: tipografía más grande y sin chrome. Modo impresión: fondo claro.

## Comandos
- Instalar: `npm ci`
- Frontend demo: `npm run dev` (http://localhost:3000)
- Verificar: `npm test` y `npm run build`
