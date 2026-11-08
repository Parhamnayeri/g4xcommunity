# Native React administration migration (Task 3)

Base: main `41ea88e`. PR #1 was open/unmerged at the start; this branch starts directly from main. No Order Management implementation or OwnerGate code from PR #1 is included or changed.

## Modules and contracts

- `/management/applications` and `/admin/applications`: shared native member-application queue/details, applicant/Discord-ID search, type/status/UTC-date filters, server pagination, supported review decisions, notes and history. Management's applications tab mounts the same component. Live category permissions constrain both list and details; self-review and KYC requirements still use `reviewApplication`. General review never serves identity files. New approval/rejection audit events retain reviewer notes; existing history is not rewritten.
- `/admin/games`: existing `/api/admin/games` and `/api/admin/services` APIs, backed by `gameManagementService`. Create/edit display metadata and supported service settings, sort order and enable/disable controls. Slug/service identifiers are fixed in edit forms; no destructive delete controls. Existing identifier/reference guards remain authoritative.
- `/admin/discord`: saved guild/channel mappings, purpose/key and game/service/mode, filtering/pagination, configuration CRUD and separate live validation. Read access includes Admin; writes require the existing `SERVICE_CONFIG_MANAGE` permission (Manager/Owner). An error does not imply success, and a MANUAL saved status does not mean live verification succeeded.
- Shared navigation appears in Admin and Management. Each native route has a route-level error boundary. Legacy Owner links remain available for capabilities not replaced here, including automatic provisioning/repair. Native mapping CRUD does not create/delete actual Discord channels or invent bot workflows: operators must use keys consumed by existing registration, order panel, publication or execution integrations.

New endpoints under `/api/management`:

- `GET /applications/:id`: sanitized details, authorized actions and existing decision history.
- Existing `GET /applications`: add search/date filtering, stable ordering and normalized summary fields; restrict category scope by live permissions.
- `GET /channel-mappings`: existing authoritative mapping inventory.
- `POST`, `PUT`, `DELETE /channel-mappings/:key`: transactional configuration, live permissions, CSRF, snowflake and model/reference validation, uniqueness/conflict checks, audit records, no Discord channel deletion.
- `POST /channel-mappings/:key/verify`: uses the current injected bot client, existing channel/type validator and bot-permission validator. Returns current connectivity observations separately from saved state, with graceful missing-client/guild/channel/API failure responses. No import of the application bootstrap or bot login is triggered.

Mapping changes are blocked while matching active orders exist; category changes are conservatively blocked while any active order exists. Existing mapping workflow scope/type cannot be repurposed. Matching existing publication routes stay coherent in the same transaction; removal deactivates corresponding routes. Historical order/channel references are never rewritten.

## Safety and data

No schema or migration changes. No live database, production secrets or Linode access used. All five financial gates stayed false for integration runs. Tests use `task3*.db` disposable SQLite databases with existing migrations and canonical seeds. The new suite creates 28 **synthetic** historical `review_required` reconciliation batches and compares full snapshots afterward, along with wallets/ledger/orders. This demonstrates non-mutation in fixtures; it is not a claim that production's 28 records were accessed or independently inspected. There is no reconciliation or financial mutation path in the new configuration service.

## Reproduction and results

Use a new disposable database; never point these suites at production. Existing migration/seed commands prepare the file without a reset:

```bash
mkdir -p data
python -c "import sqlite3; sqlite3.connect('data/task3_migration.db').close()"
export DATABASE_URL="file:$(pwd)/data/task3_migration.db"
npx prisma migrate deploy
npm run db:seed
export NODE_ENV=test COOKIE_SECURE=false
export ESCROW_RELEASE_ENABLED=false FINANCE_V2_LIVE_CREDITS_ENABLED=false
export FINANCE_V2_LIVE_PAYOUTS_ENABLED=false FINANCE_V2_P2P_SETTLEMENT_ENABLED=false
export NOWPAYMENTS_LIVE_COLLECTION_ENABLED=false
npm run test:native-admin
npm run test:native-admin:react
npm run build
npx tsc -p frontend/tsconfig.json --noEmit
git diff --check
```

Actual results:

| Command | Result |
| --- | --- |
| `npm run test:native-admin` | 53 checks passed, disposable DB; includes effective KYC symlink rejection, forbidden identity access, configuration CRUD, reference guards, audit notes and 28 historical reconciliation fixtures |
| `npm run test:native-admin:react` | 12 passed; navigation, supported review requests, loading/empty, 401/403, malformed API response, role restrictions and snowflake fields |
| `npm run test:registration` | 22 passed |
| `npm run test:provisioning` | 45 passed, mock Discord only |
| `npm run test:ownergate` | 12 passed after adding its required owner fixture only to its disposable database |
| `npx ts-node src/test/separated_order_dashboard_suite.ts` | 80 passed |
| `npm run build` | Passed: backend TypeScript and frontend Vite production build |
| `npx tsc -p frontend/tsconfig.json --noEmit` | 94 pre-existing diagnostics, also 94 on main; zero new, comparing complete error messages independent of checkout prefix/line offsets |
| `npm run test:games` | 66 passed / 2 failed, reproduced on unmodified main: seed's Mythic+ keystone setting expectation and assuming a referenced canonical service in an otherwise isolated DB |
| `npm run test:routing` | 20 passed / 1 failed, reproduced on unmodified main: outdated expected presign/claim button layout. Actual routing, card refresh, duplicate prevention, completion/cancellation and zero financial mutations passed |
| `npm run test:phase7` | Existing fixture failure reproduced: symlink reference in application is shadowed by a valid higher-priority pilot-verification reference. PR #1 contains its separate fixture correction. This branch's new independent KYC access/symlink regressions pass without importing PR #1 |
| `git diff --check` | Passed |

Backend suites each ran with their own disposable `task3_*.db`. Initial setup/fixture failures (missing OwnerGate owner, reusable fixed guild IDs) were diagnosed and corrected in test setup; no production authorization was weakened. No new regression remains in the final targeted suites. Live Discord/OAuth behavior and browser-driven end-to-end testing were not performed; React tests use the renderer and Discord tests use mocks.

## Deployment prerequisites (not executed)

Review/merge independently from PR #1 and resolve any ordinary overlapping navigation/application-route edits when both land. Before a separately authorized Linode deployment: back up the persistent SQLite database and private storage; review the known baseline suite/type-check failures; reproduce tests/builds using the pinned lockfile and supported Node runtime; confirm existing migrations without a reset; retain all five financial gates as false; verify configured guild/channel ownership and required bot permissions in an approved test guild; validate OwnerGate/session configuration through secure settings; compare production's 28 historical reconciliation records before/after. No new schema migration is required by this PR, and no deployment approval is implied.

## Changed files

- `frontend/src/components/admin/NativeAdminModules.tsx`: reusable UI/hooks and the three native modules.
- `frontend/src/App.tsx`, `frontend/src/pages/AdminPage.tsx`, `frontend/src/pages/ManagementPage.tsx`: bounded routes/navigation and replacement of obsolete application-tab UI only.
- `frontend/src/services/api.ts`: surface domain messages alongside error codes.
- `src/web/operationsRoutes.ts`: application queries/details and guarded mapping endpoints.
- `src/services/channelMappingConfigurationService.ts`: transactional mapping configuration and read-only live verification.
- `src/services/registrationService.ts`: retain per-decision reviewer notes in new audit records only.
- `src/test/native_admin_migration_suite.ts`, `scripts/test-native-admin.cjs`: focused API and React regressions.
- `package.json`, `package-lock.json`: scripts and matching React test renderer dev dependency.
- This document: evidence, limitations and deployment prerequisites.
