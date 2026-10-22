# G4X Community — Production Deployment & Operations Guide

This guide details the requirements, configuration, and step-by-step procedures for deploying **G4X Community** to **Bot-Hosting.net** and setting up a secure local testing environment.

---

## 1. System Requirements & Technology Stack

- **Node.js**: v20.x, v22.x LTS (Recommended: Node.js 22 LTS)
- **Package Manager**: npm v10+
- **Database**: SQLite with Prisma ORM v6.19.3
- **Bot Framework**: Discord.js v14
- **Web Framework**: Express v4 with `express-session` & SQLite session store
- **Version Control**: Git

---

## 2. Environment Variables Checklist

Configure the following variables in your hosting dashboard or local `.env` file (see `.env.example`):

| Variable | Description | Example / Default | Required In |
|---|---|---|---|
| `DISCORD_TOKEN` | Discord Bot Token from Developer Portal | `MTA...` | Dev & Prod |
| `DISCORD_CLIENT_ID` | Discord Application Client ID | `123456789012345678` | Dev & Prod |
| `DISCORD_CLIENT_SECRET` | Discord Application OAuth2 Client Secret | `xyz...` | Dev & Prod |
| `DISCORD_GUILD_ID` | Primary Discord Server (Guild) ID | `123456789012345678` | Dev & Prod |
| `CHANNEL_ORDERS` | Channel ID for orders (Phase 3.3) | `123456789012345678` | Dev & Prod |
| `CHANNEL_APPLY_REQUESTS`| Private Channel ID for staff application reviews | `123456789012345678` | Dev & Prod |
| `CHANNEL_LOGS` | Log channel ID | `123456789012345678` | Optional |
| `ROLE_OWNER` | Discord Role ID for Owner | `123456789012345678` | Dev & Prod |
| `ROLE_MANAGER` | Discord Role ID for Manager | `123456789012345678` | Dev & Prod |
| `ROLE_ADMIN` | Discord Role ID for Admin | `123456789012345678` | Dev & Prod |
| `ROLE_STAFF` | Discord Role ID for Staff | `123456789012345678` | Dev & Prod |
| `ROLE_EXCHANGER` | Discord Role ID for Exchanger | `123456789012345678` | Dev & Prod |
| `ROLE_ADVERTISER` | Discord Role ID for Advertiser | `123456789012345678` | Dev & Prod |
| `ROLE_BOOSTER` | Discord Role ID for Booster | `123456789012345678` | Dev & Prod |
| `ROLE_PILOT` | Discord Role ID for Pilot | `123456789012345678` | Dev & Prod |
| `HOST` | Express host binding | `0.0.0.0` | Prod |
| `PORT` | Web server listening port | **`26189`** (Bot-Hosting.net production assigned port; `3000` for local dev) | Dev & Prod |
| `NODE_ENV` | Environment mode | `production` | Prod |
| `WEB_BASE_URL` | Canonical public URL of the web server | `https://g4x.online` | Dev & Prod |
| `SESSION_SECRET` | Strong random string (min 64 chars) | *Cryptographic secret* | Dev & Prod |
| `DISCORD_REDIRECT_URI` | OAuth2 callback redirect URL | `https://g4x.online/auth/callback` | Dev & Prod |
| `DATABASE_URL` | SQLite database file URI | `file:../data/g4x_dev.db` | Dev & Prod |
| `ESCROW_RELEASE_ENABLED`| Automatic escrow settlement switch | **`false`** (Must remain false; releases strictly disabled) | Dev & Prod |
| `FINANCE_V2_LIVE_CREDITS_ENABLED` | Real advertiser funding credit execution switch | **`false`** (Default false; live credits strictly disabled) | Dev & Prod |
| `FINANCE_V2_LIVE_PAYOUTS_ENABLED` | Real booster withdrawal payout execution switch | **`false`** (Default false; live payouts strictly disabled) | Dev & Prod |
| `G4X_BOOST_HOLD_HOURS` | Holding period for G4X published boosts from Admin Final Approval | `24` | Dev & Prod |
| `BOOSTER_USDT_WITHDRAWAL_FEE_CENTS` | Fixed fee for booster USDT BEP-20 withdrawals | `40` ($0.40) | Dev & Prod |
| `BOOSTER_IRT_WITHDRAWAL_FEE_CENTS` | Fixed fee for booster IRT bank withdrawals | `130` ($1.30) | Dev & Prod |
| `BOOSTER_IRT_RATE_DISCOUNT_PER_USD` | Rate discount per USD for booster IRT withdrawals | `3000` (3,000 IRT) | Dev & Prod |
| `ADVERTISER_IRT_PURCHASE_FEE_RATE` | Currency purchase fee for advertiser IRT funding | *No default. Must be explicitly approved by management* | Admin Config |
| `IRT_PAYOUT_TUESDAY_CUTOFF_HOUR` | Tuesday morning cutoff hour for Wednesday payout window | *Unapproved by owner. Missing cutoff blocks scheduling* | Admin Config |
| `PRESIGN_TIMER_MINUTES` | Pre-sign window timer | `10` | Dev & Prod |

---

## 3. Discord Developer Portal Setup

### 3.1 Privileged Gateway Intents
In [Discord Developer Portal](https://discord.com/developers/applications):
1. Navigate to your application -> **Bot**.
2. Under **Privileged Gateway Intents**, enable:
   - **Presence Intent** (optional)
   - **Server Members Intent** (`GuildMembers` — required for role sync & member lookups)
   - **Message Content Intent** (`MessageContent` — required for `G4!` prefix commands)
3. Save Changes.

### 3.2 Bot Permissions & Role Hierarchy
1. Invite the bot to your server with permissions:
   - Manage Roles (`MANAGE_ROLES`)
   - Send Messages (`SEND_MESSAGES`)
   - Embed Links (`EMBED_LINKS`)
   - Attach Files (`ATTACH_FILES`)
   - Read Message History (`READ_MESSAGE_HISTORY`)
   - Use External Emojis (`USE_EXTERNAL_EMOJIS`)
2. **Role Hierarchy Requirement**:
   - In Discord Server Settings -> **Roles**, move the **G4X Bot role above** the roles it assigns (`Booster`, `Pilot`, `Advertiser`, `Exchanger`). If the bot's role is below them, Discord API will reject role assignments with a `403 Missing Permissions` error.

---

## 4. Discord Channels Architecture (Phase 3.2.4)

G4X Community uses two dedicated channel categories for separated public application entry and private administrative review:

### 4.1 Public Category: `START HERE`
Contains dedicated registration panels for each role. Regular guild members can view and interact, but cannot send chat messages:
1. **`#become-booster`** (`CHANNEL_BECOME_BOOSTER`) — Booster registration panel with automated WoW Midnight Raider.IO profile sync.
2. **`#become-adv`** (`CHANNEL_BECOME_ADVERTISER`) — Customer order advertiser registration panel.
3. **`#become-pilot-booster`** (`CHANNEL_BECOME_PILOT`) — Verified account-play pilot registration panel.
4. **`#become-exchanger`** (`CHANNEL_BECOME_EXCHANGER`) — In-game currency exchanger application panel.

### 4.2 Private Category: `APPLICATION MANAGEMENT`
Restricted strictly to Owner, Manager, and authorized application reviewers (`@everyone` denied View Channel):
1. **`#app-boosters`** (`CHANNEL_APP_BOOSTERS`) — Private review cards for Booster applications.
2. **`#app-adv`** (`CHANNEL_APP_ADVERTISERS`) — Private review cards for Advertiser applications.
3. **`#app-pilots`** (`CHANNEL_APP_PILOTS`) — Private review cards for Pilot applications.
4. **`#app-exchangers`** (`CHANNEL_APP_EXCHANGERS`) — Private review cards for Exchanger applications.

### 4.3 Automated Channel & Panel Provisioning
Authorized managers (Owner / Manager) can execute:
```
G4!setup registration
```
This command automatically resolves the configured channel IDs (or creates missing categories and channels with real permission overwrites) and deploys or refreshes the dedicated panel in each public channel without creating duplicates.

> **How to find Channel IDs and Role IDs:**
> In Discord, go to **User Settings -> Advanced -> Enable Developer Mode**. Right-click any channel or role and click **Copy ID**.

---

## 5. Bot-Hosting.net Deployment Steps

1. **Repository Connection**:
   - Link your GitHub repository: `https://github.com/Parhamnayeri/g4xcommunity`.
   - Branch: `main`.
2. **Node Runtime Selection**:
   - Choose Node.js 22 LTS (or Node.js 20+).
3. **Persistent Storage (Crucial for SQLite)**:
   - Ensure the `data/` directory is mapped to a persistent volume so that database files are not lost on container restarts.
4. **Build & Startup Commands**:
   - **Build Command**: `npm ci && npx prisma generate && npm run build`
   - **Database Migration**: `npx prisma migrate deploy`
   - **Startup Command**: `npm start` (executes `node dist/index.js`)
   > ⚠️ **IMPORTANT**: Never run `prisma migrate dev`, `prisma migrate reset`, or `prisma db push` on the production server. Use `npx prisma migrate deploy` only.
5. **Environment Configuration**:
   - Populate all variables from Section 2 in the Bot-Hosting.net Environment Variables tab.
   - Ensure `ESCROW_RELEASE_ENABLED=false`.

### 5.1 One-Time Initial Owner Bootstrap (Required for `G4!setup registration`)
When deploying to a fresh database on Bot-Hosting.net, no user initially holds the `owner` role, which causes `G4!setup registration` to return `Permission Denied`.
Execute the secure, one-time bootstrap script in the host console:

```bash
# In Bot-Hosting.net Terminal / Console:
npm run bootstrap:owner -- <YOUR_DISCORD_USER_ID>

# Or directly with ts-node:
npx ts-node scripts/bootstrap-owner.ts <YOUR_DISCORD_USER_ID>
```

**Security Guarantees:**
- Validates the numeric Discord Snowflake format (17-20 digits).
- **Single-Owner Lock**: Once an Owner is established, any attempt to register a different owner is strictly blocked (`BOOTSTRAP_LOCKED`).
- **Idempotent**: Safely returns if the same owner is re-specified.
- Automatically assigns the `owner` role in the database, granting `SERVICE_CONFIG_MANAGE` permissions.
- Logs the action in `audit_logs` (`INITIAL_OWNER_BOOTSTRAP`) without logging secrets.

---

## 6. Local Development & Testing Instructions (Windows PowerShell)

Follow these steps to run and test locally:

```powershell
# 1. Install dependencies cleanly
npm ci

# 2. Generate Prisma Client
npx prisma generate

# 3. Apply migrations to the development database
npx prisma migrate deploy

# 4. Typecheck the codebase
npx tsc --noEmit

# 5. Run automated test suites
npm run test:security
npm run test:escrow
npm run test:integrity
npm run test:domain
npm run test:permissions
npm run test:registration

# 6. Build production bundle
npm run build

# 7. Start in development mode
npm run dev
```

---

## 7. Operational Testing of Registration Workflow

1. In your Discord server's `#registration` channel, send:
   ```
   G4!setup registration
   ```
   *(Ensure your Discord account has an Owner or Manager role assigned in the database)*
2. Verify the persistent panel is created with 4 buttons:
   - 🗡️ Register as Booster
   - ✈️ Apply for Pilot
   - 📢 Become an Advertiser
   - 💱 Become an Exchanger
3. Test submitting an application:
   - Click **Register as Booster**.
   - Select **World of Warcraft Midnight**.
   - Fill in character details and experience.
   - Verify the ephemeral success message appears.
4. Test administrative review:
   - In `#application-reviews`, verify the review card appears with `Approve`, `Reject`, and `Request Info` buttons.
   - Click **Approve**.
   - Verify the database record updates to `approved` and the Discord role is synchronized.

---

## 8. Backup & Recovery Procedures

### Creating a Backup
```powershell
# Windows PowerShell:
Copy-Item "data\g4x_dev.db" "data\backups\g4x_backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').db"

# Linux / Host Container:
cp data/g4x_dev.db data/backups/g4x_backup_$(date +%s).db
```

### Restoring from Backup
1. Stop the bot process (`npm stop` or stop container).
2. Replace `data/g4x_dev.db` with your verified backup copy.
3. Run `npx prisma migrate deploy` to ensure any newer migrations are applied safely.
4. Restart the bot (`npm start`).

---

## 9. Finance V2 Architecture & Clean Database Safety

G4X Community Finance V2 is a clean redesign of the financial domain. Because the project has already deployed historical migrations on Bot-Hosting.net, historical migration integrity is strictly preserved.

### 9.1 Core Financial Architectural Invariants
1. **Unified USD Wallet (`wallets_v2`)**:
   - All internal wallet balances are denominated strictly in **integer USD cents**.
   - No parallel internal balances for USDT, IRT, TRY, or WoW Gold exist.
   - Six distinct, auditable balance fields: `availableCents`, `reservedCents`, `pendingEarningsCents`, `confirmedEarningsCents`, `paidCents`, `refundedCents`.
   - SQLite CHECK constraint (`wallets_v2_positive_balances_check`) strictly prevents negative balances.
2. **WoW Gold Removed as Financial Currency**:
   - WoW Gold exists solely as in-game trade quantities within Advertiser Gold Exchange trade orders.
   - No Gold wallet balance is created or maintained.
3. **Advertiser Funding Workflows**:
   - **Direct USDT**: Recorded under admin verification with approved 1:1 USD valuation; credited only upon verified receipt.
   - **Direct IRT**: Admin sets USD/IRT rate manually; currency-purchase fee rate must be explicitly approved and configured (no unauthorized 5% default); credited with exact integer arithmetic.
   - **Gold Exchange Workflow**: Dedicated trade order; in-game trade completed and evidence verified; external payment confirmed.
   - **Strict Safeguard**: Automatic wallet credits from Gold Exchange remain strictly blocked (`GOLD_EXCHANGE_DIRECTION_UNAPPROVED`) pending owner business confirmation on payment and delivery direction.
4. **SkyCoach 10% Fee Policy**:
   - The old 5% + $5 flat fee is retired.
   - Approved new policy: 10% per order assessed at order creation.
   - Batch reconciliation treats batch fee as $0 so 10% is never double-counted; external $0.30 BNB transfer expense is recorded separately.
5. **Deterministic Equal Booster Pool Split**:
   - 100% of the booster pool after authorized fees belongs to eligible boosters.
   - Mythic+ (4 boosters): exact equal split with Largest Remainder Method in minor units.
   - Single booster: 100% to participant. No leader bonus; no lost cents.
6. **G4X-Published Boost 7 Release Stages & 24h Countdown**:
   - Stages: `RUN_COMPLETED` -> `PROOF_SUBMITTED` -> `STAFF_REVIEW` -> `ADMIN_FINAL_APPROVED` -> `HOLD_24_HOURS` -> `ELIGIBLE_FOR_RELEASE` -> `AVAILABLE`.
   - The 24-hour hold begins strictly at `adminFinalApprovedAt`.
   - Applies strictly to G4X-published boosts (`creatorType === 'g4x'`); other orders are excluded.
   - Production safety switch `ESCROW_RELEASE_ENABLED=false` blocks actual automated balance releases.
7. **Booster Withdrawals**:
   - **USDT**: BEP-20 only; strict EIP-55 EVM address validation; fixed fee $0.40; Net USD = Requested - $0.40; manual payout with transaction hash.
   - **IRT**: Fixed fee $1.30; Effective Rate = Admin Rate - 3,000 IRT; Net IRT = `(Requested USD - $1.30) * Effective Rate`; no percentage fee.
   - **Scheduling**: Saturday 08:00 to Tuesday morning cutoff paid on Wednesday; after cutoff paid on Saturday using Tehran timezone (`Asia/Tehran`). Missing Tuesday cutoff config blocks automated scheduling finalization.

### 9.2 Legacy Table Isolation
- Legacy tables (`wallets`, `ledger_transactions`, `platform_fee_policies`) are preserved and retired from active execution paths to maintain complete migration history on Bot-Hosting.net.
- Never use `prisma migrate reset` or `prisma db push` on production.
- Always use `npx prisma migrate deploy`.

---

## 10. Disposable Development / Test Database Guide

To validate migrations or execute tests without modifying the live SQLite database (`data/g4x_dev.db`), use a disposable database:

```powershell
# 1. Set environment variable to a disposable database file
$env:DATABASE_URL="file:./data/disposable_test.db"

# 2. Deploy migrations from scratch to the disposable database
npx prisma migrate deploy

# 3. Run all test suites against the disposable database
npm run test:security
npm run test:escrow
npm run test:integrity
npm run test:domain
npm run test:permissions
npm run test:registration
npm run test:recovery
npm run test:bootstrap
npm run test:channels
npm test

# 4. Clean up disposable database after validation
Remove-Item -Path "data\disposable_test.db" -Force -ErrorAction SilentlyContinue
Remove-Item -Path "data\disposable_test.db-journal" -Force -ErrorAction SilentlyContinue

# 5. Restore standard development database environment variable
$env:DATABASE_URL="file:../data/g4x_dev.db"
```

---

## 11. Security, Privacy & Archive Export Procedures

### 11.1 Safe Clean Source Export Procedure
To share source code for external audit or review without inadvertently leaking secrets, database records, or local development git histories:

```bash
# Run the automated clean-source exporter:
npm run export:clean-source
```

This script:
1. Creates a clean, timestamped archive in `export/g4x-community-clean-source-<timestamp>.zip`.
2. Strictly excludes:
   - All environment files (`.env`, `.env.local`, `.env.production`)
   - All SQLite database files and backups (`*.db`, `*.db-journal`, `*.sqlite`, `data/backups/`)
   - Version control metadata (`.git/`)
   - Build outputs (`dist/`) and dependencies (`node_modules/`)
   - Temporary artifacts, cache, and IDE folders (`.agents/`, `.gemini/`, `.vscode/`)

### 11.2 Credential Rotation Checklist
If any source distribution archive previously exposed sensitive configuration files, follow this emergency rotation protocol immediately:
1. **Discord Bot Token**:
   - Navigate to Discord Developer Portal -> Bot -> Click **Reset Token**.
   - Update `DISCORD_BOT_TOKEN` in host environment variables.
2. **Discord OAuth2 Client Secret**:
   - Navigate to Discord Developer Portal -> OAuth2 -> Click **Reset Secret**.
   - Update `DISCORD_CLIENT_SECRET` in host environment variables.
3. **Session Secret**:
   - Generate a new 64-character high-entropy secret (`openssl rand -hex 32`).
   - Update `SESSION_SECRET` in host environment variables to invalidate any existing web sessions.
4. **Administrative Credentials**:
   - Rotate any admin portal passwords or database access credentials.
5. **Verify Bot Startup**:
   - Restart the application and verify clean connection without authentication errors.

### 11.3 Database Restoration Caution
> ⚠️ **CRITICAL WARNING**:
> Never blindly restore a stale SQLite backup over a running production database that contains recent user registrations, financial transactions, or audit logs. Restoring a stale backup will irrevocably overwrite all state changes that occurred after the backup timestamp. If recovery is required, extract and replay specific records using transactional migration scripts rather than wholesale file replacement.


