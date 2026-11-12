-- 0014 · Top-level product category (first level of Odoo's category path) for "Categoría" vs
-- "Subcategoría" breakdowns. category_name keeps the product's own (leaf) category.
ALTER TABLE core.dim_product ADD COLUMN IF NOT EXISTS category_top text;
