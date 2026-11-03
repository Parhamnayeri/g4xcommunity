import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import { PublicLayout } from './components/layout/PublicLayout';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { LandingPage } from './pages/LandingPage';
import { RulesPage } from './pages/RulesPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { DashboardPage } from './pages/DashboardPage';
import { WithdrawPage } from './pages/WithdrawPage';
import { AdvertiserPage } from './pages/AdvertiserPage';
import { WalletPage } from './pages/WalletPage';
import { ExchangePage } from './pages/ExchangePage';
import { ExchangerPage } from './pages/ExchangerPage';
import { LegacyTransitionPage } from './pages/LegacyTransitionPage';

import { StaffPage } from './pages/StaffPage';
import { ManagementPage } from './pages/ManagementPage';
import { KycManagementPage } from './pages/KycManagementPage';
import { AdminPage } from './pages/AdminPage';
import { OwnerPage } from './pages/OwnerPage';

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
            <Route path="/wallet" element={<WalletPage />} />
            <Route path="/withdraw" element={<WithdrawPage />} />
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
            <Route path="/advertiser" element={<AdvertiserPage />} />
            <Route path="/exchange" element={<ExchangePage />} />
            <Route path="/exchanger" element={<ExchangerPage />} />

            {/* Operations Routes — Website Phase 7 */}
            <Route path="/staff" element={<StaffPage />} />
            <Route path="/management" element={<ManagementPage />} />
            <Route path="/management/kyc" element={<KycManagementPage />} />

            {/* Admin Operations Portal — Website Phase 8 */}
            <Route path="/admin" element={<AdminPage />} />

            {/* Owner Executive Portal — Website Phase 8 */}
            <Route path="/owner" element={<OwnerPage />} />
            <Route path="/owner/finance" element={<OwnerPage />} />
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
