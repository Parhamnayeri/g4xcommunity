# G4X Community — Staging Environment Setup & Operating Manual

This document details the configuration, architecture, safety boundaries, and operational procedures for running the **G4X Community Isolated Local Staging Environment** (Staging Phase 1).

---

## 1. Core Mission & Isolation Boundaries

The staging environment provides a 100% reproducible, standalone local environment for manual and automated QA verification without touching production infrastructure or real money.

### Critical Isolation Guarantees:
- **No Linode Deployment**: Staging runs exclusively on local developer machines or CI runners (`127.0.0.1`).
- **No Production Discord Connectivity**: The Discord client login is bypassed in `STAGING_MODE`; all interactions utilize the in-memory `MockDiscordAdapter`.
- **No Production Database Overwrites**: The staging SQLite database is strictly confined to `prisma/staging/staging.db`. Any attempt to run staging tools against production paths (`data/g4x.db`, `data/g4x_dev.db`, `dev.db`) fails closed immediately.
- **No Live Payment Gateways**: Real-money payment providers (NOWPayments, Zarinpal, BEP-20 RPC transfers) are disabled.
- **Six Mandatory Feature Safety Gates**:
  ```ini
  ESCROW_RELEASE_ENABLED=false
  FINANCE_V2_LIVE_CREDITS_ENABLED=false
  FINANCE_V2_LIVE_PAYOUTS_ENABLED=false
  FINANCE_V2_P2P_SETTLEMENT_ENABLED=false
  NOWPAYMENTS_LIVE_COLLECTION_ENABLED=false
  RAIDERIO_LIVE_SYNC_ENABLED=false
  ```
  If any of these gates are set to `true`, `scripts/validate-staging-env.ts` immediately halts execution.

---

## 2. Configuration (`.env.staging`)

Copy the template from `.env.staging.example` to `.env.staging` (which is strictly gitignored):

```bash
cp .env.staging.example .env.staging
```

### Essential Parameters:
| Variable | Staging Value | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | Development logging and error traces |
| `STAGING_MODE` | `true` | Activates mock adapters and staging login endpoints |
| `HOST` | `127.0.0.1` | Loopback binding only (prevents LAN/public exposure) |
| `PORT` | `3001` | Dedicated staging web server port |
| `DATABASE_URL` | `file:./staging/staging.db` | Schema-relative path to `<repoRoot>/prisma/staging/staging.db` |
| `G4X_OWNER_ACCESS_KEY` | High-entropy string (min 32 chars) | Required for emergency `/OwnerGate` access |
| `DISCORD_TOKEN` | `mock_staging_token_do_not_connect` | Dummy token; bypassed in `STAGING_MODE` |

---

## 3. Tooling & CLI Commands

The repository provides automated npm scripts for managing the lifecycle of the staging environment:

### A. Environment Validation
```bash
npx ts-node scripts/validate-staging-env.ts
```
Verifies that all 6 financial gates are disabled, host binding is loopback, database URL points inside `prisma/staging/`, and no production credentials are present.

### B. Database Provisioning & Bootstrap
```bash
npm run staging:bootstrap
```
1. Validates the environment.
2. Resolves canonical database path `prisma/staging/staging.db`.
3. Deploys all 27 Prisma migrations via `scripts/safe-migration-runner.ts`.
4. Executes `PRAGMA foreign_key_check;` and verifies referential integrity.
5. Injects SQLite partial unique indexes (`idx_bwr_settled_tx_hash_unique`, `idx_bwr_settled_bank_receipt_unique`, `idx_order_channels_active_execution`).
6. Seeds all supported games (`wow_midnight`, `wow`, etc.), canonical services, and the synthetic dataset.
7. Validates single-owner resolution for OwnerGate.

### C. Safe Database Reset
```bash
npm run staging:reset -- --confirm-staging-reset
```
Requires the explicit `--confirm-staging-reset` flag and refuses to delete any file outside `prisma/staging/`. Cleanly unlinks `staging.db`, `staging.db-journal`, `staging.db-wal`, and `staging.db-shm`.

### D. Starting the Staging Server
```bash
npm run staging:start
```
Launches the Express server on `http://127.0.0.1:3001` with the in-memory Mock Discord Adapter.

### E. Running the Staging Automated Verification Suite
```bash
npm run test:staging
```
Executes 83 automated assertions across two specialized suites:
1. `npm run test:staging:bootstrap` (57 tests): covers environment validation, reset confinement, Prisma migrations, partial unique indexes, synthetic dataset integrity, and HTTP role-based authorization smoke tests.
2. `npm run test:staging:security` (26 tests): covers production entrypoint fail-closed guards, production route 404 sanitization, loopback peer anti-spoofing, synthetic identity allowlists, canonical path confinement, anti-symlink protection, credential leakage checks, and session cookie separation.

---

## 4. Synthetic Test Identities

The staging database is populated with 10 synthetic test identities using dedicated 18-digit numeric snowflakes (`999999999999990001` through `999999999999990010`):

| Snowflake ID | Username | Primary Role(s) | Description / Test Scope |
|---|---|---|---|
| `999999999999990001` | `staging_owner` | `owner` | Platform Owner, OwnerGate single-owner resolution |
| `999999999999990002` | `staging_admin` | `admin` | Full system administrator, dispute resolution, manual deposit approval |
| `999999999999990003` | `staging_management`| `manager` | Operations manager, application review, setup management |
| `999999999999990004` | `staging_staff` | `staff` | Support staff, order run review, proof verification |
| `999999999999990005` | `staging_advertiser` | `advertiser` | Gold-ranked advertiser, order creation, IRT deposit testing |
| `999999999999990006` | `staging_exchanger` | `exchanger` | Currency exchanger, marketplace trade partner |
| `999999999999990007` | `staging_booster` | `booster` | Active booster, Mythic+ key claims, USDT withdrawal testing |
| `999999999999990008` | `staging_pilot` | `pilot`, `booster` | Verified pilot booster, raid clears, account piloting |
| `999999999999990009` | `staging_multirole` | `booster`, `staff` | Multi-role union testing (dual staff and booster capabilities) |
| `999999999999990010` | `staging_unverified`| *(none)* | Unverified customer, public portal boundary testing |

---

## 5. Hardened Staging Synthetic Authentication

To allow seamless browser and automated API testing without requiring live Discord OAuth2 callbacks, an isolated staging authentication router is provided with strict security boundaries:

### Security Boundaries:
1. **Production Route Segregation**:
   - `POST /api/auth/staging-login` is **NEVER** registered in production routes (`src/web/routes.ts` or `src/web/server.ts`).
   - Production entrypoint (`src/index.ts`) fails closed immediately if `STAGING_MODE=true` is passed.
   - Production web server returns HTTP 404 for any staging authentication attempt.
2. **Loopback Peer Enforcement (Zero-Trust)**:
   - Requests are checked against raw socket address (`req.socket.remoteAddress`).
   - Only `127.0.0.1`, `::1`, and `::ffff:127.0.0.1` are permitted.
   - Non-loopback remote peers receive `403 FORBIDDEN_REMOTE_ACCESS`.
   - Headers `Host` and `X-Forwarded-For` are strictly ignored for authorization.
3. **Strict Synthetic Identity Allowlist**:
   - Only pre-seeded 18-digit synthetic IDs in the range `999999999999990001` - `999999999999990010` are accepted.
   - Real Discord user IDs or arbitrary snowflakes are rejected with `403 FORBIDDEN_SYNTHETIC_IDENTITY`.
   - Only pre-approved synthetic roles (`owner`, `admin`, `manager`, `staff`, `advertiser`, `exchanger`, `booster`, `pilot`, `multi_role`, `unverified`) can be resolved.
4. **Session Separation (`g4x_staging.sid`)**:
   - Staging sets an isolated cookie name: `g4x_staging.sid` (production uses `g4x.sid`).
   - Staging sessions are completely ignored by the production server, preventing cross-environment replay attacks.

```http
POST /api/auth/staging-login
Content-Type: application/json

{
  "userId": "999999999999990007"
}
```
*or by role:*
```json
{
  "role": "booster"
}
```

### Response:
```json
{
  "success": true,
  "user": {
    "discordId": "999999999999990007",
    "username": "staging_booster",
    "displayName": "Staging Pro Booster",
    "roles": ["booster"]
  },
  "csrfToken": "4a7f..."
}
```
The endpoint regenerates the session ID, sets `req.session.userId`, issues an HttpOnly `g4x_staging.sid` session cookie, and returns the CSRF token.

---

## 6. Seeded Operational Data

The bootstrap process provisions:
- **Games & Services**: Retail WoW, Classic, Rainbow Six Siege, Mythic+ Keystone, and Raid clears.
- **WoW Characters**: `Frostblade` (Tarren Mill EU, 2850 RIO score) and `Holyheal` (Kazzak EU, 2700 RIO score).
- **Orders**: 5 orders across lifecycle statuses (`payment_pending`, `open_presign`, `in_progress`, `completed`, `cancelled`).
- **Execution Channel**: Order 103 mapped to Discord execution channel `999999999999993001` with active index uniqueness.
- **Financial Requests**: A pending USDT booster withdrawal ($15.00) and an IRT advertiser funding request (5,000,000 Tomans).
- **Rules & Policies CMS**: Version 1.0 published with 6 structured sections and advertiser commission matrix.

---

## 7. Current Readiness Verdict

- **Staging Phase 1 Verdict**: **GO** (All local environment bootstrap, reset, seeding, and automated test gates pass 100%).
- **Production Deployment Verdict**: **NO-GO** (Production locks and financial safety gates remain strictly enforced; Linode deployment remains disabled).
