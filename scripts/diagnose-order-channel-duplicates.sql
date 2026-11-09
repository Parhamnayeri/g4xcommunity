-- ==============================================================================
-- G4X Community — Production SQLite Order Execution Channel Diagnostic Script
-- Read-only inspection script for duplicate active execution channels and FK integrity.
-- Usage: sqlite3 /path/to/production.db < scripts/diagnose-order-channel-duplicates.sql
-- ==============================================================================

.mode column
.headers on

-- 1. FOREIGN KEY INTEGRITY CHECK
-- Must return 0 rows. Any rows indicate orphaned foreign keys.
SELECT '=== 1. FOREIGN KEY INTEGRITY CHECK ===' AS section;
PRAGMA foreign_key_check;

-- 2. PARTIAL UNIQUE INDEX VERIFICATION
SELECT '=== 2. PARTIAL UNIQUE INDEX VERIFICATION ===' AS section;
SELECT name, tbl_name, sql 
FROM sqlite_master 
WHERE type = 'index' 
  AND name = 'idx_order_channels_active_execution';

-- 3. SUMMARY COUNTS
SELECT '=== 3. EXECUTION CHANNEL SUMMARY COUNTS ===' AS section;
SELECT 
    COUNT(*) AS total_order_channels,
    SUM(CASE WHEN channel_type = 'execution' THEN 1 ELSE 0 END) AS total_execution_channels,
    SUM(CASE WHEN channel_type = 'execution' AND status = 'active' THEN 1 ELSE 0 END) AS active_execution_channels,
    SUM(CASE WHEN channel_type = 'execution' AND status = 'archived' THEN 1 ELSE 0 END) AS archived_execution_channels
FROM order_channels;

-- 4. ORDERS WITH DUPLICATE ACTIVE EXECUTION CHANNELS
SELECT '=== 4. ORDERS WITH MULTIPLE ACTIVE EXECUTION CHANNELS ===' AS section;
SELECT 
    order_id,
    COUNT(*) AS active_channel_count,
    GROUP_CONCAT(id, ', ') AS channel_record_ids,
    GROUP_CONCAT(discord_channel_id, ', ') AS discord_channel_ids
FROM order_channels
WHERE channel_type = 'execution' AND status = 'active'
GROUP BY order_id
HAVING COUNT(*) > 1;

-- 5. DETAILED DISCREPANCY AUDIT
-- Compares order_channels records against orders.execution_channel_id
SELECT '=== 5. DETAILED DISCREPANCY AUDIT (ACTIVE CHANNELS VS ORDERS TABLE) ===' AS section;
SELECT 
    oc.id AS channel_record_id,
    oc.order_id,
    o.status AS order_status,
    o.execution_channel_id AS order_execution_channel_id,
    oc.discord_channel_id AS channel_record_discord_id,
    CASE 
        WHEN o.execution_channel_id IS NULL THEN 'NO_ORDER_POINTER'
        WHEN o.execution_channel_id = oc.discord_channel_id THEN 'MATCHES_ORDER_POINTER (KEEP ACTIVE)'
        ELSE 'MISMATCHED (CANDIDATE FOR ARCHIVE)'
    END AS reconciliation_status,
    oc.created_at AS channel_created_at
FROM order_channels oc
INNER JOIN (
    SELECT order_id
    FROM order_channels
    WHERE channel_type = 'execution' AND status = 'active'
    GROUP BY order_id
    HAVING COUNT(*) > 1
) dup ON oc.order_id = dup.order_id
LEFT JOIN orders o ON oc.order_id = o.id
WHERE oc.channel_type = 'execution' AND oc.status = 'active'
ORDER BY oc.order_id ASC, oc.id ASC;
