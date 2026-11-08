-- Migration: 20261103010000_restore_evidence_provenance_and_legacy_exclusion
-- 1. Add dedicated resolution columns to preserve immutable banking evidence
ALTER TABLE "advertiser_funding_requests" ADD COLUMN "legacy_evidence_resolution" TEXT;
ALTER TABLE "payment_attempts" ADD COLUMN "legacy_evidence_resolution" TEXT;

-- 2. Drop existing partial unique indexes temporarily to allow provenance restoration
DROP INDEX IF EXISTS "advertiser_funding_requests_active_evidence_ref_key";
DROP INDEX IF EXISTS "payment_attempts_active_tracking_number_key";

-- 3. Restore original bank evidence references for databases where 20261103003000 was previously applied
-- Restores the exact immutable banking reference and flags legacy conflict for manual reconciliation
UPDATE "advertiser_funding_requests"
SET "legacy_evidence_resolution" = 'LEGACY_CONFLICT_MANUAL_RECONCILIATION_REQUIRED',
    "evidence_ref" = SUBSTR("evidence_ref", 1, INSTR("evidence_ref", '_LEGACY_DUP_') - 1)
WHERE "evidence_ref" LIKE '%_LEGACY_DUP_%';

UPDATE "payment_attempts"
SET "legacy_evidence_resolution" = 'LEGACY_CONFLICT_MANUAL_RECONCILIATION_REQUIRED',
    "tracking_number" = SUBSTR("tracking_number", 1, INSTR("tracking_number", '_LEGACY_DUP_') - 1)
WHERE "tracking_number" LIKE '%_LEGACY_DUP_%';

-- 4. Mark any remaining legacy duplicates in active/confirmed status without rewriting original evidence
UPDATE "advertiser_funding_requests"
SET "legacy_evidence_resolution" = 'LEGACY_CONFLICT_MANUAL_RECONCILIATION_REQUIRED'
WHERE "id" IN (
    SELECT "id" FROM (
        SELECT "id", ROW_NUMBER() OVER (PARTITION BY "evidence_ref" ORDER BY "id" ASC) as rn
        FROM "advertiser_funding_requests"
        WHERE "evidence_ref" IS NOT NULL
          AND "status" IN ('PENDING_ADMIN_VERIFICATION', 'CONFIRMED_CREDITED')
          AND "legacy_evidence_resolution" IS NULL
    ) WHERE rn > 1
);

UPDATE "payment_attempts"
SET "legacy_evidence_resolution" = 'LEGACY_CONFLICT_MANUAL_RECONCILIATION_REQUIRED'
WHERE "id" IN (
    SELECT "id" FROM (
        SELECT "id", ROW_NUMBER() OVER (PARTITION BY "tracking_number" ORDER BY "id" ASC) as rn
        FROM "payment_attempts"
        WHERE "tracking_number" IS NOT NULL
          AND "status" IN ('waiting', 'confirmed', 'finished')
          AND "legacy_evidence_resolution" IS NULL
    ) WHERE rn > 1
);

-- 5. Re-create partial unique indexes with explicit legacy conflict exclusion
-- Enforces strict uniqueness on active/confirmed liabilities without mutating historical records
CREATE UNIQUE INDEX IF NOT EXISTS "advertiser_funding_requests_active_evidence_ref_key"
ON "advertiser_funding_requests"("evidence_ref")
WHERE "evidence_ref" IS NOT NULL
  AND "status" IN ('PENDING_ADMIN_VERIFICATION', 'CONFIRMED_CREDITED')
  AND "legacy_evidence_resolution" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "payment_attempts_active_tracking_number_key"
ON "payment_attempts"("tracking_number")
WHERE "tracking_number" IS NOT NULL
  AND "status" IN ('waiting', 'confirmed', 'finished')
  AND "legacy_evidence_resolution" IS NULL;
