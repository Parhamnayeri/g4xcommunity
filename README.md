# G4X Community — Discord Bot & Operations Platform

An enterprise-grade, security-focused community platform and Discord bot for gaming services, built with TypeScript, Node.js 22 LTS, Discord.js v14, Express, Prisma ORM, and SQLite.

---

## 🛡️ Key Features

- **Centralized Permission & Authorization**: Role-based access control (Owner, Manager, Admin, Staff, Booster, Pilot, Advertiser, Exchanger) with strict audit logging.
- **Discord Registration Workflows (Phase 3.2)**:
  - Booster registration with live Raider.IO profile integration.
  - Pilot booster registration with privacy-preserving identity verification.
  - Advertiser registration with management-controlled commissions.
  - Exchanger registration supporting multiple in-game currencies (WoW Gold, POE2 Divine, Aion 2) and external settlement (IRT, USDT, TRY).
- **Interactive Discord UI**: Ephemeral multi-step menus, modals, and private administrative review cards.
- **Safe Escrow Engine**: Strict 72-hour holding period with financial dispute and proof protections (`ESCROW_RELEASE_ENABLED=false`).
- **Resilient Accounting**: Integer-based minor monetary units with non-negative database CHECK constraints.

---

## 🚀 Quick Start (Local Development)

### 1. Prerequisites
- Node.js 20+ (Node.js 22 LTS recommended)
- npm 10+
- SQLite

### 2. Setup
```powershell
# Clone the repository
git clone https://github.com/Parhamnayeri/g4xcommunity.git
cd g4xcommunity

# Install dependencies
npm ci

# Configure environment
cp .env.example .env
# Edit .env with your Discord bot tokens and channel IDs

# Generate Prisma Client & apply migrations
npx prisma generate
npx prisma migrate deploy

# Initial Owner Bootstrap (One-time, grants Owner role to your Discord ID)
npm run bootstrap:owner -- <YOUR_DISCORD_USER_ID>

# Run the test suites
npm run test:bootstrap
npm run test:registration

# Start development server
npm run dev
```

---

## 🧪 Automated Test Suites

| Command | Focus Area | Scenarios |
|---|---|---|
| `npm run test:bootstrap` | Initial Owner bootstrap, Snowflake check, lock | 8 Passed |
| `npm run test:security` | Web authentication, CSRF, session isolation | 17 Passed |
| `npm run test:escrow` | Escrow 72h holding period, holds, disputes | 17 Passed |
| `npm run test:integrity` | Wallet balance checks, ledger conservation | 14 Passed |
| `npm run test:domain` | Orders, claims, reservations, run transitions | 22 Passed |
| `npm run test:permissions` | Centralized RBAC, ownership, fail-closed auth | 25 Passed |
| `npm run test:registration`| Discord registration workflows, modals, reviews | 22 Passed |

---

## 📖 Deployment Guide

For full Bot-Hosting.net deployment instructions, environment variables, Discord permission setup, and backup procedures, refer to:
👉 **[Deployment Guide](docs/DEPLOYMENT.md)**

---

## 📄 License & Restrictions
Proprietary — Internal use for G4X Community only.
All escrow release features are disabled by default (`ESCROW_RELEASE_ENABLED=false`).
