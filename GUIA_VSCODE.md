# Guía: rediseñar OMEGA con Claude Code en VS Code

> Esta guía es del repo **controlpanel** (OMEGA). La de Trueque WPP vive en el repo `truequewpp`.

## 1. Antes de empezar
1. Abre en VS Code **solo** la carpeta `CONTROLPANEL`, no la de truequewpp, para que Claude no mezcle proyectos.
2. Comprueba que estás en el repo correcto: debe mostrar `GabrielM142/controlpanel`.
   ```bash
   git remote get-url origin
   ```
3. Trabaja directo en `main` (es un demo publicado). Antes de empezar, asegúrate de tener lo último y de que las pruebas pasan:
   ```bash
   git checkout main
   git pull
   npm ci
   npm test
   npm run dev
   ```
   Cada `git push` a `main` publica en Vercel: haz push solo cuando hayas revisado la fase.

## 2. Instalar (si aún no lo tienes)
- Node.js 22.12 o superior, Git y VS Code.
- Extensiones: **Claude Code** (Anthropic), **ESLint**, **Prettier** y **Error Lens** (opcional).
- En Claude Code, el plugin de diseño (si cambió el nombre, búscalo con `/plugin`):
  ```
  /plugin marketplace add anthropics/claude-code
  /plugin install frontend-design@claude-code-plugins
  ```

## 3. Prompt de la fase F0 (pégalo en Claude Code)
```
Lee CLAUDE.md, REDISENO_OMEGA.md, docs/STATUS.md y docs/ARCHITECTURE.md.
Repo controlpanel (OMEGA), rama main. Solo cambia el diseño: conserva todos los menús, reportes, filtros y opciones.
Ejecuta la FASE F0 de REDISENO_OMEGA.md:
1. Crea src/styles/omega-tokens.css con los tokens de la sección 3 e impórtalo antes de theme.css.
2. Añade las fuentes Geist e Instrument Serif con @fontsource (verifica que existan y la versión).
3. Reemplaza los hex sueltos de src/theme.css por variables de omega-tokens.css, por secciones.
   Puedes des-minificar theme.css para trabajar, pero no cambies nombres de clases.
4. No toques server/, api/, worker/, lib/, sql/, contracts/, odoo_addons/, infra/ ni src/data/api.ts.
5. Mantén las claves de localStorage nova.* y el modo demo.
6. Ejecuta npm test y npm run build y muéstrame el resultado y el resumen del diff.
Espera mi aprobación antes de hacer commit.
```

## 4. Prompts siguientes (uno por fase, tras aprobar la anterior)
- **F1:** "Ejecuta la FASE F1: marca OMEGA con logo Ω dorado y el lema, menú en 3 grupos (Ejecutivo, Unidades, Gestión) más Pregúntale a Omega, header con chip de frescura de datos, barra Ctrl K (reutiliza CommandPalette) y botón oro Presentar al directorio. El tour solo se abre a pedido. Mantén todas las vistas y la clave nova.nav."
- **F2:** "Ejecuta la FASE F2: vista Dirección igual al mockup (briefing en serif, Pulso ISE, 4 KPIs con comparación y nota, gráfica real/presupuesto/año anterior, Tu firma, unidades, riesgos) con los datos actuales, sin cambiar su forma."
- **F3:** "Ejecuta la FASE F3: bandeja Lo que espera tu decisión, reutilizando TicketsView y useThresholds, con Omega recomienda y confirmación para montos mayores a $10 k."
- **F4:** "Ejecuta la FASE F4: convierte AIDrawer en la vista Pregúntale a Omega, con historial, fuentes citadas, Decisión sugerida y Llevar a decisiones. Solo lectura."
- **F5 y F6:** según `REDISENO_OMEGA.md` §6.

## 5. Si algo sale mal
- Ver qué cambió: `git status` y `git diff --stat`.
- Guardar aparte los cambios para probar sin ellos (se recuperan con `git stash pop`): `git stash -u`.
- Volver una rama al último commit, **borrando** los cambios sin commit: `git restore . && git clean -fd`. Úsalo solo si estás seguro.
- Si ya hiciste push de algo que no te gusta, revierte ese commit (crea uno nuevo que lo deshace y Vercel vuelve a la versión anterior): `git revert <commit>` y luego `git push`.
- La red de seguridad es `npm test`: `tests/preservation.test.mjs` falla si algún reporte, filtro u opción desaparece o cambia.
