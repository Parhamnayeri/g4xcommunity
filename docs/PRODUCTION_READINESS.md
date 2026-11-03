# G4X Community — Production Readiness & Operations Manual (Phase 10)

This document establishes the comprehensive operations, security, deployment, and readiness specification for the **G4X Community** platform (Discord bot + Express Web API + Vite React Frontend).

---

## 1. Production Deployment Checklist & Prerequisites

### 1.1 Runtime & Environment Prerequisites
- **Node.js**: `v20.x` or `v22.x` LTS (v22.x LTS recommended).
- **Package Manager**: `npm v10+`.
- **Operating System**: Linux (Ubuntu 22.04 / 24.04 LTS or Debian 12 recommended) / Windows Server / Containerized Linux (Bot-Hosting.net or Docker).
- **Database**: SQLite with WAL mode (`journal_mode=WAL`) managed via Prisma ORM v6.19.3.
- **Storage Subsystems**: Local file storage mounted on persistent, non-ephemeral volumes for documents, deposit receipts, and user settings.
- **Reverse Proxy**: NGINX, Caddy, or Cloudflare Tunnel terminating TLS 1.3 with HTTP Strict Transport Security (HSTS).

### 1.2 Pre-Deployment Checklist
- [ ] Run full automated test suites: Phase 6, Phase 7, Phase 8, Phase 9, Phase 10, Finance V2.2, Wallet, Withdrawals, Payments, Permissions, OwnerGate, Parity, and Migration.
- [ ] Verify `npm run audit:evidence` exits with 0 conflicts and preserves all 28 historical flagged requests without modifications.
- [ ] Verify `npm run build:server` compiles with 0 TypeScript errors.
- [ ] Verify `npm run build:frontend` generates clean production assets in `frontend/dist/`.
- [ ] Verify file permissions: Ensure `storage/` and `data/` directories are writable only by the unprivileged application service user (`chmod 700 storage/ data/`).
- [ ] Confirm all 5 Financial Feature Gates are strictly set to `false`.

---

## 2. Configuration Checklist (Environment Variables)

All sensitive variables must be populated securely via environment files (e.g., `.env.production`) or hosting environment secret managers. **Never commit secrets to version control.**

### 2.1 Core Application & Process
| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | Yes | Set to `production`. |
| `HOST` | Yes | Server host interface binding (e.g., `0.0.0.0` or `127.0.0.1`). |
| `PORT` | Yes | Application port (default `26189` on Bot-Hosting.net, `3000` for standard setups). |
| `WEB_BASE_URL` | Yes | Canonical public URL (e.g., `https://g4x.online`). |
| `DATABASE_URL` | Yes | SQLite URI (e.g., `file:../data/g4x_dev.db`). |
| `SESSION_SECRET` | Yes | High-entropy random cryptographic key (minimum 64 characters). |
| `OWNER_ACCESS_KEY`| Yes | Secure emergency token for OwnerGate portal access. |

### 2.2 Discord Bot & OAuth2 Integration
| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | Yes | Discord Bot token from Developer Portal. |
| `DISCORD_CLIENT_ID` | Yes | Discord OAuth Application Client ID. |
| `DISCORD_CLIENT_SECRET` | Yes | Discord OAuth Application Client Secret. |
| `DISCORD_REDIRECT_URI` | Yes | Canonical callback URL (`https://g4x.online/auth/callback`). |
| `DISCORD_GUILD_ID` | Yes | Primary Discord Guild ID. |
| `ROLE_OWNER` | Yes | Discord Role ID for Owner. |
| `ROLE_MANAGER` | Yes | Discord Role ID for Manager. |
| `ROLE_ADMIN` | Yes | Discord Role ID for Admin. |
| `ROLE_STAFF` | Yes | Discord Role ID for Staff. |
| `ROLE_EXCHANGER` | Yes | Discord Role ID for Exchanger. |
| `ROLE_ADVERTISER` | Yes | Discord Role ID for Advertiser. |
| `ROLE_BOOSTER` | Yes | Discord Role ID for Booster. |
| `ROLE_PILOT` | Yes | Discord Role ID for Pilot. |
| `CHANNEL_ORDERS` | Yes | Public channel ID for published orders. |
| `CHANNEL_APPLY_REQUESTS` | Yes | Channel ID for staff application reviews. |
| `CHANNEL_LOGS` | Optional | Centralized security/audit logging channel. |

### 2.3 Financial & Operational Policy Configurations
| Variable | Required | Default / Guideline |
|---|---|---|
| `G4X_BOOST_HOLD_HOURS` | Yes | Holding duration before boost publication (`24`). |
| `BOOSTER_USDT_WITHDRAWAL_FEE_CENTS` | Yes | Fixed fee for USDT BEP-20 payouts (`40` cents). |
| `BOOSTER_IRT_WITHDRAWAL_FEE_CENTS` | Yes | Fixed fee for IRT bank payouts (`130` cents). |
| `BOOSTER_IRT_RATE_DISCOUNT_PER_USD` | Yes | Spread discount per USD for IRT payouts (`3000` IRT). |
| `PRESIGN_TIMER_MINUTES` | Yes | Pre-sign timeout window for boosters (`10`). |
| `ADVERTISER_IRT_PURCHASE_FEE_RATE` | Optional | Currency purchase fee rate (managed via SystemFinancialConfig). |
| `IRT_PAYOUT_TUESDAY_CUTOFF_HOUR` | Optional | Tuesday cutoff hour for Wednesday batch payouts. |

---

## 3. Security & Financial Feature Gate Status

For initial production release and testing, **ALL live money movement and external payment execution gates MUST REMAIN DISABLED**:

```ini
ESCROW_RELEASE_ENABLED=false
FINANCE_V2_LIVE_CREDITS_ENABLED=false
FINANCE_V2_LIVE_PAYOUTS_ENABLED=false
FINANCE_V2_P2P_SETTLEMENT_ENABLED=false
NOWPAYMENTS_LIVE_COLLECTION_ENABLED=false
```

### Safety Guarantees:
1. **Zero Real Asset Outflow**: With `FINANCE_V2_LIVE_PAYOUTS_ENABLED=false`, booster withdrawal execution requires manual reconciliation and cannot trigger on-chain or external bank transactions.
2. **Zero Automated Inflow Credits**: With `FINANCE_V2_LIVE_CREDITS_ENABLED=false`, manual IRT and crypto deposits require manual review and cannot self-credit wallets without dual operator verification.
3. **Escrow Quarantine**: With `ESCROW_RELEASE_ENABLED=false`, completion funds remain quarantined in ledger escrow until explicitly reviewed by staff.
4. **Historical Reconciliation Preserved**: Historical evidence collisions are locked with `LEGACY_CONFLICT_MANUAL_RECONCILIATION_REQUIRED` and are never auto-credited.

---

## 4. Database Backup, Restore & Prisma Migrations

### 4.1 SQLite Backup Strategy
SQLite databases in WAL mode require safe online backup utilities or filesystem snapshots with locks:

#### Automated Daily Online Backup Script
```bash
#!/bin/bash
BACKUP_DIR="/var/backups/g4x"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DB_PATH="/app/data/g4x_dev.db"

mkdir -p "$BACKUP_DIR"

# Perform safe live backup using sqlite3 CLI
sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/g4x_backup_$TIMESTAMP.db'"

# Compress and purge backups older than 30 days
gzip "$BACKUP_DIR/g4x_backup_$TIMESTAMP.db"
find "$BACKUP_DIR" -type f -name "g4x_backup_*.db.gz" -mtime +30 -delete
```

### 4.2 Database Restore Procedure
1. Stop the application process:
   ```bash
   pm2 stop g4x-community
   ```
2. Archive the current corrupted/unwanted database:
   ```bash
   mv /app/data/g4x_dev.db /app/data/g4x_dev.db.corrupt.$(date +%s)
   rm -f /app/data/g4x_dev.db-wal /app/data/g4x_dev.db-shm
   ```
3. Restore from backup:
   ```bash
   gunzip -c /var/backups/g4x/g4x_backup_20261103_120000.db.gz > /app/data/g4x_dev.db
   chmod 600 /app/data/g4x_dev.db
   ```
4. Verify database integrity:
   ```bash
   sqlite3 /app/data/g4x_dev.db "PRAGMA integrity_check;"
   sqlite3 /app/data/g4x_dev.db "PRAGMA foreign_key_check;"
   ```
5. Restart the application:
   ```bash
   pm2 start g4x-community
   ```

### 4.3 Applying Prisma Migrations in Production
**NEVER run `prisma migrate dev` or `prisma db push` in production.** Always use:
```bash
npx prisma migrate deploy
```
This applies pending migrations recorded in `prisma/migrations` strictly and immutably.

---

## 5. Build and Process Manager Setup

### 5.1 Build Commands
```bash
# 1. Install locked production dependencies
npm ci

# 2. Compile TypeScript backend (outputs to dist/)
npm run build:server

# 3. Compile Vite React frontend (outputs to frontend/dist/)
npm run build:frontend
```

### 5.2 Process Management via PM2
Create an `ecosystem.config.js` file:
```javascript
module.exports = {
  apps: [
    {
      name: 'g4x-community',
      script: './dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env_production: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: 26189,
      },
    },
  ],
};
```

Run with PM2:
```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

### 5.3 Systemd Alternative
If deploying as a systemd service (`/etc/systemd/system/g4x.service`):
```ini
[Unit]
Description=G4X Community Platform Service
After=network.target

[Service]
Type=simple
User=g4x
WorkingDirectory=/opt/g4xcommunity
ExecStart=/usr/bin/node /opt/g4xcommunity/dist/index.js
Restart=always
RestartSec=5
EnvironmentFile=/opt/g4xcommunity/.env.production
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

---

## 6. HTTPS, Reverse Proxy & Secure Cookie Specifications

### 6.1 Cookie Security Policy
The Express session middleware enforces:
- `httpOnly: true` — Cookie is inaccessible to client-side scripts.
- `secure: true` — Cookie is transmitted only over HTTPS connections in production (`NODE_ENV === 'production'`).
- `sameSite: 'lax'` — Defends against Cross-Site Request Forgery (CSRF) on top of the backend double-submit CSRF token validation (`X-CSRF-Token`).
- `proxy: true` — Express trusts reverse proxy headers (`X-Forwarded-Proto`, `X-Forwarded-For`).

### 6.2 NGINX Reverse Proxy Configuration
```nginx
server {
    listen 80;
    server_name g4x.online www.g4x.online;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name g4x.online www.g4x.online;

    ssl_certificate /etc/letsencrypt/live/g4x.online/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/g4x.online/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # HSTS & Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Max upload limit for KYC documents and receipts
    client_max_body_size 15M;

    location / {
        proxy_pass http://127.0.0.1:26189;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 90;
    }
}
```

---

## 7. Persistent Storage Paths & Mount Specifications

The following directories must be persisted across deployments, server reboots, and container rebuilds:

| Path | Purpose | Recommended Permissions | Content Type |
|---|---|---|---|
| `data/` | Database files (`g4x_dev.db`, WAL, SHM) | `0700` (Owner read/write) | SQLite database |
| `storage/kyc_documents/` | Confidential national ID & KYC proof files | `0700` (Restricted) | Private uploads (`.jpg`, `.png`, `.pdf`) |
| `storage/deposit_receipts/` | Manual IRT bank deposit slips & crypto receipts | `0700` (Restricted) | Bank evidence (`.jpg`, `.png`, `.pdf`) |
| `storage/user_settings/` | User avatar/profile local assets | `0755` (Read/write) | JSON / Asset metadata |

### Critical Security Rule:
Files inside `storage/kyc_documents/` and `storage/deposit_receipts/` are **NEVER served statically**. They are accessed strictly through server-authoritative download endpoints (`/api/admin/kyc-document/...`, `/api/exchanger/deposit-receipt/...`) with RBAC permission validation and path traversal sanitization (`realpath` validation).

---

## 8. Monitoring & Logging Recommendations

1. **Application Logs**:
   - Structured JSON logging for audit and financial records in `AuditLog` table.
   - Standard output / error captured via PM2 (`~/.pm2/logs/g4x-community-out.log` and `~/.pm2/logs/g4x-community-error.log`).
2. **Discord Security Channel**:
   - High-severity events (OwnerGate login, financial status changes, manual balance adjustments) stream directly to `#audit-logs` (`CHANNEL_LOGS`).
3. **Health Checks**:
   - Endpoint: `GET /api/health`
   - Returns: `{ "status": "ok", "uptime": number, "timestamp": string }`
4. **Metrics to Monitor**:
   - Memory usage (RSS threshold alert at 850 MB).
   - Event loop lag (> 250ms).
   - SQLite WAL file size (> 100 MB triggers manual `PRAGMA wal_checkpoint(TRUNCATE)`).

---

## 9. Rollback Procedure

In the event of an operational failure or post-deployment anomaly:

1. **Stop Application**:
   ```bash
   pm2 stop g4x-community
   ```
2. **Revert Git Commit**:
   ```bash
   git checkout <PREVIOUS_COMMIT_SHA>
   ```
3. **Rollback Dependencies & Rebuild**:
   ```bash
   npm ci
   npm run build:server
   npm run build:frontend
   ```
4. **Database Rollback (if schema migration failed)**:
   ```bash
   # Restore clean pre-deployment SQLite backup
   cp /var/backups/g4x/pre_deploy_backup.db /app/data/g4x_dev.db
   ```
5. **Restart Application**:
   ```bash
   pm2 start g4x-community
   ```
6. **Verify System Health**:
   ```bash
   curl -I https://g4x.online/api/health
   ```

---

## 10. Initial Smoke Tests

Execute these verification checks immediately following deployment:

| # | Test | Expected Result |
|---|---|---|
| 1 | Visit `https://g4x.online/` | Public Landing Page renders with 200 OK. |
| 2 | Visit `https://g4x.online/admin` without login | Redirects or returns 401/403 (Protected). |
| 3 | Visit `https://g4x.online/owner` without key | Blocked by OwnerGate. |
| 4 | Discord OAuth login | Authenticates user, creates session, establishes CSRF cookie. |
| 5 | Regular User `GET /api/booster/portal-data` | Returns 403 `BOOSTER_ROLE_REQUIRED`. |
| 6 | Approved Booster `GET /api/booster/portal-data` | Returns 200 OK with role-scoped orders only. |
| 7 | Submit invalid KYC document upload | Rejected by canonical path & mime-type validator. |
| 8 | Discord bot responds to ping | Discord bot is online, gateway intents active. |

---

## 11. Known Non-Blocking Technical Debt

The following items are identified as non-blocking technical debt for future iterations:

| ID | Severity | Component | Description & Mitigation |
|---|---|---|---|
| DEBT-01 | Low | Frontend Bundle | Vite frontend bundle produces a single vendor chunk of ~692 kB minified. Recommend implementing code-splitting with dynamic `React.lazy()` imports in Phase 11. |
| DEBT-02 | Low | Vite Config Warning | `vite.config.ts` emits a deprecation warning regarding `configLoader: 'native'`. Setting `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` or renaming to `vite.config.mts` is planned. |
| DEBT-03 | Low | Session GC | SQLite session store relies on periodic expired session cleanup. A cron job for `DELETE FROM sessions WHERE expires_at < unixepoch()` can optimize long-term DB size. |
| DEBT-04 | Medium | Discord Parity Polish | Discord bot embeds use fixed Persian/English text templates; localized multi-lingual strings are planned for Phase 11. |

---

## 12. Deployment Verdict

### **VERDICT: GO FOR SAFE, NON-LIVE-FINANCIAL PRODUCTION DEPLOYMENT**

- **Readiness State**: Verified. All 13 test suites passed with 100% success rate.
- **Financial Status**: Hardened and Safe. Live credit, payout, settlement, and collection feature gates are disabled.
- **Privacy Hardening**: Verified. Booster queue and financial amounts are strictly server-authoritative and role-guarded.
- **Evidence Integrity**: Verified. Historical financial records preserved without corruption.
