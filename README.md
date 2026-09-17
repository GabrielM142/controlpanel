# CONTROLPANEL · JUJ / SIDE

Web de presentación del reporte del cliente, con sus 13 vistas completas. El HTML, los datos de ejemplo, los filtros, los indicadores, las tablas, los textos, el orden y las interacciones son los originales. El único cambio del reporte es una hoja de estilos adicional (`public/premium.css`). La página principal ya no sustituye centros por avisos ni inserta el reporte en un iframe.

## Ver y publicar
Node 22+. `npm ci`, `npm run build`, `npm run dev`. Abrir http://localhost:3000.
Vercel: importar `GabrielM142/controlpanel`, framework Other, build `npm run build`, output `dist`, Node 22. No necesita variables de entorno para esta etapa. El build publica index.html y premium.css.

## Alcance actual
Se conserva el mockup tal como lo entregó el cliente, incluyendo cifras ilustrativas, etiquetas, botones y funcionalidades que ya tenía. No se agregó una conexión Odoo ni cálculos nuevos. Actualizar/Exportar y los filtros conservan exactamente el comportamiento original; esta entrega no afirma que consulten datos reales. `public/referencia.html` conserva el original para cotejo. Una prueba compara los scripts y el HTML contra la referencia al quitar únicamente el enlace CSS añadido.

Los archivos API/worker/SQL y el panel alternativo de la primera entrega quedan fuera del flujo de la web. Son trabajo preliminar para una futura etapa Odoo; no se invocan desde la página y no se deben configurar todavía. El backend requiere revisión antes de uso real. No hay datos ni credenciales reales en esta entrega.
