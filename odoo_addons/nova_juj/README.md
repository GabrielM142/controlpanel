# NOVA JUJ Adapter (`nova_juj`)

Adaptador de cliente separado del conector genérico. **No contiene nombres técnicos de campos JUJ**:
los campos reales de marca, unidad de negocio, canal, zona y cantón están pendientes de confirmar
con JUJ (M11). Un administrador NOVA los mapea en NOVA → Atributos JUJ:

| Atributo | Ejemplo de destino (a confirmar) |
|---|---|
| `brand` | campo de marca en `product_template` |
| `business_unit` | campo en `account_move` / `pos_config` / `crm_team` |
| `channel` | campo de canal |
| `zone`, `canton` | campos de geografía en `res_partner` |

Al guardar, el campo se agrega a "Campos adicionales autorizados" del dataset (solo campos
almacenados del mismo modelo y de tipo char/selection/many2one/integer/boolean/float/monetary/date)
y se exporta en `data.extra`. El mapeo se publica en `get_capabilities().attribute_map` para que NOVA
lo aplique en sus dimensiones. Las reglas de unidad de negocio por compañía/diario/punto de venta se
configuran en NOVA (tabla `app.business_unit_rules`), con vigencia.

Instalar: `-i nova_juj` (requiere `nova_master_data`). Pruebas: `--test-tags nova`.
