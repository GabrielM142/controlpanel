# Guía: trabajar OMEGA con Claude Code en VS Code

> Guía del repo `GabrielM142/controlpanel` (OMEGA). Las reglas están en `CLAUDE.md`.

## 1. Antes de empezar
1. En VS Code abre **solo esta carpeta** (`CONTROLPANEL`) como raíz, no un workspace con varias carpetas.
2. Comprueba el repo; debe mostrar `GabrielM142/controlpanel`:
   ```bash
   git remote get-url origin
   ```
3. Se trabaja directo en `main`. Trae lo último y verifica:
   ```bash
   git pull
   npm ci
   npm test
   npm run dev
   ```
   Cada `git push` a `main` publica en Vercel: haz push solo cuando hayas revisado el cambio.

## 2. Instalar (si aún no lo tienes)
- Node.js 22.12 o superior, Git y VS Code.
- Extensiones: **Claude Code** (Anthropic), **ESLint**, **Prettier** y **Error Lens** (opcional).
- Plugin de diseño en Claude Code (si cambió el nombre, búscalo con `/plugin`):
  ```
  /plugin marketplace add anthropics/claude-code
  /plugin install frontend-design@claude-code-plugins
  ```

## 3. Estado
El rediseño ya está aplicado: F0–F6 y la Fase D "Nueva era" D1–D6 están en `main`. **No vuelvas a pegar los prompts de fases anteriores**, porque rehacerían trabajo ya terminado.

## 4. Prompt base para cualquier ajuste nuevo de diseño
```
Lee CLAUDE.md (incluye el glosario y el estado actual). Repo controlpanel (OMEGA), rama main.
Tarea: <describe aquí el ajuste>.
Solo cambia el diseño: conserva menús, reportes, filtros, opciones, ids y datos.
No renombres los ids heredados (trueque, nova.*) y no toques server/, api/, worker/, lib/, sql/, contracts/, odoo_addons/, infra/, src/data/ ni tests/.
Usa los tokens --brand y --fin-*; nada de hex sueltos.
Corre npm test y npm run build, muéstrame el resumen del diff y haz commit en main. No hagas push hasta que te lo diga.
```

## 5. Si algo sale mal
- Ver qué cambió: `git status` y `git diff --stat`.
- Guardar aparte los cambios (se recuperan con `git stash pop`): `git stash -u`.
- Descartar los cambios sin commit (**se borran**; úsalo solo si estás seguro): `git restore . && git clean -fd`.
- Revertir algo ya publicado: `git revert <commit>` y luego `git push`.
- Red de seguridad: `tests/preservation.test.mjs` falla si algún reporte, filtro u opción desaparece o cambia.
