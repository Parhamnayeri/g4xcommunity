export interface GameService {
  id?: number;
  gameSlug: string;
  serviceKey: string;
  displayName: string;
  serviceMode: string;
  profileMode?: string;
  requiresPilotApproval?: boolean;
  description?: string | null;
  sortOrder?: number;
  isActive: boolean;
}

export interface Game {
  slug: string;
  displayName: string;
  serviceCategory: string; // 'non_pilot' | 'pilot' | 'both'
  description?: string | null;
  sortOrder?: number;
  isActive: boolean;
  services?: GameService[];
}

export interface PublicConfig {
  discordGuildId?: string;
  discordInviteUrl?: string;
  bookingDestination?: string;
  channels?: {
    orders?: string;
    becomeBooster?: string;
    becomeAdvertiser?: string;
    becomePilot?: string;
    becomeExchanger?: string;
  };
}
