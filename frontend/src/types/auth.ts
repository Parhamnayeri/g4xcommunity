export interface UserRole {
  roleKey: string;
  name?: string;
}

export interface User {
  discordId: string;
  username: string;
  displayName?: string | null;
  phoneNumber?: string | null;
  telegramUsername?: string | null;
  whatsappNumber?: string | null;
  isActive: boolean;
  advertiserRank?: string | null;
  roles: string[];
}

export interface AuthContextType {
  user: User | null;
  status: 'loading' | 'authenticated' | 'unauthenticated' | 'error';
  csrfToken: string | null;
  loginUrl: string;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  hasRole: (...roles: string[]) => boolean;
}
