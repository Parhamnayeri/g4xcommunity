# G4X Community — Safe Live Discord Lab Integration Guide

## 1. Overview & Current Status

In Stage 3, a completely isolated, fail-closed **Safe Live Discord Lab Integration Test Mode** has been architected and prepared.

> [!IMPORTANT]
> **Safety Status:** The bot has **NOT** been connected to live Discord. No real Discord connection has been started. All existing staging and CI tests continue running against mock adapters with 100% isolation.

This architecture enables the operator to safely test Discord bot commands and interactions inside the dedicated **"G4X Staging Lab"** Discord server without any risk of affecting production, live users, real orders, or financial balances.

---

## 2. Rigid Isolation Invariants

The Discord Lab mode enforces eight hard fail-closed invariants:

1. **Local Machine & Loopback Binding Only**:
   - Web API server is strictly bound to `127.0.0.1` (or `::1`).
   - Binding to public interfaces (`0.0.0.0`, external IPs) is rejected immediately.
2. **Dedicated Test Guild Allowlist (`DISCORD_LAB_ALLOWED_GUILD_ID`)**:
   - An explicit allowlist containing **exactly one** valid Discord snowflake ID (17–20 digits) is mandatory.
   - The bot fails closed if the guild ID is missing, a placeholder, or invalid.
   - The bot verifies upon connection that it is a member of the allowed guild. If joined to foreign guilds, it immediately terminates.
3. **Event Firewall & Direct Message Rejection**:
   - All incoming messages and interactions originating from foreign guilds or Direct Messages (DMs) are dropped immediately.
   - User-supplied guild arguments in commands cannot override authorization.
4. **Disposable Staging SQLite Database**:
   - Confined strictly to `<repoRoot>/prisma/staging/discord_lab_<timestamp>_<uuid>.db`.
   - Never targets production databases (`g4x.db`, `dev.db`, `production.db`).
   - Automatically migrated on startup and cleaned up on shutdown.
5. **Six Mandatory Financial & Synchronization Gates (Strictly `"false"`)**:
   - `ESCROW_RELEASE_ENABLED="false"`
   - `FINANCE_V2_LIVE_CREDITS_ENABLED="false"`
   - `FINANCE_V2_LIVE_PAYOUTS_ENABLED="false"`
   - `FINANCE_V2_P2P_SETTLEMENT_ENABLED="false"`
   - `NOWPAYMENTS_LIVE_COLLECTION_ENABLED="false"`
   - `RAIDERIO_LIVE_SYNC_ENABLED="false"`
   - Any value other than the exact string `"false"` (e.g. `"true"`, `"1"`, `undefined`) immediately halts the runner.
6. **Payment Gateways Disabled**:
   - `NOWPAYMENTS_MODE` must be `disabled` or `sandbox`. Live API keys are forbidden.
7. **Emergency Kill Switch**:
   - Polling watcher checks every 1,000ms for `.discord-lab.kill` or `DISCORD_LAB_KILL_SWITCH=true`.
   - Creation of the kill switch file immediately aborts execution, closes connections, and cleans up fixtures.
8. **Credential Security**:
   - Bot token must be stored exclusively in a local, git-ignored file outside the repository.
   - Secrets are masked (`***...***`) and never printed to terminal, logs, or reports.

---

## 3. Operator Setup Instructions

### Step 1: Create Your Local Git-Ignored Environment File

Copy the provided template to an external location (preferred) or a git-ignored file:

```bash
# Option A (Recommended): Outside repository
cp .env.discord-lab.example ../.env.discord-lab

# Option B: Inside repository (ignored by .env.* in .gitignore)
cp .env.discord-lab.example .env.discord-lab.local
```

### Step 2: Configure Staging Lab Identifiers

Edit your local file (`../.env.discord-lab` or `.env.discord-lab.local`) and provide:

```env
# Dedicated test server ID (G4X Staging Lab)
DISCORD_LAB_ALLOWED_GUILD_ID=123456789012345678

# Test bot Application ID (G4X Staging Bot)
DISCORD_LAB_APPLICATION_ID=123456789012345678

# Test bot token (NEVER paste this in chat or commit it)
DISCORD_LAB_BOT_TOKEN=your_test_bot_token_here
```

Ensure all six safety gates remain:
```env
ESCROW_RELEASE_ENABLED=false
FINANCE_V2_LIVE_CREDITS_ENABLED=false
FINANCE_V2_LIVE_PAYOUTS_ENABLED=false
FINANCE_V2_P2P_SETTLEMENT_ENABLED=false
NOWPAYMENTS_LIVE_COLLECTION_ENABLED=false
RAIDERIO_LIVE_SYNC_ENABLED=false
```

---

## 4. Execution Workflow

### 1. Run Preflight Safety Verification (Zero Discord Connection)

Before attempting any connection, verify that all safety dimensions and isolation invariants pass:

```bash
npm run discord-lab:preflight
```

If any gate, host binding, database path, or allowlist check fails, preflight exits with code `1` and details the exact violation.

### 2. Run Automated Safety Tests

Verify all 35 firewall, gate, kill switch, and allowlist unit/integration tests:

```bash
npm run test:discord-lab:safety
```

### 3. Dry-Run Check

Running the runner without explicit confirmation flags safely defaults to dry-run mode and prints readiness without connecting:

```bash
npm run discord-lab:start
```

### 4. Explicit Opt-In Live Connection (When Ready)

To initiate the live connection inside "G4X Staging Lab" once preflight is verified:

```bash
npm run discord-lab:start -- --start --confirm
```

---

## 5. Emergency Kill Switch

To immediately halt the Discord Lab runner at any time:

### Method 1: Create Kill Switch File
In the project directory or parent directory:
```bash
# On Windows PowerShell:
New-Item -ItemType File .discord-lab.kill

# On Linux/macOS:
touch .discord-lab.kill
```
The active watcher detects the file within 1 second, cleanly terminates Discord gateway connections, closes the web server, deletes disposable database files, and exits.

### Method 2: Reset Kill Switch
When ready to test again:
```bash
Remove-Item -Force .discord-lab.kill
```

---

## 6. Discord Gateway Intents Configuration

In the Discord Developer Portal under your application's **Bot** settings:

| Gateway Intent | Type | Required for Discord Lab? | Configuration in Portal |
| :--- | :--- | :--- | :--- |
| **Guilds** | Standard | Yes (channel/role structure) | Always enabled |
| **GuildMessages** | Standard | Yes (listening in test guild) | Always enabled |
| **GuildMessageReactions** | Standard | Yes (reactions on order cards) | Always enabled |
| **Message Content Intent** | **Privileged** | **Yes** (parsing `G4!` command prefix) | **MUST BE TOGGLED ON** |
| **Server Members Intent** | Privileged | **No (Removed)** | Leave OFF |
| **Presence Intent** | Privileged | **No** | Leave OFF |

> [!NOTE]
> `GuildMembers` intent has been explicitly removed from the test client to prevent `DisallowedIntents` crashes during startup. Only the **Message Content Intent** is privileged and required.

---

## 7. Deterministic State Machine

The runner lifecycle transitions strictly through these explicit states:

```
[BLOCKED] (Events rejected)
    │
    ▼ (Client connected to Discord)
[VERIFYING] (Check bot user ID & verify guilds.cache.size === 1)
    │
    ├─► Failure ──► [TERMINATED] (client.destroy(), zero commands dispatched)
    │
    ▼ Success
[VERIFIED]
    │
    ▼
[ACTIVE] (Firewall permits events matching allowed test guild)
    │
    ▼ (Kill switch / SIGINT / Error)
[SHUTTING_DOWN] ──► [TERMINATED] (Server closed, disposable DB cleaned)
```
