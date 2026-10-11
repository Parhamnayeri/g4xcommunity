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
| `PORT` | Web server listening port | `3000` (or host assigned) | Dev & Prod |
| `NODE_ENV` | Environment mode | `production` | Prod |
| `WEB_BASE_URL` | Canonical public URL of the web server | `https://g4x.online` | Dev & Prod |
| `SESSION_SECRET` | Strong random string (min 64 chars) | *Cryptographic secret* | Dev & Prod |
| `DISCORD_REDIRECT_URI` | OAuth2 callback redirect URL | `https://g4x.online/auth/callback` | Dev & Prod |
| `DATABASE_URL` | SQLite database file URI | `file:../data/g4x_dev.db` | Dev & Prod |
| `ESCROW_RELEASE_ENABLED`| Automatic escrow settlement switch | **`false`** (Must remain false) | Dev & Prod |
| `ESCROW_RELEASE_HOURS` | Escrow holding period | `72` | Dev & Prod |
| `PLATFORM_FEE_RATE` | Platform fee fraction | `0.10` | Dev & Prod |
| `DEFAULT_COMMISSION_RATE` | Default commission rate | `0.15` | Dev & Prod |
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
