import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import { PublicLayout } from './components/layout/PublicLayout';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { LandingPage } from './pages/LandingPage';
import { RulesPage } from './pages/RulesPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { DashboardPage } from './pages/DashboardPage';
import { LegacyTransitionPage } from './pages/LegacyTransitionPage';

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Routes with Standard Header & Footer */}
          <Route element={<PublicLayout />}>
            <Route path="/" element={<LandingPage />} />
            <Route path="/rules" element={<RulesPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
          </Route>

          {/* Authenticated Routes with Member Dashboard Layout */}
          <Route element={<DashboardLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route
              path="/wallet"
              element={
                <LegacyTransitionPage
                  moduleName="Unified USD Wallet & Ledger"
                  category="Authenticated"
                  description="Check your available USD balance, pending boost earnings, and double-entry transaction history."
                  legacyTab="wallet"
                />
              }
            />
            <Route
              path="/withdraw"
              element={
                <LegacyTransitionPage
                  moduleName="Booster Payout & Withdrawals"
                  category="Authenticated"
                  description="Submit and track manual withdrawal requests via USDT (BSC BEP-20) or Iranian Banking (IRT)."
                  legacyTab="withdraw"
                />
              }
            />
            <Route
              path="/profile"
              element={
                <LegacyTransitionPage
                  moduleName="User Profile & WoW Characters"
                  category="Authenticated"
                  description="Manage linked Blizzard Raider.IO characters, mythic scores, and contact preferences."
                  legacyTab="characters"
                />
              }
            />
            <Route
              path="/booster/settings"
              element={
                <LegacyTransitionPage
                  moduleName="Booster Settings"
                  category="Authenticated"
                  description="Configure boost game preferences, availability alerts, and Discord notifications."
                  legacyTab="settings"
                />
              }
            />
            <Route
              path="/advertiser"
              element={
                <LegacyTransitionPage
                  moduleName="Advertiser Workspace"
                  category="Authenticated"
                  description="Track submitted customer orders, advertiser rank tier, and commission earnings."
                  legacyTab="advertiser"
                />
              }
            />
            <Route
              path="/exchange"
              element={
                <LegacyTransitionPage
                  moduleName="Gold & Currency Exchange"
                  category="Authenticated"
                  description="Browse P2P gold orders, submit exchange offers, and trade securely in escrow."
                  legacyTab="gold"
                />
              }
            />
            <Route
              path="/exchanger"
              element={
                <LegacyTransitionPage
                  moduleName="Certified Exchanger Dashboard"
                  category="Authenticated"
                  description="Manage liquidity reserves, realm exchange rates, and verified trade payouts."
                  legacyTab="exchanger"
                />
              }
            />

            {/* Operations Routes */}
            <Route
              path="/staff"
              element={
                <LegacyTransitionPage
                  moduleName="Staff Operations"
                  category="Operations"
                  description="Review booster proofs, order presign countdowns, and customer disputes."
                  legacyTab="staff"
                />
              }
            />
            <Route
              path="/admin"
              element={
                <LegacyTransitionPage
                  moduleName="Administrative Center"
                  category="Operations"
                  description="Execute manual withdrawal payouts, approve published orders, and oversee platform reconciliations."
                  legacyTab="admin"
                />
              }
            />
            <Route
              path="/management"
              element={
                <LegacyTransitionPage
                  moduleName="Management Operations"
                  category="Operations"
                  description="Audit platform logs, oversee staff workflows, and monitor order lifecycles."
                  legacyTab="management"
                />
              }
            />
            <Route
              path="/management/kyc"
              element={
                <LegacyTransitionPage
                  moduleName="Identity & Pilot KYC Review"
                  category="Operations"
                  description="Verify pilot credentials, ID proofs, and contact details for high-stakes account handling."
                  legacyTab="kyc"
                />
              }
            />

            {/* Owner Routes */}
            <Route
              path="/owner"
              element={
                <LegacyTransitionPage
                  moduleName="Owner Executive Portal"
                  category="Owner"
                  description="Complete administrative oversight, system health diagnostics, and platform security."
                  legacyTab="owner"
                />
              }
            />
            <Route
              path="/owner/finance"
              element={
                <LegacyTransitionPage
                  moduleName="Financial Engine & Ledgers"
                  category="Owner"
                  description="Review external platform accounts, balance sheets, and double-entry reconciliation batches."
                  legacyTab="owner-finance"
                />
              }
            />
            <Route
              path="/owner/games"
              element={
                <LegacyTransitionPage
                  moduleName="Game & Service Registry"
                  category="Owner"
                  description="Configure supported games, active service categories, profile modes, and order publishing routes."
                  legacyTab="owner-games"
                />
              }
            />
            <Route
              path="/owner/discord"
              element={
                <LegacyTransitionPage
                  moduleName="Discord Infrastructure"
                  category="Owner"
                  description="Channel mappings, auto-provisioning, role assignments, and bot diagnostics."
                  legacyTab="owner-discord"
                />
              }
            />
            <Route
              path="/owner/users"
              element={
                <LegacyTransitionPage
                  moduleName="User & Role Management (RBAC)"
                  category="Owner"
                  description="Assign and revoke system roles, inspect audit histories, and manage member statuses."
                  legacyTab="owner-users"
                />
              }
            />
            <Route
              path="/owner/website"
              element={
                <LegacyTransitionPage
                  moduleName="Website Configuration"
                  category="Owner"
                  description="Landing page banners, announcement policies, and brand configurations."
                  legacyTab="owner-website"
                />
              }
            />
          </Route>

          {/* Fallback for unmatched routes */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
};
export default App;
