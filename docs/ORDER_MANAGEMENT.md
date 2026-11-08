# React order management

Management (`/management/orders`), Admin (`/admin/orders`), and Owner (`/owner/orders`) use the same workspace. Each portal keeps its existing access guard, including OwnerGate. The workspace itself requires manager, admin, or owner; backend authorization always reads live database roles.

The list reuses the separated G4X/platform and advertiser order service, with explicit search/filter submission, stable server pagination, UTC date boundaries, and registry game slugs. Empty results, loading, failed requests, stale responses and pagination after a mutation are handled explicitly. Historical data and origin classification are retained.

Order details combine existing funding diagnostics with assignment history, registered applicants, required roles, runs/proof, disputes/holds, release tracker and audit events. Both historical `Order` and `order` audit entity names are included. Audit access is checked separately. Private evidence references remain text; only HTTP(S) evidence URLs become links.

Only server-advertised actions are offered. Existing receipt verification, backed wallet reservation, publication, staff review, final approval and cancellation APIs remain authoritative. Operators confirm actions and supply review/cancellation notes or a receipt reference. Double submission is blocked and both list/details refresh after a mutation. No direct status editing, force-paid, financial release or gate toggle is provided.

The registered-applicant assignment endpoint delegates to the existing assignment engine. Complete roster, registered claim/role and paid-state checks run inside its transaction, alongside existing approval, capacity and unique reservation checks. This workspace assigns a complete roster from individual registered claims; it does not introduce a new squad or replacement lifecycle.

Discord publication and refresh use the existing card publisher. An assigned order can refresh its existing funded card without reopening pre-sign claims. Assignment/cancellation retain the existing Discord hooks. Stored channel/message IDs are shown as references, not asserted live connectivity. Live bot/OAuth behavior requires configured Discord credentials and is not exercised by local tests.

## Regression checks

```bash
npm ci
npx prisma generate
npm run test:order-workspace
npm run build
```

For authenticated API regressions, create a new, disposable SQLite file (not a live database), migrate and seed it, then run:

```bash
mkdir -p data
python -c "import sqlite3; sqlite3.connect('data/task2_test.db').close()"
export DATABASE_URL="file:$(pwd)/data/task2_test.db"
export NODE_ENV=test COOKIE_SECURE=false
export ESCROW_RELEASE_ENABLED=false FINANCE_V2_LIVE_CREDITS_ENABLED=false
export FINANCE_V2_LIVE_PAYOUTS_ENABLED=false FINANCE_V2_P2P_SETTLEMENT_ENABLED=false
npx prisma migrate deploy
npm run db:seed
npm run test:order-workspace:api
npx ts-node src/test/separated_order_dashboard_suite.ts
```

The API suite requires a `task2*.db` URL and creates uniquely named fixtures in that disposable database. It uses a mock Discord client and never logs into Discord. No database reset is needed.

## Known failures reproduced on unchanged main

- The original `test:phase7` symlink fixture changed only application qualifications while a higher-priority pilot verification still referenced the valid document. The fixture is corrected and the complete suite passes. Both effective-symlink retrieval routes return 403; see `PR1_SECURITY_REVIEW.md`.
- `test:publication`: legacy fixed service IDs produce a routing mismatch and a foreign-key error on service ID 18 with the current canonical seed. The targeted workspace API suite tests actual publication/refresh with dynamically resolved service IDs.
- Standalone frontend `tsc` reports existing errors in other modules. The changed order workspace and portal files have no diagnostics; the production `npm run build` (server TypeScript plus Vite) passes.
