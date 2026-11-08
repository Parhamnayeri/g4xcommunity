# PR #1 pre-merge security verification

Reviewed against main `41ea88e` on 2026-11-05. This follow-up changes tests and documentation only. Production KYC authorization, reference precedence, private storage and financial services are unchanged.

## KYC diagnosis

The original Phase 7 fixture created a pilot verification pointing to document A, then created another application for the same user with a symlink in qualifications. The server intentionally resolves the pilot verification reference first. The 200 response contained the authorized document A marker, not `package.json` or any other outside file. Calling this failure an established document-security defect in the original PR description was incorrect.

The corrected regression explicitly verifies that precedence and response bytes, then changes the effective verification reference to the escaping symlink. The validator rejects it as `ILLEGAL_LINK_DETECTED`; both application/type and application-bound direct-reference routes return 403. Existing staff/admin KYC denial, cross-application binding, traversal rejection, missing metadata, stale-role revocation and anti-self-approval assertions remain enabled. No access control or expected 403 for an effective symlink was weakened.

The complete Phase 7 suite passes. This resolves the reported fixture failure; it is not a claim that all possible filesystem races or unrelated document workflows have been exhaustively audited.

## Financial authorization

Reviewed all added/changed order endpoints and their service calls. Order details are read-only and require live private-order permission. Roster assignment requires live assignment permission and CSRF, rechecks complete registered roster/payment state transactionally, and delegates approval/capacity/reservation protection to the existing engine. Discord refresh requires live publication permission, CSRF, an existing publication and verified/exempt funding; it changes no wallet or ledger balances. Existing funding, receipt verification, review and cancellation services remain authoritative.

Expanded API regressions cover forged actor/user IDs from staff, booster and unrelated advertiser sessions; denied assignment/refresh/final approval; missing wallet CSRF; missing verified receipt; insufficient wallet backing; and immutable before/after wallet and ledger state. Successful roster and mocked Discord operations also leave financial balances unchanged. All 40 API checks pass. No new financial authorization or wallet mutation bypass was found in the reviewed PR paths.

## Exact validation commands and outcomes

Commands ran from `/workspace/g4xcommunity`, with disposable SQLite databases only. Shared test environment:

```bash
export NODE_ENV=test COOKIE_SECURE=false
export ESCROW_RELEASE_ENABLED=false FINANCE_V2_LIVE_CREDITS_ENABLED=false
export FINANCE_V2_LIVE_PAYOUTS_ENABLED=false FINANCE_V2_P2P_SETTLEMENT_ENABLED=false
export NOWPAYMENTS_LIVE_COLLECTION_ENABLED=false

DATABASE_URL=file:/workspace/g4xcommunity/data/task2_review_kyc.db npm run test:phase7
# PASS: all eight sections, including both effective-symlink rejection paths.
DATABASE_URL=file:/workspace/g4xcommunity/data/task2_review_finance.db npm run test:order-workspace:api
# PASS: 40 checks.
npm run test:order-workspace
# PASS: 16 checks.
npm run build
# PASS: backend TypeScript and Vite production build.
git diff --check
# PASS.

DATABASE_URL=file:/workspace/g4xcommunity/data/task2_review_kyc.db WEB_BASE_URL=http://localhost:3000 npm run test:security
# FAIL: 15 passed / 2 failed; identical failures reproduced on unmodified main.
node_modules/.bin/tsc -p frontend/tsconfig.json --noEmit
# FAIL: 86 pre-existing diagnostics; zero added by the PR.
node_modules/.bin/tsc -p /tmp/g4x-review-main/frontend/tsconfig.json --noEmit
# FAIL on archived main: 94 diagnostics using the same installed dependency tree.
```

Frontend comparison normalizes checkout prefixes and line/column offsets, then compares `(frontend-relative path, TS error code, message)` as multisets. The PR adds zero diagnostics and removes eight unused Management-page declarations. Remaining diagnostics are in existing exchange/exchanger, profile/settings, staff/KYC and shared modules. The production build does not run this standalone frontend type check, so its success does not imply that check passes.

The older authentication suite has two stale expectations: test 10a requires the literal `Forbidden` error instead of the current error contract despite receiving 403; test 10b grants `staff` and expects admin overview access, which current RBAC correctly rejects with 403. Both reproduce on main. Without `WEB_BASE_URL`, its cross-origin assertion also fails because the test omits origin-policy configuration; with the explicit local origin it passes. These unrelated tests and production authorization were not weakened to make the suite green.

No merge, deployment, production secret change, database reset or live financial gate activation was performed. Live Discord/OAuth connectivity remains outside these mock/local tests.
