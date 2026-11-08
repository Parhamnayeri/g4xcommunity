# Production blocker remediation

Baseline: `78876a8a1a093360d785e2a5f8f8b9aca83294b1` (main containing PRs #1 and #2).
No production connections, deployment, production restart, credential changes or financial gate changes.
No Prisma schema/migration changes. All integration fixtures use disposable SQLite files.

## Startup persistence

`initializeDatabase()` used to call a synchronizing seed on every startup. The seed overwrote
canonical configuration and disabled custom/obsolete games/services. Startup now connects only.
Explicit `npm run db:seed` is a transactional, additive fresh-install bootstrap: it creates only
missing roles/games/services and never updates/deletes/deactivates existing configuration.
See [DATABASE_INITIALIZATION.md](DATABASE_INITIALIZATION.md). Existing installations do not need seed.

The startup regression initializes a fresh migrated DB explicitly, customizes canonical and custom
records, creates dependent orders/applications/settings/Discord mappings and 28 synthetic historical
reconciliation records, and snapshots every application table. Database triggers prove repeated
bootstrap/startup performs zero INSERT/UPDATE/DELETE operations on a complete installation.
The new test fails against the exact baseline's implicit startup seed and passes with this fix.

## Express / React routing

The router is mounted under both `/api` and `/`. The root aliases intercepted React navigation
before SPA fallback. Explicit React page paths now serve the entry HTML before root aliases when
HTML is acceptable; they do not require a backend API session to load the shell. React's existing
authorization flow still protects page content. API handlers and server-authoritative guards are unchanged.

`/api` is mounted first and has an explicit JSON 404 terminator. Explicit `Accept: application/json`
clients keep protected root aliases, including `/admin/orders`. Non-GET root handlers are preserved.
OAuth, OwnerGate, Legacy and other non-page aliases keep their existing handlers. Unknown API/auth/
OwnerGate paths never receive the React entry. Static assets retain their existing middleware.

The real Express HTTP regression derives all concrete page paths from App.tsx and checks both
HTML and default Accept navigation, plus authenticated navigation, compiled assets, Legacy,
OAuth start/state rejection, both OwnerGate casings, API JSON/401/404 and missing CSRF rejection.
It fails on the baseline deep links and passes after the fix. Browser smoke also exercises the
production bundle with authenticated fixture data, direct navigation, refresh and internal navigation.

## Individual dependency review

Audit executed 2026-11-08 with `npm audit --omit=dev --json`. Before: **11 dependency findings:
6 high, 5 moderate, 0 critical**. After targeted remediation and **clean `npm ci --include=dev`**:
**0 findings**. Counts include inherited parent findings, not 11 independent advisories.

Reachability is source-based triage, not an exploitation claim. Trusted remote APIs are not assumed
invulnerable; potentially affected transitive runtime paths were patched even when a specific exploit
was not demonstrated. No `npm audit fix --force` was used.

| Finding / baseline version | Severity / advisory | Directness and reachability | Patched version and remediation / compatibility |
|---|---|---|---|
| body-parser 1.20.8 | High [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828), compressed-body trailing-byte DoS | Express transitive; public JSON/urlencoded parsing is reachable, including before auth | Fixed in 1.20.9; locked 1.20.9 within Express 4's existing range. HTTP API and malformed/auth regressions preserve parser behavior. |
| follow-redirects 1.16.1 | High [GHSA-mrwp-f3q8-3g9p](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p), credentials on redirects | Axios transitive; outbound OAuth/API requests reachable; cross-realm sensitiveHeaders exploit not demonstrated | Fixed after 1.16.1; locked 1.16.3 within current range; Axios/authorization flow unchanged. |
| deepmerge-ts 7.1.5 | High [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), recursive merge stack exhaustion | Prisma config transitive; trusted local CLI config only, no application HTTP-to-Prisma-config merge path found | Fixed 8.0.0. Scoped `@prisma/config` override to 8.0.0; CommonJS/ESM exports and deepmerge API retained. Explicit Prisma config loading, nested merge, client generation, migrations, build and integration suites tested. |
| @prisma/config 6.19.3 | High, inherited deepmerge advisory above | Transitive through Prisma CLI; same trusted local config reachability | Keep Prisma/config 6.19.3; remediate child with scoped override. No Prisma 7/schema/adapter migration. |
| prisma 6.19.3 | High, inherited config/deepmerge advisory above | Direct CLI dependency; not a new remote config endpoint | Keep 6.19.3 paired with @prisma/client 6.19.3. Patched transitive override eliminates audit finding; fresh migrations and real DB suites pass. |
| undici 6.29.0 | High [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c) excessive content encodings; High [GHSA-2m5v-pch6-74hx](https://github.com/advisories/GHSA-2m5v-pch6-74hx) TLS option dropping; High [GHSA-qrxm-fqhp-jwvm](https://github.com/advisories/GHSA-qrxm-fqhp-jwvm) TLS renegotiation; Moderate [GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685) EventSource buffering; Moderate [GHSA-9fm3-97px-rjf6](https://github.com/advisories/GHSA-9fm3-97px-rjf6) WebSocket PONG buffering | Discord REST transitive HTTP client is reachable. No app use of undici EventSource/WebSocket or custom TLS Agent options found; hostile remote/proxy responses remain a relevant boundary | All fixed in 6.29.1; locked same-major 6.29.1. Discord regression suites use mocks, not a live Discord token/server. |
| qs 6.16.0 | Moderate [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw), comma stringify with non-callable toString | Express/body-parser transitive. Parsing reachable; no application invocation of vulnerable comma stringify found | Advisory affects <=6.16.0; locked 6.16.2 in existing range. |
| uuid 9.0.1 and node-cron nested 8.3.2 | Moderate [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq), v3/v5/v6 buffer bounds | Direct declaration plus transitive cron. App has no direct uuid calls; cron uses only v4(), not affected buffer-taking methods | Fixed 11.1.1. Direct dependency updated to ^11.1.1; scoped cron override to ^11.1.1. Version 11 retains CommonJS and v4; avoided ESM-only uuid 14. Explicit task ID/start/stop compatibility tested with no financial callback. |
| node-cron 3.0.3 | Moderate, inherited uuid advisory above | Direct scheduler used by escrow cron; vulnerable uuid methods not used | Keep node-cron 3.0.3 and existing schedule/callback behavior; patch its uuid child. No settlement or gate code changes. |
| react-router 6.30.6 | Moderate [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6) backslash open redirect; Moderate [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg) SSR error constructor injection | Transitive browser router is reachable. Links/Navigate currently use internal paths, no attacker-controlled backslash destination found. Application is client-rendered BrowserRouter, no SSR hydration/deserializeErrors path | Both fixed 7.18.0; selected 7.18.5. Declarative BrowserRouter/Routes/Route/Link/Navigate/hooks remain supported with React 18. Actual Chromium rendering/internal navigation/refresh and existing UI suites pass without app feature changes. |
| react-router-dom 6.30.6 | Moderate, inherited router advisories above | Direct browser dependency; same reachability | Upgraded to ^7.18.5, smallest patched major available. Production bundle, full existing TypeScript diagnostic comparison, component and browser regressions checked. |

The old integration checker required lockfile equality to PR #1. That historical constraint would
reject any authorized security fix. In combined mode it now preserves every other direct production
dependency contract, validates manifest/lock agreement and still preserves the HTTP client, order
handlers, OwnerGate, finance definitions, schema and corrected KYC fixture. Independent-head mode
retains its historical lockfile equality check. No RBAC assertion was removed.

Node engine now requires >=22.12.0 (tested v24.22.1, npm 11.9.0), matching the modern toolchain;
the previous >=20.0.0 could select versions unsupported by the locked Vite build dependency.
Do not prune dev dependencies before building; see the project's explicit bootstrap instructions.

## Validation and production boundaries

All five live gates were forced false in data-writing test subprocesses:
ESCROW_RELEASE_ENABLED, FINANCE_V2_LIVE_CREDITS_ENABLED, FINANCE_V2_LIVE_PAYOUTS_ENABLED,
FINANCE_V2_P2P_SETTLEMENT_ENABLED, NOWPAYMENTS_LIVE_COLLECTION_ENABLED.
No production DB/private storage was accessed, no live Discord connectivity claimed, no financial
settlement code or OwnerGate security modified, no historical records repaired/resolved.

Build/typecheck/older test comparison uses the exact main baseline above with its own original
lockfile and generated Prisma client, not the patched node_modules tree. Browser smoke uses system
Chromium and a disposable SQLite copy containing only synthetic fixtures. Initial baseline setup
without Prisma generate and initial missing Playwright-managed browser were corrected; final
commands use generated clients and installed system Chromium.

### Executed commands and results

| Command | Result on fix branch |
|---|---|
| `npm ci --include=dev --cache /tmp/g4x-fix-npm-cache` | Pass, clean lockfile install |
| `npm run build` | Pass, backend tsc and frontend Vite production build; baseline build also passes |
| `node scripts/test-pr-integration.cjs --combined` | 17 pass |
| `node scripts/run-combined-regressions.cjs` | All required functional/build/setup steps pass; exit **2** only for pre-existing standalone frontend typecheck |
| `npm run test:order-workspace` | 16 pass (combined runner) |
| `npm run test:order-workspace:api` | 40 pass (combined runner) |
| `npm run test:native-admin:react` | 12 pass (combined runner) |
| `npm run test:native-admin` | 53 pass (combined runner) |
| `npm run test:registration` | 22 pass (combined runner) |
| `npm run test:provisioning` | 45 pass, mocked Discord (combined runner) |
| `npm run test:phase7` | All 8 sections pass; corrected symlink fixture preserved (combined runner) |
| `npm run test:ownergate` | 12 pass, disposable owner fixture (combined runner) |
| `npm run test:startup-persistence` | 6 pass; fails as expected on baseline implicit-seed assertion |
| `npm run test:spa-routing` | 83 pass; fails as expected on baseline direct `/wallet` HTML assertion |
| `npm run test:dependency-compatibility` | 3 pass, including actual Prisma config loading and cron task lifecycle |
| `npm audit --omit=dev --json --cache /tmp/g4x-fix-npm-cache` | 0 vulnerabilities after clean installation |
| `npm audit --omit=dev --cache /tmp/g4x-fix-npm-cache` | Exit 0, 0 vulnerabilities |
| `node node_modules/typescript/bin/tsc -p frontend/tsconfig.json --noEmit` | Exit 2; 86 diagnostics, same normalized full diagnostic multiset as exact baseline; 0 added/removed |
| `npm run test:games` | 63 pass / 4 fail in both baseline and fix; old keystone/deletion fixtures/expectations |
| `npm run test:routing` | 20 pass / 1 fail in both; old publication-button expectation |
| `npm run test:security` | 15 pass / 2 fail in both; old Forbidden text and staff-access expectations |
| `npm ls --depth=0` | Pass |
| `git diff --check` | Pass |
| `node /tmp/g4x-blockers-browser.cjs` | Local Chromium smoke: 4 authenticated pages with direct navigation+refresh, internal Link navigation, no uncaught page errors |

The baseline comparison helper `/tmp/compare-blockers-baseline.cjs` ran each older suite on a separate
copy of a migrated/seeded disposable baseline DB. Exact baseline source was archived separately and
installed from its original lockfile; Prisma client generation and its production build were run there.
The two new regression test files/runner were then injected into that temporary archive without
changing its implementation, to demonstrate the baseline failures. No baseline source in Git changed.

Transient local evidence locations for this run:
- combined suite: `/tmp/g4x-combined-regression-iriujQ/results.json` and per-step logs;
- comparison: `/tmp/g4x-blockers-baseline-comparison-KEypsn/` (both full typecheck/test logs);
- new regressions: `/tmp/g4x-startup-final.log`, `/tmp/g4x-spa-final.log`;
- browser: `/tmp/g4x-blockers-browser.log` (synthetic manager/session only);
- audit JSON: `/tmp/g4x-blockers-audit-before.json`, `/tmp/g4x-blockers-audit-after.json`.

These test commands must not be run with a production DB. The combined and new regression runners
create their own databases and force all five gates false. The older individual suites do not all
provide that isolation themselves; use disposable DATABASE_URL fixtures as done in the comparison.

### Remaining limitations and release verdict

All three confirmed **code/dependency release blockers are resolved in this branch**: startup
preserves configuration, React navigation reaches HTML, and the current production dependency audit
is clean. There are no newly observed test or TypeScript regressions. Existing baseline failures and
bundle-size warning remain; the combined runner is not reported as fully green.

This is not deployment approval. The actual production schema/migration history (including intentional
financial CHECK/partial indexes), SQLite/private-storage backups, environment completeness, TLS/Nginx
and live Discord channel/bot permissions still require operator verification. No live Discord test
was performed. Existing financial gates must remain false and 28 historical real reconciliation records
must remain unresolved/unaltered. This change has no new migration and does not apply the schema diff
from the earlier audit. Rollback and maintenance still require the operator's existing deployment process.
