-- Truekens: factor de conversión de la plataforma = 7 (1 token real = 7 Truekens).
-- Interno de OMEGA: las respuestas de cada empresa solo muestran Truekens.
-- Solo reemplaza el valor inicial (1); si el super admin ya fijó otro factor, se respeta.
UPDATE app.platform_settings
   SET value = jsonb_set(value, '{multiplier}', '7'::jsonb)
 WHERE key = 'truekens' AND coalesce((value->>'multiplier')::numeric, 1) = 1;
