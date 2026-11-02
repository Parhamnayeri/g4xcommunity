-- Migration: 20261103024500_p2p_quote_reference_uniqueness
-- 1. Add dedicated persisted quote reference column to AdvertiserFundingRequest
ALTER TABLE "advertiser_funding_requests" ADD COLUMN "quote_ref" TEXT;

-- 2. Backfill existing quote references from admin_notes where present
UPDATE "advertiser_funding_requests"
SET "quote_ref" = SUBSTR(
    "admin_notes",
    INSTR("admin_notes", '[QuoteRef: ') + 11,
    INSTR(SUBSTR("admin_notes", INSTR("admin_notes", '[QuoteRef: ') + 11), ']') - 1
)
WHERE "admin_notes" LIKE '%[QuoteRef: %]%' AND "quote_ref" IS NULL;

-- 3. Preserve historical evidence: Flag duplicate historical quote references without rewriting original references
UPDATE "advertiser_funding_requests"
SET "legacy_evidence_resolution" = 'LEGACY_CONFLICT_MANUAL_RECONCILIATION_REQUIRED'
WHERE "id" IN (
    SELECT "id" FROM (
        SELECT "id", ROW_NUMBER() OVER (PARTITION BY "quote_ref" ORDER BY "id" ASC) as rn
        FROM "advertiser_funding_requests"
        WHERE "quote_ref" IS NOT NULL
          AND "legacy_evidence_resolution" IS NULL
    ) WHERE rn > 1
);

-- 4. Create database-enforced unique index on quote_ref for all active/non-conflicting records
CREATE UNIQUE INDEX IF NOT EXISTS "advertiser_funding_requests_quote_ref_key"
ON "advertiser_funding_requests"("quote_ref")
WHERE "quote_ref" IS NOT NULL AND "legacy_evidence_resolution" IS NULL;
