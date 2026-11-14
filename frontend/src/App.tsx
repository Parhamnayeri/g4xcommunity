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
import { ApplicationsWorkspace, GamesWorkspace, ChannelsWorkspace } from './components/admin/NativeAdminModules';

import { StaffPage } from './pages/StaffPage';
import { ManagementPage } from './pages/ManagementPage';
import { KycManagementPage } from './pages/KycManagementPage';
import { AdminPage } from './pages/AdminPage';
import { OwnerPage } from './pages/OwnerPage';
import { ProfilePage } from './pages/ProfilePage';
import { ProfileKycPage } from './pages/ProfileKycPage';
import { BoosterSettingsPage } from './pages/BoosterSettingsPage';
import { DiscordCommandsPage } from './pages/DiscordCommandsPage';

import { RouteErrorBoundary } from './components/common/RouteErrorBoundary';

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Routes with Standard Header & Footer */}
          <Route element={<PublicLayout />}>
            <Route path="/" element={<RouteErrorBoundary routeName="Home"><LandingPage /></RouteErrorBoundary>} />
            <Route path="/rules" element={<RouteErrorBoundary routeName="Rules"><RulesPage /></RouteErrorBoundary>} />
            <Route path="/privacy" element={<RouteErrorBoundary routeName="Privacy Policy"><PrivacyPage /></RouteErrorBoundary>} />
          </Route>

          {/* Authenticated Routes with Member Dashboard Layout */}
          <Route element={<DashboardLayout />}>
            <Route path="/dashboard" element={<RouteErrorBoundary routeName="Dashboard"><DashboardPage /></RouteErrorBoundary>} />
            <Route path="/wallet" element={<RouteErrorBoundary routeName="Wallet"><WalletPage /></RouteErrorBoundary>} />
            <Route path="/withdraw" element={<RouteErrorBoundary routeName="Withdraw"><WithdrawPage /></RouteErrorBoundary>} />
            <Route path="/profile" element={<RouteErrorBoundary routeName="Profile"><ProfilePage /></RouteErrorBoundary>} />
            <Route path="/profile/kyc" element={<RouteErrorBoundary routeName="Identity Verification (KYC)"><ProfileKycPage /></RouteErrorBoundary>} />
            <Route path="/discord-commands" element={<RouteErrorBoundary routeName="Discord Commands"><DiscordCommandsPage /></RouteErrorBoundary>} />
            <Route path="/booster/settings" element={<RouteErrorBoundary routeName="Booster Settings"><BoosterSettingsPage /></RouteErrorBoundary>} />
            <Route path="/settings" element={<RouteErrorBoundary routeName="Settings"><BoosterSettingsPage /></RouteErrorBoundary>} />
            <Route path="/advertiser" element={<RouteErrorBoundary routeName="Advertiser"><AdvertiserPage /></RouteErrorBoundary>} />
            <Route path="/exchange" element={<RouteErrorBoundary routeName="Marketplace"><ExchangePage /></RouteErrorBoundary>} />
            <Route path="/exchanger" element={<RouteErrorBoundary routeName="Exchanger Portal"><ExchangerPage /></RouteErrorBoundary>} />

            {/* Operations Routes — Website Phase 7 */}
            <Route path="/orders" element={<RouteErrorBoundary routeName="Order Management"><ManagementPage defaultTab="orders" /></RouteErrorBoundary>} />
            <Route path="/staff" element={<RouteErrorBoundary routeName="Staff Operations"><StaffPage /></RouteErrorBoundary>} />
            <Route path="/management" element={<RouteErrorBoundary routeName="Management Portal"><ManagementPage /></RouteErrorBoundary>} />
            <Route path="/management/orders" element={<RouteErrorBoundary routeName="Order Management"><ManagementPage defaultTab="orders" /></RouteErrorBoundary>} />
            <Route path="/management/kyc" element={<RouteErrorBoundary routeName="KYC Management"><KycManagementPage /></RouteErrorBoundary>} />

            {/* Admin Operations Portal — Website Phase 8 */}
            <Route path="/admin" element={<RouteErrorBoundary routeName="Admin Portal"><AdminPage /></RouteErrorBoundary>} />

            <Route path="/management/applications" element={<RouteErrorBoundary routeName="Member Applications"><ApplicationsWorkspace /></RouteErrorBoundary>} />
            <Route path="/admin/applications" element={<RouteErrorBoundary routeName="Member Applications"><ApplicationsWorkspace /></RouteErrorBoundary>} />
            <Route path="/admin/games" element={<RouteErrorBoundary routeName="Game Registry"><GamesWorkspace /></RouteErrorBoundary>} />
            <Route path="/admin/discord" element={<RouteErrorBoundary routeName="Discord Channels"><ChannelsWorkspace /></RouteErrorBoundary>} />
            <Route path="/admin/orders" element={<RouteErrorBoundary routeName="Admin Orders"><AdminPage defaultTab="orders" /></RouteErrorBoundary>} />

            {/* Owner Executive Portal — Website Phase 8 */}
            <Route path="/owner" element={<RouteErrorBoundary routeName="Owner Portal"><OwnerPage /></RouteErrorBoundary>} />
            <Route path="/owner/orders" element={<RouteErrorBoundary routeName="Owner Orders"><OwnerPage defaultTab="orders" /></RouteErrorBoundary>} />
            <Route path="/owner/finance" element={<RouteErrorBoundary routeName="Owner Finance"><OwnerPage /></RouteErrorBoundary>} />
            <Route path="/owner/games" element={<RouteErrorBoundary routeName="Game Registry"><OwnerPage defaultTab="games" /></RouteErrorBoundary>} />
            <Route path="/owner/discord" element={<RouteErrorBoundary routeName="Discord Infrastructure"><OwnerPage defaultTab="discord" /></RouteErrorBoundary>} />
            <Route path="/owner/users" element={<RouteErrorBoundary routeName="User & Role Management"><OwnerPage defaultTab="users" /></RouteErrorBoundary>} />
            <Route path="/owner/website" element={<RouteErrorBoundary routeName="Website Configuration"><OwnerPage defaultTab="config" /></RouteErrorBoundary>} />
          </Route>

          {/* Legacy route redirects */}
          <Route path="/legacy" element={<Navigate to="/" replace />} />
          <Route path="/legacy/*" element={<Navigate to="/" replace />} />

          {/* Fallback for unmatched routes */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
};
export default App;
