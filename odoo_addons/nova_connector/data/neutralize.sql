-- Applied by `odoo-bin neutralize` (Odoo 16+) on staging copies/clones:
-- a neutralized database must never publish batches as if it were production.
UPDATE nova_connection
   SET state = 'suspended',
       central_source_ref = NULL,
       last_error = 'Base neutralizada: re-vincular como nueva generación si corresponde';
UPDATE nova_sync_run SET state = 'cancelled', error = 'Base neutralizada'
 WHERE state IN ('pending', 'preparing', 'ready');
