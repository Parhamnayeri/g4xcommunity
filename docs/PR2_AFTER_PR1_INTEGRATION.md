# PR #2 after PR #1: owner-gated integration plan

## Status and limits — 2026-11-08 UTC

PR #1 is **open/unmerged**, head `02337ae4ee8f36593abd07964549aa2bd465b18b`.
PR #2 is **open/unmerged**, implementation head `a8c1c28957194aa27790407c6c6b51b27b77520a` before this preparation commit. Both target `main`, baseline `41ea88efe2a86c7159faf748cd0fc72ef448f3e2`.

This preparation changes only tests and this plan. It does not merge either PR, change PR #2's base, rebase the branch, copy Order Management into PR #2, alter application behavior, or connect to Linode. Actual combined-tree validation and comparison with owner-updated main are deliberately pending. Passing independent-head tests does not establish combined merge readiness.

## Seven common files and resolution rules

Read-only per-file three-way analysis (`git merge-file -p` on temporary files, never applied to the branch) predicts **three textual conflicts**. Git's textual merge output is not a semantic approval.

| Shared file | Current result | Required integration behavior |
| --- | --- | --- |
| `frontend/src/App.tsx` | Text conflict | Retain exactly one of each existing route, PR #1 `/admin/orders` and `/owner/orders`, plus PR #2 `/management/applications`, `/admin/applications`, `/admin/games`, `/admin/discord`. Keep route error boundaries and all module imports. Never choose one whole side of the insertion. |
| `frontend/src/pages/ManagementPage.tsx` | Text conflicts; highest semantic risk | Preserve PR #1 `useSearchParams` dispute deep link and `OrderManagementWorkspace`; preserve PR #2 `ApplicationsWorkspace` and `AdminModuleNavigation`. Remove **both** obsolete order and application loaders, states, handlers and imports. Remaining tab-loading effect should load disputes only; each workspace loads its own data. Do not resurrect stale `loadOrders` or `loadApplications`, old review modal, unused types or feedback banners. Retain overview, disputes and audit functionality. |
| `frontend/src/pages/AdminPage.tsx` | Textually compatible | Preserve PR #1 `defaultTab` prop, initialization and effect for direct order links **and** PR #2 `AdminModuleNavigation`. Keeping only one version can silently lose deep-link state or module navigation. |
| `frontend/src/services/api.ts` | Identical change | Keep existing cookie/CSRF behavior and `message || error` reporting once. No alternate HTTP client or credentials. |
| `package.json` | Text conflict | Union all four order/native-admin test script entries. Keep the shared pinned `react-test-renderer` dependency once; do not replace one test family with the other. |
| `package-lock.json` | Identical contents | Retain the existing compatible lockfile. Do not regenerate unrelated dependency versions to resolve the script-only manifest conflict. Recheck lock consistency after resolution. |
| `src/web/operationsRoutes.ts` | Textually compatible, semantic review required | Preserve both order-details/assignment/Discord endpoints and application-details/category-scope/configuration endpoints. Keep all imports, live permission guards and CSRF middleware; keep configuration writes Manager/Owner-only. Avoid duplicate route declarations or generic-path shadowing. Preserve KYC handlers exactly, and do not substitute client roles for server authorization. |

### API and authorization compatibility

Order diagnostics use `/api/management/orders/:id` and structured status labels/typed details from PR #1. Applications use `/api/management/applications` and `/api/management/applications/:id`, normalized applicant/submission metadata, category-specific permissions and sanitized KYC references from PR #2. The old application loader/modal must not remain as an accidental consumer of the changed response. Both frontend workspaces continue using the shared cookie/CSRF client.

There are no collisions between newly added route paths in the two independent heads. Mapping CRUD uses a separate namespace; assignment/payment/approval and configuration services remain separate. Keep transactional roster checks, self-review prohibition, audit records, verified-receipt/backed-wallet checks and private KYC storage. Operational approval and Discord refresh must not release financial balances. No schema, OwnerGate or finance-gate-definition changes are needed for integration.

## Executed preparation checks

```bash
node scripts/test-pr-integration.cjs
# PASS: 11 independent-head compatibility contract checks; confirms 7 overlaps and 3 predicted conflicts.
node scripts/run-combined-regressions.cjs --check-ready
# EXPECTED BLOCK (exit 2): PR #1 is still unmerged; no integration/database operations performed.
```

The contract checker uses the TypeScript AST to detect duplicate React routes and fixed Express endpoints, checks both added route families/error boundaries, order deep-link initialization, native navigation, separate API contracts, regression entry points, guards and identical shared client/lockfile contents. It is a targeted preflight, **not** proof that an unapplied combined tree compiles or behaves correctly. The future `--combined` mode additionally requires all actual routes, both page behaviors, removed obsolete loaders and both test families in the checked-out tree.

Fresh current-head checks, with all five gates set to `false`, `NODE_ENV=test`, `COOKIE_SECURE=false`, and new disposable databases only:

| Source tree | Commands actually executed | Result |
| --- | --- | --- |
| PR #2 working tree | `npm run test:native-admin` | 53 passed; new `data/task3_compat_20261108.db`, existing migrations/seeds. Includes KYC access/symlinks, RBAC/CSRF/audit, game references, mapping protection, unchanged wallets/ledger and 28 synthetic historical reconciliation fixtures. |
| PR #2 working tree | `npm run test:native-admin:react` | 12 passed |
| PR #2 working tree | `npm run build` | Backend TypeScript + Vite production builds passed |
| PR #2 and archived current main | `node node_modules/typescript/bin/tsc -p frontend/tsconfig.json --noEmit` (respective project paths) | Both fail with 94 existing diagnostics; zero new, comparing complete normalized messages |
| Archived PR #1 head only, under `/tmp/g4x-pr1-compat-20261108` | `npm run test:order-workspace:api` | 40 passed; new `data/task2_compat.db` |
| Same isolated PR #1 archive | `npm run test:order-workspace` | 16 passed |
| Same isolated PR #1 archive | `npm run build` | Backend TypeScript + Vite production builds passed |

The PR #1 archive uses the identical verified lockfile/dependency tree and schema, not any combined source. Its files are not copied into PR #2. No production database or real reconciliation records were accessed. The 28 synthetic fixtures demonstrate preservation during tests, not an inspection of production's 28 records. Live Discord and browser-driven end-to-end behavior are not claimed.

## After the owner merges PR #1

1. Re-read both PR statuses/heads and fetch latest main plus the merged PR #1 head. Handle a normal, squash or rebase merge using current metadata; do not assume the old head remains an ancestor. Confirm no user changes or unpushed commits would be lost.
2. Update the existing PR #2 branch against **owner-updated main**, resolving the three predicted conflicts and reviewing all seven shared files according to the table. Preserve both feature families and the independently corrected KYC fixture from PR #1. Do not merge either PR through GitHub.
3. Run `node scripts/test-pr-integration.cjs --combined --pr1-ref=<latest-PR1-head>`. A missing route/guard/script, stale loader or duplicate declaration blocks readiness.
4. Run `node scripts/run-combined-regressions.cjs`. The runner first reads GitHub's merged status and latest PR #1 head, requires HEAD to contain the current main commit reported by GitHub, then runs combined contract checks. It refuses while PR #1 is unmerged or the combined contract is incomplete. It never merges, rebases, pushes, changes a base, deploys, logs in to Discord or accepts a production database URL.
5. The runner creates new databases under a unique temporary directory, applies existing migrations/seeds without reset, and runs the matrix below. All five live financial gates are forcibly false for each test subprocess. The owner fixture is created only in the isolated OwnerGate test database. Logs and `results.json` are retained with current-run paths and exit statuses.
6. Compare full standalone frontend TypeScript diagnostics and older game/routing/auth test failures with **that exact updated main**, using independently seeded disposable databases and identical tool versions. Normalize file prefixes/line numbers but retain full diagnostic messages/counts. Do not waive a new failure as a baseline failure. Current pre-merge observations (94 frontend errors on both old main and PR #2; older game/routing fixtures; old Phase 7 shadowed-symlink fixture) are historical evidence, not permission to skip updated-main comparison. PR #1's KYC fixture correction should remove the specific Phase 7 failure.
7. Run `git diff --check`, inspect the final diff and ledger/reconciliation snapshots, update both reports, commit and push only the existing PR #2 branch. Recheck its base remains `main`. Report a final integrated SHA and only then assess owner-controlled merge readiness. Never merge/deploy automatically.

### Combined matrix prepared, not executed yet

| Coverage | Required commands after integration |
| --- | --- |
| Order Management, payment/roster/Discord safety | `npm run test:order-workspace`; `npm run test:order-workspace:api` |
| Applications, games/services, mappings, audit, historical preservation | `npm run test:native-admin`; `npm run test:native-admin:react` |
| Registration/domain decisions | `npm run test:registration` |
| Discord synchronization/publication configuration, mocks | `npm run test:provisioning`; compare older `npm run test:routing` against updated main |
| KYC, live RBAC, CSRF, self-approval | `npm run test:phase7` with PR #1 fixture correction, plus native-admin security cases |
| OwnerGate | `npm run test:ownergate` with its isolated owner prerequisite |
| Navigation/error boundaries/coexistence | `node scripts/test-pr-integration.cjs --combined`; both renderer suites |
| Production builds | `npm run build` (backend and frontend) |
| Frontend typing | `npx tsc -p frontend/tsconfig.json --noEmit`, compare updated main |
| Older baseline failures | `npm run test:games`; `npm run test:routing`; `WEB_BASE_URL=http://localhost:3000 npm run test:security`, on both trees |
| Diff hygiene | `git diff --check` |

Runner exit 2 is a blocked prerequisite or a failed frontend baseline-review observation, **not** a passing suite. Required functional test failures return 1. The older-suite/main comparisons remain an explicit review step; the runner does not silently bless them.

## Readiness

Prepared for integration after owner merge of PR #1; **not yet approved as an integrated PR #2 merge**. No real combined conflict has been applied/resolved while the prerequisite remains open. No migration, secret change, live financial gate activation, automatic reconciliation, Linode connection or deployment is part of this preparation.
