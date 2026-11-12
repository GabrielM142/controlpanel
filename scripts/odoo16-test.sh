#!/usr/bin/env sh
# Install + upgrade + run the NOVA addon tests on a THROWAWAY Odoo 16 database.
# Never point this at a client/production database.
#   docker compose -f infra/compose.staging.yml up -d odoo16-db odoo16
#   sh scripts/odoo16-test.sh
set -eu
DB="${NOVA_TEST_DB:-nova_test_$(date +%s)}"
ADDONS="${NOVA_ADDONS:-nova_connector,nova_master_data,nova_sales,nova_account,nova_stock,nova_stock_account,nova_purchase,nova_pos,nova_juj}"
COMPOSE="docker compose -f infra/compose.staging.yml"
echo "== install ($DB): $ADDONS"
$COMPOSE exec -T odoo16 odoo -d "$DB" --db_host odoo16-db --db_user odoo --db_password odoo \
  -i "$ADDONS" --test-enable --test-tags nova --stop-after-init --log-level=test
echo "== upgrade (-u) on the same database"
$COMPOSE exec -T odoo16 odoo -d "$DB" --db_host odoo16-db --db_user odoo --db_password odoo \
  -u "$ADDONS" --stop-after-init
echo "== core only (optional functional addons absent must not break the connector)"
$COMPOSE exec -T odoo16 odoo -d "${DB}_core" --db_host odoo16-db --db_user odoo --db_password odoo \
  -i nova_connector,nova_master_data --test-enable --test-tags nova --stop-after-init --log-level=test
echo "OK"
