/**
 * frontend/src/services/discordCommands.ts — API client for Discord Commands Guide
 */

import { apiRequest } from './api';
import { DiscordCommandsResponse } from '../types/discordCommands';

export async function fetchDiscordCommands(params?: {
  category?: string;
  type?: string;
  q?: string;
}): Promise<DiscordCommandsResponse> {
  const query = new URLSearchParams();
  if (params?.category && params.category !== 'all') {
    query.set('category', params.category);
  }
  if (params?.type && params.type !== 'all') {
    query.set('type', params.type);
  }
  if (params?.q) {
    query.set('q', params.q);
  }

  const qs = query.toString();
  const endpoint = qs ? `/api/discord-commands?${qs}` : '/api/discord-commands';
  return await apiRequest<DiscordCommandsResponse>(endpoint);
}
