-- Migration: 20261103003000_deposit_evidence_database_uniqueness
-- 1. Safely disambiguate existing legacy duplicate evidence references before creating uniqueness constraints
-- (Preserves original evidence reference and ID without deleting or merging financial records)

UPDATE "advertiser_funding_requests"
SET "evidence_ref" = "evidence_ref" || '_LEGACY_DUP_' || "id"
WHERE "id" IN (
    SELECT "id" FROM (
        SELECT "id", ROW_NUMBER() OVER (PARTITION BY "evidence_ref" ORDER BY "id" ASC) as rn
        FROM "advertiser_funding_requests"
        WHERE "evidence_ref" IS NOT NULL AND "status" IN ('PENDING_ADMIN_VERIFICATION', 'CONFIRMED_CREDITED')
    ) WHERE rn > 1
);

UPDATE "payment_attempts"
SET "tracking_number" = "tracking_number" || '_LEGACY_DUP_' || "id"
WHERE "id" IN (
    SELECT "id" FROM (
        SELECT "id", ROW_NUMBER() OVER (PARTITION BY "tracking_number" ORDER BY "id" ASC) as rn
        FROM "payment_attempts"
        WHERE "tracking_number" IS NOT NULL AND "status" IN ('waiting', 'confirmed', 'finished')
    ) WHERE rn > 1
);

-- 2. Partial unique index on active/confirmed deposit evidence in advertiser_funding_requests
CREATE UNIQUE INDEX IF NOT EXISTS "advertiser_funding_requests_active_evidence_ref_key"
ON "advertiser_funding_requests"("evidence_ref")
WHERE "evidence_ref" IS NOT NULL AND "status" IN ('PENDING_ADMIN_VERIFICATION', 'CONFIRMED_CREDITED');

-- 3. Partial unique index on active/confirmed tracking numbers in payment_attempts
CREATE UNIQUE INDEX IF NOT EXISTS "payment_attempts_active_tracking_number_key"
ON "payment_attempts"("tracking_number")
WHERE "tracking_number" IS NOT NULL AND "status" IN ('waiting', 'confirmed', 'finished');
