/**
 * frontend/src/types/discordCommands.ts — Type definitions for Discord Commands Guide
 */

export type CommandType =
  | 'text_command'
  | 'button_interaction'
  | 'modal_form'
  | 'select_menu_wizard';

export type CommandCategory =
  | 'orders'
  | 'setup'
  | 'teams'
  | 'profile'
  | 'proofs'
  | 'interactive';

export interface CommandParameter {
  name: string;
  type: 'string' | 'number' | 'user_mention' | 'attachment' | 'choice';
  required: boolean;
  description: string;
  allowedValues?: string[];
  defaultValue?: string;
}

export interface CommandExample {
  command: string;
  description: string;
  contextNote?: string;
}

export interface CommandCommonError {
  error: string;
  cause: string;
  resolution: string;
}

export interface DiscordCommandItem {
  id: string;
  name: string;
  category: CommandCategory;
  type: CommandType;
  syntax: string;
  summary: string;
  description: string;
  channelContext: string;
  requiredRoles: string[];
  requiredPermission?: string;
  parameters: CommandParameter[];
  examples: CommandExample[];
  commonErrors: CommandCommonError[];
  notes?: string;
}

export interface CategoryMetadata {
  id: string;
  label: string;
  description: string;
  count: number;
}

export interface DiscordCommandsResponse {
  success: boolean;
  userRoles: string[];
  categories: CategoryMetadata[];
  totalPermitted: number;
  commands: DiscordCommandItem[];
  meta: {
    isOwner: boolean;
    isAdmin: boolean;
    isManager: boolean;
    isStaff: boolean;
    isAdvertiser: boolean;
    isExchanger: boolean;
  };
}
