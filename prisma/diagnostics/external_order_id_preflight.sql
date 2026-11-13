-- Read-only preflight for 20261112132400_management_external_orders.
-- Resolve every returned row manually before running scripts/safe-migration-runner.ts.
SELECT id, order_ref, platform_account_id, external_order_id
FROM orders
WHERE external_order_id IS NOT NULL
  AND trim(external_order_id) = '';

SELECT platform_account_id, external_order_id, COUNT(*) AS row_count,
       GROUP_CONCAT(id) AS order_ids
FROM orders
WHERE external_order_id IS NOT NULL
  AND trim(external_order_id) <> ''
GROUP BY platform_account_id, external_order_id
HAVING COUNT(*) > 1;
