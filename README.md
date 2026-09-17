# CONTROLPANEL · JUJ / SIDE

Aplicación React + TypeScript + Vite para Vercel. Contiene las 13 vistas completas del cliente: Dirección Empresarial; Comercial, Financiero, Compras, Inventarios, Clientes, Logística, Marketing y Riesgos; Mayorista Hogar, Mayorista Intorno, Retail JUJ y Retail Intorno.

## Implementación
- Componentes React tipados para KPI, tablas, gráficos, ISE, alertas y navegación geográfica.
- Datos del mockup separados en `src/data/report.json`. No se inyecta HTML, no hay iframe ni se ejecuta el script original en el navegador.
- Diseño propio en `src/theme.css`, tipografías locales Inter/Manrope e iconos Lucide. Sin llamadas externas para renderizar la interfaz.
- Navegación por hash, historial del navegador, filtros con estado React, selectores de gráficos, explicación del ISE y recorrido Provincia → Cantón → Zona.
- Menú móvil accesible, tablas con desplazamiento interno, soporte de movimiento reducido y hoja de impresión.

## Desarrollo
Node >=22.12. `npm ci`, `npm run dev`. Abrir http://localhost:3000.
`npm test` verifica contenido y orden de las 13 vistas contra el documento original, además de filtros y opciones. `npm run build` ejecuta TypeScript y compila con Vite. `npm run preview` permite revisar la salida de producción.

## Fidelidad al cliente
`reference/client-original.html` es solo una referencia de auditoría y no se publica ni ejecuta en la aplicación. `scripts/migrate-report.mjs` fue la herramienta de migración inicial. `src/data/report.json` y los componentes React son la implementación actual. La prueba de fidelidad compara el texto completo renderizado de cada página (con excepción de iconos decorativos y explicaciones inicialmente plegadas) con el original. No se eliminaron, sustituyeron ni reordenaron centros, KPI, tablas ni secciones.

## Vercel
Importar `GabrielM142/controlpanel`. Framework **Vite**, build `npm run build`, directorio de salida `dist`, Node 22 o superior. No se requieren variables de entorno para esta etapa. Navegación hash compatible con enlaces directos. `.vercelignore` excluye el backend preliminar y la referencia; `publicDir:false` evita publicar cualquier mockup anterior.

## Alcance de los datos
Todos los datos siguen siendo ejemplos del documento del cliente. Los filtros conservan sus opciones y selección; el original no recalculaba los indicadores y no se inventan cálculos en esta etapa. Las gráficas dinámicas sí alternan los conjuntos originales. Actualizar muestra el estado de demostración y Exportar abre impresión/guardar PDF. El texto de IA es el ejemplo original, no una generación nueva.

## Odoo — etapa posterior
`api/`, `lib/`, `sql/` y `worker/` conservan el trabajo preliminar de snapshots de la primera entrega; quedan excluidos del despliegue y no se llaman desde React. No configurar ni presentar esa integración como operativa. La futura conexión requiere validar esquema, métricas, permisos, réplica, seguridad y operación del worker con JUJ.
