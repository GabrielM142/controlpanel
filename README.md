# CONTROLPANEL · JUJ

Panel web para Vercel, API de snapshots y worker PostgreSQL independiente. Primera implementación: panel ejecutivo, comercial, financiero e inventario sobre un contrato agregado; reporte original de 13 vistas conservado como referencia. No hay conexión real a Odoo todavía. Los otros centros requieren ampliar el contrato de datos y sus vistas. No se ha implementado IA: los textos de IA del documento son ejemplos del cliente.

## Desarrollo
Node.js 22 o superior. `npm ci`, `npm test`, `npm run build`, `npm run dev`. Abrir http://localhost:3000. El servidor local usa demo por defecto. La API desplegada falla cerrada si no se configura modo demo o contraseña.

## Vercel
Importar GabrielM142/controlpanel, framework Other, build `npm run build`, salida `dist`, Node 22. La API se despliega desde api/index.mjs y el rewrite dirige /api/* hacia ella. Para revisar sin datos privados, configurar APP_MODE=demo. Para producción: APP_MODE=live, PANEL_PASSWORD aleatoria y larga, DATABASE_URL (PostgreSQL analítico con TLS verificado). Acceso HTTP Basic usuario `juj`; contraseña compartida como protección inicial. Antes de acceso multiusuario implementar SSO, roles y auditoría por persona. Nunca poner la URL de Odoo en el frontend ni en variables públicas.

## Arquitectura
Navegador → API Vercel → PostgreSQL analítico (cola + snapshots).
Worker persistente en red privada → réplica PostgreSQL Odoo, usuario exclusivamente SELECT.
El clic inserta un trabajo y responde 202; el worker consulta fuera de Vercel, valida y publica el resultado en una transacción. Los snapshots anteriores siguen disponibles. Una restricción impide trabajos simultáneos; el advisory lock limita a un worker. Tras reinicio, un trabajo interrumpido queda fallido y el operador puede solicitar otro. No hay reintentos automáticos ilimitados. Consultas limitadas a 40 minutos. Mantener límites de red, SSL y credenciales separados por entorno. Vercel no aloja el worker persistente.

## Preparar Odoo
1. Confirmar versión, empresas, monedas, zona horaria, devoluciones, impuestos, valoración de inventario y dimensiones personalizadas de JUJ.
2. Configurar réplica física o base analítica alimentada por ETL; no ejecutar consultas pesadas contra la principal. Supervisar retraso de réplica y ajustar timeout a la infraestructura.
3. El DBA implementa `juj_reporting.controlpanel_v1` siguiendo sql/CONTRACT.md. En una réplica física los objetos se crean en origen y se replican: valorar ETL a una base separada si no se desea modificar el origen.
4. Copiar .env.example a .env y configurar DATABASE_URL, ODOO_REPLICA_URL. Ejecutar `npm run migrate` en la base analítica, luego `npm run worker` en un servicio persistente. La cuenta de réplica debe ser de solo lectura; el código refuerza transacciones READ ONLY.
5. Validar cifras contra reportes contables y comerciales antes de habilitar modo live. Probar cola, fallo, reinicio y publicación contra PostgreSQL de staging; esas pruebas no se han ejecutado sin bases disponibles.

## Operación y límites de esta entrega
Historial conserva todos los snapshots en BD; API retorna los 12 últimos y los 20 trabajos recientes. Definir retención con JUJ antes de producción. Respuestas agregadas deben mantenerse pequeñas: el worker rechaza más de 100000 filas, pero para grandes volúmenes migrar contenido a object storage y paginar API. Los filtros no disparan consultas a Odoo. Balances de cartera/inventario usan último mes seleccionado y no se suman a través del tiempo. Customers no se agrega porque requiere conteo distinto real. Presupuestos, neto, ISE, OTIF, campañas, clientes y riesgos necesitan contratos adicionales; consultar referencia original. No existe una integración Odoo genérica fiable sin conocer los campos reales.

Pruebas locales: contrato, agregaciones básicas, acceso cerrado y bloqueo de actualización demo. El build copia activos estáticos; verificar despliegue Vercel y worker con credenciales del entorno.
