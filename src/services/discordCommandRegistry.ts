/**
 * src/services/discordCommandRegistry.ts — Authoritative Discord Bot Command & Interaction Registry
 *
 * G4X Community — Task 7: Private Role-Based Discord Commands Guide
 *
 * This registry documents actual, existing Discord bot commands and interactive workflows
 * discovered from the codebase (src/index.ts, src/commands/*.ts, src/interactions/*.ts).
 *
 * Rules:
 *  - Every command, subcommand, parameter, and interaction corresponds to real code.
 *  - No invented commands, synthetic flags, or speculative capabilities.
 *  - Strict role-based filtering: evaluated server-side.
 *  - Multi-role union support: users holding multiple roles receive the union of permitted commands.
 *  - Booster/Pilot-only users have zero access to this private guide.
 */

import { SystemRoleKey, Permission, ROLE_PERMISSIONS } from './permissionTypes';

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
  requiredRoles: SystemRoleKey[];
  requiredPermission?: Permission;
  parameters: CommandParameter[];
  examples: CommandExample[];
  commonErrors: CommandCommonError[];
  notes?: string;
}

export interface CategoryMetadata {
  id: CommandCategory | 'all';
  label: string;
  description: string;
  count: number;
}

/**
 * Authoritative registry of all real Discord commands and interactive workflows.
 */
export const DISCORD_COMMAND_REGISTRY: DiscordCommandItem[] = [
  // ─── 1. SETUP COMMANDS (Management / Admin / Owner) ─────────────────────────
  {
    id: 'setup-all',
    name: 'G4!setup all',
    category: 'setup',
    type: 'text_command',
    syntax: 'G4!setup all',
    summary: 'Auto-provision and synchronize all Discord server categories, channels, and permission overrides.',
    description:
      'Creates or reuses all authoritative Discord channels defined in the provisioning catalog. Configures channel permissions for roles, syncs channel IDs into the database mapping, and outputs a complete status report. Aliases: `G4!setup channels`, `G4!setup sync`.',
    channelContext: 'Discord Server (Guild) text channel with bot permissions',
    requiredRoles: ['manager', 'admin', 'owner'],
    requiredPermission: Permission.SERVICE_CONFIG_MANAGE,
    parameters: [],
    examples: [
      {
        command: 'G4!setup all',
        description: 'Provision and verify all server channels and database mappings.',
      },
      {
        command: 'G4!setup sync',
        description: 'Synchronize existing server channels without creating duplicates.',
      },
    ],
    commonErrors: [
      {
        error: 'Permission Denied: Only authorized management may provision or synchronize Discord channels.',
        cause: 'Actor lacks SERVICE_CONFIG_MANAGE permission.',
        resolution: 'Run command using an account assigned to Management, Admin, or Owner.',
      },
      {
        error: 'This command must be executed within a Discord server (guild).',
        cause: 'Command executed in direct messages (DM).',
        resolution: 'Run the command inside a guild text channel.',
      },
    ],
    notes: 'Idempotent: Safe to run repeatedly; reuses existing channels matching configured names.',
  },
  {
    id: 'setup-registration',
    name: 'G4!setup registration',
    category: 'setup',
    type: 'text_command',
    syntax: 'G4!setup registration',
    summary: 'Deploy or refresh the 2 registration categories and 8 dedicated workflow channels.',
    description:
      'Provisions the public `START HERE` category (#become-booster, #become-adv, #become-pilot-booster, #become-exchanger) with persistent interactive registration panels, and the private `APPLICATION MANAGEMENT` category (#app-boosters, #app-adv, #app-pilots, #app-exchangers) for staff review.',
    channelContext: 'Discord Server (Guild) text channel',
    requiredRoles: ['manager', 'admin', 'owner'],
    requiredPermission: Permission.SERVICE_CONFIG_MANAGE,
    parameters: [],
    examples: [
      {
        command: 'G4!setup registration',
        description: 'Deploy the full registration category and channel architecture.',
      },
    ],
    commonErrors: [
      {
        error: 'Permission Denied: Only authorized management may set up or update registration channels.',
        cause: 'Actor is not an authorized Manager, Admin, or Owner.',
        resolution: 'Request an administrator to configure server channels.',
      },
    ],
    notes: 'If an existing registration panel is found in the current channel, it is updated in-place.',
  },
  {
    id: 'setup-orders',
    name: 'G4!setup orders',
    category: 'setup',
    type: 'text_command',
    syntax: 'G4!setup orders',
    summary: 'Deploy or refresh 2 categories and 6 order creation panel channels.',
    description:
      'Creates the `G4X ORDERS` category (#wow_midnight_mythic, #non_pilot, #pilot) and `ADVERTISER ORDERS` category (#wow_midnight_mythic, #non_pilot, #pilot) equipped with persistent interactive buttons that launch the Order Creation Wizard. Aliases: `G4!setup order-panels`, `G4!setup order_panels`.',
    channelContext: 'Discord Server (Guild) text channel',
    requiredRoles: ['manager', 'admin', 'owner'],
    requiredPermission: Permission.SERVICE_CONFIG_MANAGE,
    parameters: [],
    examples: [
      {
        command: 'G4!setup orders',
        description: 'Deploy order creation panels for direct community and commercial advertiser orders.',
      },
    ],
    commonErrors: [
      {
        error: 'Permission Denied: Only authorized management may set up or update order creation panels.',
        cause: 'Actor lacks SERVICE_CONFIG_MANAGE permission.',
        resolution: 'Must be executed by Management, Admin, or Owner.',
      },
    ],
    notes: 'Buttons deployed in these channels persist across bot reboots and launch modal wizards.',
  },
  {
    id: 'setup-publications',
    name: 'G4!setup publications',
    category: 'setup',
    type: 'text_command',
    syntax: 'G4!setup publications',
    summary: 'Deploy game-specific order publication channels and database routing.',
    description:
      'Provisions dedicated order publication channels for WoW Midnight (#mythic_plus_boosts, #non_pilot_boosts, #pilot_boosts) and WoW Forever (#non_pilot_boosts, #pilot_boosts), recording authoritative channel routes in the database. Aliases: `G4!setup pub-channels`, `G4!setup routing`.',
    channelContext: 'Discord Server (Guild) text channel',
    requiredRoles: ['manager', 'admin', 'owner'],
    requiredPermission: Permission.SERVICE_CONFIG_MANAGE,
    parameters: [],
    examples: [
      {
        command: 'G4!setup publications',
        description: 'Deploy dedicated boost board channels and configure database routing.',
      },
    ],
    commonErrors: [
      {
        error: 'Permission Denied: Only authorized management may set up or update order publication channels.',
        cause: 'Actor lacks SERVICE_CONFIG_MANAGE permission.',
        resolution: 'Must be executed by Management, Admin, or Owner.',
      },
    ],
    notes: 'Published orders are automatically routed to these channels based on game slug and service mode.',
  },

  // ─── 2. ORDER COMMANDS (Advertiser, Staff, Management, Admin, Owner) ─────────
  {
    id: 'order-list',
    name: 'G4!order list',
    category: 'orders',
    type: 'text_command',
    syntax: 'G4!order list [game]',
    summary: 'List active, verified boost orders currently open for pre-signing.',
    description:
      'Queries open orders in status `open_presign` with verified payment. Displays order ID, reference, game, service, order mode, pre-signed candidate counts, and Mythic+ role slot breakdown (Tank, Healer, DPS).',
    channelContext: 'Any authorized Discord channel',
    requiredRoles: ['advertiser', 'staff', 'manager', 'admin', 'owner'],
    requiredPermission: Permission.ORDER_VIEW_PERMITTED,
    parameters: [
      {
        name: 'game',
        type: 'string',
        required: false,
        description: 'Game slug filter (e.g. wow_midnight, wow_forever).',
      },
    ],
    examples: [
      {
        command: 'G4!order list',
        description: 'List all open orders available across all games.',
      },
      {
        command: 'G4!order list wow_midnight',
        description: 'Filter open orders to WoW Midnight only.',
      },
    ],
    commonErrors: [
      {
        error: 'No open orders are currently available for pre-signing.',
        cause: 'No orders currently meet verified payment and open_presign criteria.',
        resolution: 'Check back later or inspect pending draft orders with G4!order manage.',
      },
    ],
  },
  {
    id: 'order-view',
    name: 'G4!order view',
    category: 'orders',
    type: 'text_command',
    syntax: 'G4!order view <orderId>',
    summary: 'View full details, source platform, economics, and applicant roster of an order.',
    description:
      'Displays order reference, game, service, lifecycle status, mode, run counts, source platform (Community vs Advertiser vs External G2G/SkyCoach/Eldorado), gross economics, booster pool, pre-signed applicants, and active booster assignments.',
    channelContext: 'Any authorized Discord channel',
    requiredRoles: ['advertiser', 'staff', 'manager', 'admin', 'owner'],
    requiredPermission: Permission.ORDER_VIEW_PERMITTED,
    parameters: [
      {
        name: 'orderId',
        type: 'number',
        required: true,
        description: 'Authoritative numeric order ID or alphanumeric orderRef.',
      },
    ],
    examples: [
      {
        command: 'G4!order view 1820',
        description: 'View full status and roster for Order #1820.',
      },
      {
        command: 'G4!order view ORD_1710000000_ABCD',
        description: 'View order details using external reference string.',
      },
    ],
    commonErrors: [
      {
        error: 'Order `<query>` not found.',
        cause: 'No order in the database matches the provided ID or reference.',
        resolution: 'Verify the order ID using G4!order list.',
      },
    ],
  },
  {
    id: 'order-create',
    name: 'G4!order create',
    category: 'orders',
    type: 'text_command',
    syntax: 'G4!order create <gameSlug> <serviceId> <amountUsd> [orderType] [notes...]',
    summary: 'Create a new direct boost order with automatic wallet funding check. (Advertiser & Management)',
    description:
      'Validates game slug and service ID. If the creator has sufficient available balance in WalletV2, the funds are debited and reserved into escrow immediately, and the order is published. If balance is insufficient, the order is created as an unpaid draft in `payment_pending` status. Aliases: `G4!order adv-create`.',
    channelContext: 'Any authorized Discord channel',
    requiredRoles: ['advertiser', 'manager', 'admin', 'owner'],
    requiredPermission: Permission.ORDER_CREATE_ADVERTISER,
    parameters: [
      {
        name: 'gameSlug',
        type: 'string',
        required: true,
        description: 'Slug of supported game (e.g. wow_midnight).',
      },
      {
        name: 'serviceId',
        type: 'number',
        required: true,
        description: 'Numeric service ID configured in database.',
      },
      {
        name: 'amountUsd',
        type: 'number',
        required: true,
        description: 'Gross order amount in US dollars.',
      },
      {
        name: 'orderType',
        type: 'string',
        required: false,
        defaultValue: 'group',
        allowedValues: ['group', 'solo'],
        description: 'Execution type (group squad vs solo booster).',
      },
      {
        name: 'notes',
        type: 'string',
        required: false,
        description: 'Operational notes, key level, dungeon requirements.',
      },
    ],
    examples: [
      {
        command: 'G4!order create wow_midnight 1 50 group Fast M+ 10-12 Push',
        description: 'Create a $50 WoW Midnight Mythic+ group order.',
      },
    ],
    commonErrors: [
      {
        error: 'Permission Denied: Only authorized Advertisers and Management may create orders.',
        cause: 'Actor lacks ORDER_CREATE_INTERNAL and ORDER_CREATE_ADVERTISER permissions.',
        resolution: 'Must hold approved Advertiser or Management role.',
      },
      {
        error: 'Unresolved Commercial Rank: Advertiser does not have an approved commercial rank.',
        cause: 'Advertiser user record does not have an approved advertiserRank set by admin.',
        resolution: 'Contact an Administrator to assign your approved commercial tier.',
      },
    ],
    notes: 'Unpaid draft orders cannot accept booster pre-signs or claims until funded.',
  },
  {
    id: 'order-ext-create',
    name: 'G4!order ext-create',
    category: 'orders',
    type: 'text_command',
    syntax: 'G4!order ext-create <gameSlug> <serviceId> <amountUsd> <platform> [accountRef] [gross|net] [orderType] [notes...]',
    summary: 'Create an externally sourced commercial order (G2G, SkyCoach, Eldorado). (Management only)',
    description:
      'Creates an order originating from third-party marketplace channels. Captures commercial source platform, platform seller account reference, seller fee policy snapshot, and input basis (gross sale vs net proceeds).',
    channelContext: 'Any authorized Discord channel',
    requiredRoles: ['manager', 'admin', 'owner'],
    requiredPermission: Permission.ORDER_CREATE_INTERNAL,
    parameters: [
      {
        name: 'gameSlug',
        type: 'string',
        required: true,
        description: 'Game slug (e.g. wow_midnight).',
      },
      {
        name: 'serviceId',
        type: 'number',
        required: true,
        description: 'Service ID.',
      },
      {
        name: 'amountUsd',
        type: 'number',
        required: true,
        description: 'Order amount in USD.',
      },
      {
        name: 'platform',
        type: 'choice',
        required: true,
        allowedValues: ['g2g', 'skycoach', 'eldorado'],
        description: 'External marketplace platform.',
      },
      {
        name: 'accountRef',
        type: 'string',
        required: false,
        description: 'Platform account identifier (e.g. g2g_main).',
      },
      {
        name: 'basis',
        type: 'choice',
        required: false,
        defaultValue: 'gross',
        allowedValues: ['gross', 'net'],
        description: 'Amount basis: gross sale or platform net after marketplace commission.',
      },
      {
        name: 'orderType',
        type: 'string',
        required: false,
        defaultValue: 'group',
        description: 'Execution mode.',
      },
      {
        name: 'notes',
        type: 'string',
        required: false,
        description: 'External order ID or customer notes.',
      },
    ],
    examples: [
      {
        command: 'G4!order ext-create wow_midnight 1 65 g2g g2g_main gross group G2G #9982342 M+10',
        description: 'Create an external G2G group order from gross sale amount.',
      },
    ],
    commonErrors: [
      {
        error: 'Missing Arguments: Supported platforms: g2g, skycoach, eldorado',
        cause: 'Required arguments missing or invalid platform identifier.',
        resolution: 'Provide all required parameters matching the specified syntax.',
      },
    ],
  },
  {
    id: 'order-manage',
    name: 'G4!order manage',
    category: 'orders',
    type: 'text_command',
    syntax: 'G4!order manage <orderId>',
    summary: 'Inspect lifecycle diagnostics, publication eligibility, and authorized next actions.',
    description:
      'Provides a deep diagnostic view of an order: funding status, wallet balance, active receipt references, publication blockers, and valid administrative actions.',
    channelContext: 'Any authorized Discord channel',
    requiredRoles: ['staff', 'manager', 'admin', 'owner'],
    requiredPermission: Permission.ORDER_VIEW_PERMITTED,
    parameters: [
      {
        name: 'orderId',
        type: 'number',
        required: true,
        description: 'Numeric order ID.',
      },
    ],
    examples: [
      {
        command: 'G4!order manage 1820',
        description: 'Inspect lifecycle diagnostics and publication eligibility for Order #1820.',
      },
    ],
    commonErrors: [
      {
        error: 'Invalid Order ID.',
        cause: 'Order ID parameter is non-numeric or missing.',
        resolution: 'Provide a valid numeric order ID.',
      },
    ],
  },
  {
    id: 'order-funding',
    name: 'G4!order funding',
    category: 'orders',
    type: 'text_command',
    syntax: 'G4!order funding <orderId>',
    summary: 'Check funding status, creator wallet balance, and active payment receipt evidence.',
    description:
      'Inspects whether an order has sufficient creator wallet balance, active payment requests, or verified payment receipts.',
    channelContext: 'Any authorized Discord channel',
    requiredRoles: ['advertiser', 'staff', 'manager', 'admin', 'owner'],
    requiredPermission: Permission.ORDER_VIEW_PERMITTED,
    parameters: [
      {
        name: 'orderId',
        type: 'number',
        required: true,
        description: 'Numeric order ID.',
      },
    ],
    examples: [
      {
        command: 'G4!order funding 1820',
        description: 'Inspect payment status and wallet backing for Order #1820.',
      },
    ],
    commonErrors: [],
  },
  {
    id: 'order-pay-wallet',
    name: 'G4!order pay-wallet',
    category: 'orders',
    type: 'text_command',
    syntax: 'G4!order pay-wallet <orderId>',
    summary: 'Fund an unpaid order from creator available USD wallet balance and publish to board.',
    description:
      'Atomically reserves gross funds from the creator available balance in WalletV2 into escrow, updates payment status to `verified`, sets order status to `open_presign`, and publishes the order card to Discord.',
    channelContext: 'Any authorized Discord channel',
    requiredRoles: ['advertiser', 'manager', 'admin', 'owner'],
    requiredPermission: Permission.ORDER_CREATE_ADVERTISER,
    parameters: [
      {
        name: 'orderId',
        type: 'number',
        required: true,
        description: 'Numeric order ID.',
      },
    ],
    examples: [
      {
        command: 'G4!order pay-wallet 1820',
        description: 'Fund Order #1820 from available wallet balance.',
      },
    ],
    commonErrors: [
      {
        error: 'Insufficient wallet balance.',
        cause: 'Creator available USD wallet balance is lower than the order gross amount.',
        resolution: 'Deposit funds to wallet or use G4!order verify-payment with external receipt.',
      },
    ],
  },
  {
    id: 'order-publish',
    name: 'G4!order publish',
    category: 'orders',
    type: 'text_command',
    syntax: 'G4!order publish <orderId>',
    summary: 'Publish an eligible, verified order to the Discord Orders Board. (Management only)',
    description:
      'Authoritatively verifies that payment is confirmed and routes the order card with interactive pre-signing buttons to the designated channel.',
    channelContext: 'Any authorized Discord channel',
    requiredRoles: ['manager', 'admin', 'owner'],
    requiredPermission: Permission.ORDER_PUBLISH,
    parameters: [
      {
        name: 'orderId',
        type: 'number',
        required: true,
        description: 'Numeric order ID.',
      },
    ],
    examples: [
      {
        command: 'G4!order publish 1820',
        description: 'Publish verified Order #1820 to the public order board.',
      },
    ],
    commonErrors: [
      {
        error: 'Publication Denied: Order payment must be verified before publication.',
        cause: 'Order is still in payment_pending status.',
        resolution: 'Fund order via pay-wallet or verify-payment before publishing.',
      },
    ],
  },
  {
    id: 'order-verify-payment',
    name: 'G4!order verify-payment',
    category: 'orders',
    type: 'text_command',
    syntax: 'G4!order verify-payment <orderId> <receiptRef>',
    summary: 'Verify order payment using an authoritative PaymentReceipt reference. (Admin & Owner only)',
    description:
      'Verifies that a real PaymentReceipt exists, has matching amount, is unconsumed, and transitions the order to verified status. Synthetic approvals without receipt evidence are rejected.',
    channelContext: 'Any authorized Discord channel',
    requiredRoles: ['admin', 'owner'],
    requiredPermission: Permission.ORDER_PAYMENT_VERIFY,
    parameters: [
      {
        name: 'orderId',
        type: 'number',
        required: true,
        description: 'Numeric order ID.',
      },
      {
        name: 'receiptRef',
        type: 'string',
        required: true,
        description: 'Authoritative payment receipt reference (e.g. REC_1710000000_ABCD).',
      },
    ],
    examples: [
      {
        command: 'G4!order verify-payment 1820 REC_1710000000_ABCD',
        description: 'Verify payment for Order #1820 using verified crypto or bank receipt.',
      },
    ],
    commonErrors: [
      {
        error: 'Permission Denied: You lack ORDER_PAYMENT_VERIFY permission.',
        cause: 'Actor is not an Admin or Owner.',
        resolution: 'Action restricted to Admin and Owner roles.',
      },
      {
        error: 'Payment receipt not found or already consumed.',
        cause: 'Receipt reference does not exist or has been applied to another order.',
        resolution: 'Provide a valid, unconsumed payment receipt.',
      },
    ],
  },
  {
    id: 'order-cancel',
    name: 'G4!order cancel',
    category: 'orders',
    type: 'text_command',
    syntax: 'G4!order cancel <orderId> [reason...]',
    summary: 'Cancel an order, release reserved funds, and archive execution channels. (Creator & Management)',
    description:
      'Cancels an active or open boost order, releases all active reservations/funds back to the creator wallet, logs audit entries, and archives private execution channels.',
    channelContext: 'Any authorized Discord channel',
    requiredRoles: ['advertiser', 'manager', 'admin', 'owner'],
    requiredPermission: Permission.ORDER_CANCEL,
    parameters: [
      {
        name: 'orderId',
        type: 'number',
        required: true,
        description: 'Numeric order ID.',
      },
      {
        name: 'reason',
        type: 'string',
        required: false,
        defaultValue: 'Cancelled via Discord command',
        description: 'Cancellation reason for audit log.',
      },
    ],
    examples: [
      {
        command: 'G4!order cancel 1820 Customer requested full refund',
        description: 'Cancel Order #1820 with audit explanation.',
      },
    ],
    commonErrors: [
      {
        error: 'Cancellation Failed: Order is in completed or disputed status.',
        cause: 'Orders with completed runs or active disputes cannot be directly cancelled.',
        resolution: 'Resolve active disputes in the management portal first.',
      },
    ],
  },
  {
    id: 'order-help',
    name: 'G4!order help',
    category: 'orders',
    type: 'text_command',
    syntax: 'G4!order help',
    summary: 'Display the complete Boost Orders command reference and usage help menu.',
    description:
      'Returns an embed summarizing order commands: list, view, manage, funding, pay-wallet, verify-payment, publish, create, ext-create, and cancel.',
    channelContext: 'Any Discord channel',
    requiredRoles: ['advertiser', 'staff', 'manager', 'admin', 'owner'],
    requiredPermission: Permission.ORDER_VIEW_PERMITTED,
    parameters: [],
    examples: [
      {
        command: 'G4!order help',
        description: 'View order commands help menu.',
      },
    ],
    commonErrors: [],
  },

  // ─── 3. ASSIGN COMMAND (Advertiser for own orders, Management, Admin, Owner) ─
  {
    id: 'assign-command',
    name: 'G4!assign',
    category: 'orders',
    type: 'text_command',
    syntax: 'G4!assign <orderId> <participants...>',
    summary: 'Assign individual boosters or premade squads to an open order and provision execution channel.',
    description:
      'Enforces order creator or management RBAC. Resolves individual `@User` mentions and `team:<id>` premade squad tokens. Validates qualification, pre-sign registration, absence of duplicate bookings, and exact Mythic+ role matching (1 Tank, 1 Healer, 2 DPS) via backtracking. Automatically provisions private channel `order-{orderId}-{mode}`.',
    channelContext: 'Any authorized Discord channel',
    requiredRoles: ['advertiser', 'manager', 'admin', 'owner'],
    requiredPermission: Permission.ORDER_ASSIGN,
    parameters: [
      {
        name: 'orderId',
        type: 'number',
        required: true,
        description: 'Numeric order ID (e.g. 1820 or #1820).',
      },
      {
        name: 'participants',
        type: 'string',
        required: true,
        description: 'Space-separated list of @User mentions or team:<id> references (minimum 1, exactly 4 for Mythic+).',
      },
    ],
    examples: [
      {
        command: 'G4!assign 1820 @Booster1 @Booster2 @Booster3 @Booster4',
        description: 'Assign 4 pre-signed individuals to Order #1820.',
      },
      {
        command: 'G4!assign #1820 team:42',
        description: 'Assign a full 4-player premade squad (Team #42).',
      },
      {
        command: 'G4!assign 1820 team:42 @Booster3 @Booster4',
        description: 'Assign a duo squad plus 2 individual boosters.',
      },
    ],
    commonErrors: [
      {
        error: 'Permission Denied: Only the legitimate order creator or authorized staff can assign orders.',
        cause: 'Actor is an advertiser attempting to assign someone else order, or lacks ORDER_ASSIGN.',
        resolution: 'Advertisers may only assign their own orders; staff/management may assign any order.',
      },
      {
        error: 'Role assignment mismatch: Could not satisfy 1 Tank, 1 Healer, 2 DPS.',
        cause: 'The selected participants cannot cover all required Mythic+ roles.',
        resolution: 'Select participants who pre-signed for the missing roles.',
      },
      {
        error: 'Duplicate Participant: Booster @User is specified more than once.',
        cause: 'A user is mentioned twice or is part of a team and mentioned individually.',
        resolution: 'Ensure all 4 participants are distinct Discord accounts.',
      },
    ],
  },

  // ─── 4. PROOF COMMAND & EXECUTION CHANNEL (Assigned Boosters, Staff, Mgmt) ──
  {
    id: 'proof-upload',
    name: 'G4!proof',
    category: 'proofs',
    type: 'text_command',
    syntax: 'G4!proof [notes...]',
    summary: 'Submit completion screenshot evidence directly inside the private execution channel.',
    description:
      'Directly uploads a completion screenshot inside an active private execution channel (`order-{orderId}-{mode}`). Validates image format (PNG/JPEG/WEBP/GIF, max 10MB), records Discord provenance (message ID, channel ID, author ID), creates a RunProof record, and notifies Staff reviewers.',
    channelContext: 'Private Order Execution Channel ONLY (`order-{orderId}-{mode}`)',
    requiredRoles: ['advertiser', 'staff', 'manager', 'admin', 'owner'],
    requiredPermission: Permission.PROOF_SUBMIT_ASSIGNED,
    parameters: [
      {
        name: 'attachment',
        type: 'attachment',
        required: true,
        description: 'Screenshot file attached to the Discord message.',
      },
      {
        name: 'notes',
        type: 'string',
        required: false,
        description: 'Optional dungeon completion time, key level, or score notes.',
      },
    ],
    examples: [
      {
        command: 'G4!proof +12 Neltharus completed in time 24:15',
        description: 'Post with image attachment inside order-1820-mythicplus.',
      },
    ],
    commonErrors: [
      {
        error: 'Proof must be submitted directly inside the private execution channel.',
        cause: 'Command executed outside the authoritative private execution channel for the order.',
        resolution: 'Navigate to the dedicated order execution channel and re-submit.',
      },
      {
        error: 'Attachment Error: File type is not supported.',
        cause: 'Attached file is not a supported image format.',
        resolution: 'Attach a PNG, JPEG, WEBP, or GIF image under 10 MB.',
      },
    ],
  },

  // ─── 5. PROFILE & CHARACTER COMMANDS (All authorized roles) ─────────────────
  {
    id: 'profile-view',
    name: 'G4!profile',
    category: 'profile',
    type: 'text_command',
    syntax: 'G4!profile [@user]',
    summary: 'Display booster profile, qualification status, main character, and squad memberships.',
    description:
      'Shows user roles, booster qualification status, main WoW character stats (Mythic+ score, class, spec, item level, Raider.IO link), and squad participation. Includes interactive buttons to refresh Raider.IO data.',
    channelContext: 'Any Discord channel',
    requiredRoles: ['advertiser', 'exchanger', 'staff', 'manager', 'admin', 'owner'],
    parameters: [
      {
        name: 'user',
        type: 'user_mention',
        required: false,
        description: 'Target user mention to inspect (defaults to self).',
      },
    ],
    examples: [
      {
        command: 'G4!profile',
        description: 'View your own profile, main character, and qualification status.',
      },
      {
        command: 'G4!profile @Booster',
        description: 'Inspect another member public profile and character stats.',
      },
    ],
    commonErrors: [],
  },
  {
    id: 'profile-add-char',
    name: 'G4!profile add-char',
    category: 'profile',
    type: 'text_command',
    syntax: 'G4!profile add-char [region] <realm> <characterName>',
    summary: 'Register a World of Warcraft character with automatic Raider.IO sync.',
    description:
      'Registers a WoW character for your profile. Automatically queries Raider.IO API for character class, spec, item level, and Mythic+ score breakdown (overall, tank, healer, dps).',
    channelContext: 'Any Discord channel',
    requiredRoles: ['advertiser', 'exchanger', 'staff', 'manager', 'admin', 'owner'],
    parameters: [
      {
        name: 'region',
        type: 'choice',
        required: false,
        defaultValue: 'eu',
        allowedValues: ['eu', 'us', 'kr', 'tw', 'cn'],
        description: 'WoW game region.',
      },
      {
        name: 'realm',
        type: 'string',
        required: true,
        description: 'Realm slug or name (e.g. tarren-mill, twisting-nether).',
      },
      {
        name: 'characterName',
        type: 'string',
        required: true,
        description: 'Character name.',
      },
    ],
    examples: [
      {
        command: 'G4!profile add-char tarren-mill Arthas',
        description: 'Add European realm character (default region: eu).',
      },
      {
        command: 'G4!profile add-char us illidan Illidari',
        description: 'Add North American character specifying region explicitly.',
      },
    ],
    commonErrors: [
      {
        error: 'Failed to add character: Character not found on Raider.IO.',
        cause: 'Character name or realm spelling is incorrect or not indexed.',
        resolution: 'Verify realm and character name spelling on Raider.IO.',
      },
    ],
  },
  {
    id: 'profile-characters',
    name: 'G4!profile characters',
    category: 'profile',
    type: 'text_command',
    syntax: 'G4!profile characters',
    summary: 'List all registered WoW characters, main status, and Mythic+ scores. Aliases: chars, list.',
    description:
      'Displays a clean summary of all active characters associated with your Discord account, highlighting your Main Character and displaying class, spec, realm, and score.',
    channelContext: 'Any Discord channel',
    requiredRoles: ['advertiser', 'exchanger', 'staff', 'manager', 'admin', 'owner'],
    parameters: [],
    examples: [
      {
        command: 'G4!profile characters',
        description: 'View list of all your registered characters.',
      },
    ],
    commonErrors: [],
  },
  {
    id: 'profile-set-main',
    name: 'G4!profile set-main',
    category: 'profile',
    type: 'text_command',
    syntax: 'G4!profile set-main <id | characterName>',
    summary: 'Set your primary/main character for pre-signs and profile displays.',
    description:
      'Designates a character as your Main Character. The main character is displayed on your profile card and used as the default character when pre-signing for boost orders.',
    channelContext: 'Any Discord channel',
    requiredRoles: ['advertiser', 'exchanger', 'staff', 'manager', 'admin', 'owner'],
    parameters: [
      {
        name: 'target',
        type: 'string',
        required: true,
        description: 'Character numeric database ID or character name.',
      },
    ],
    examples: [
      {
        command: 'G4!profile set-main Arthas',
        description: 'Set Arthas as your primary character.',
      },
    ],
    commonErrors: [],
  },
  {
    id: 'profile-sync',
    name: 'G4!profile sync',
    category: 'profile',
    type: 'text_command',
    syntax: 'G4!profile sync [id | characterName]',
    summary: 'Re-sync character stats, item level, and Mythic+ score from Raider.IO.',
    description:
      'Pulls the latest progression data from Raider.IO. If no character is specified, synchronizes your main character.',
    channelContext: 'Any Discord channel',
    requiredRoles: ['advertiser', 'exchanger', 'staff', 'manager', 'admin', 'owner'],
    parameters: [
      {
        name: 'target',
        type: 'string',
        required: false,
        description: 'Character ID or name to refresh (defaults to Main).',
      },
    ],
    examples: [
      {
        command: 'G4!profile sync',
        description: 'Refresh Raider.IO stats for your main character.',
      },
    ],
    commonErrors: [],
  },
  {
    id: 'profile-remove-char',
    name: 'G4!profile remove-char',
    category: 'profile',
    type: 'text_command',
    syntax: 'G4!profile remove-char <id | characterName>',
    summary: 'Deactivate or remove a character from your roster. Aliases: del-char.',
    description:
      'Safely marks a character as inactive in your roster. Preserves historical assignment and run logs for audit integrity.',
    channelContext: 'Any Discord channel',
    requiredRoles: ['advertiser', 'exchanger', 'staff', 'manager', 'admin', 'owner'],
    parameters: [
      {
        name: 'target',
        type: 'string',
        required: true,
        description: 'Character ID or name to remove.',
      },
    ],
    examples: [
      {
        command: 'G4!profile remove-char Arthas',
        description: 'Remove Arthas from your active character list.',
      },
    ],
    commonErrors: [],
  },

  // ─── 6. PREMADE SQUAD COMMANDS (All authorized roles) ───────────────────────
  {
    id: 'team-create',
    name: 'G4!team create',
    category: 'teams',
    type: 'text_command',
    syntax: 'G4!team create <teamName> [duo|trio|full]',
    summary: 'Create and register a new premade squad for joint pre-signing.',
    description:
      'Registers a premade squad. Capacity options: `duo` (2 players), `trio` (3 players), `full` (4 players for Mythic+). The creator becomes the Squad Leader and can invite members.',
    channelContext: 'Any Discord channel',
    requiredRoles: ['advertiser', 'exchanger', 'staff', 'manager', 'admin', 'owner'],
    requiredPermission: Permission.SQUAD_MANAGE_OWN,
    parameters: [
      {
        name: 'teamName',
        type: 'string',
        required: true,
        description: 'Unique team name identifier.',
      },
      {
        name: 'squadType',
        type: 'choice',
        required: false,
        defaultValue: 'full',
        allowedValues: ['duo', 'trio', 'full'],
        description: 'Squad size: duo (2), trio (3), full (4).',
      },
    ],
    examples: [
      {
        command: 'G4!team create ApexMythic full',
        description: 'Create a 4-man premade squad named ApexMythic.',
      },
    ],
    commonErrors: [
      {
        error: 'Invalid squad type. Allowed options: duo, trio, full.',
        cause: 'Unsupported squad size token provided.',
        resolution: 'Specify duo, trio, or full.',
      },
    ],
  },
  {
    id: 'team-list',
    name: 'G4!team list',
    category: 'teams',
    type: 'text_command',
    syntax: 'G4!team list',
    summary: 'List all premade squads where you are leader or an accepted member.',
    description:
      'Shows active squad rosters, member roles (Tank, Healer, DPS, Flex), accepted member count, and pending invitations.',
    channelContext: 'Any Discord channel',
    requiredRoles: ['advertiser', 'exchanger', 'staff', 'manager', 'admin', 'owner'],
    parameters: [],
    examples: [
      {
        command: 'G4!team list',
        description: 'View all squads you participate in.',
      },
    ],
    commonErrors: [],
  },
  {
    id: 'team-invite',
    name: 'G4!team invite',
    category: 'teams',
    type: 'text_command',
    syntax: 'G4!team invite <teamName> <@user | userId> [role]',
    summary: 'Invite an approved booster to join your premade squad. (Leader only)',
    description:
      'Sends an invitation to a booster. Roles: `tank`, `healer`, `dps`, `flex`. Target user can accept via interactive buttons or G4!team accept.',
    channelContext: 'Any Discord channel',
    requiredRoles: ['advertiser', 'exchanger', 'staff', 'manager', 'admin', 'owner'],
    requiredPermission: Permission.SQUAD_MANAGE_OWN,
    parameters: [
      {
        name: 'teamName',
        type: 'string',
        required: true,
        description: 'Name of the squad you lead.',
      },
      {
        name: 'user',
        type: 'user_mention',
        required: true,
        description: 'Discord user mention or user ID.',
      },
      {
        name: 'role',
        type: 'choice',
        required: false,
        defaultValue: 'dps',
        allowedValues: ['tank', 'healer', 'dps', 'flex'],
        description: 'Designated role for the member.',
      },
    ],
    examples: [
      {
        command: 'G4!team invite ApexMythic @Booster healer',
        description: 'Invite a healer to join ApexMythic.',
      },
    ],
    commonErrors: [
      {
        error: 'Target user is not an approved booster.',
        cause: 'User must be qualified and active to join premade squads.',
        resolution: 'User must complete booster registration first.',
      },
    ],
  },
  {
    id: 'team-accept',
    name: 'G4!team accept',
    category: 'teams',
    type: 'text_command',
    syntax: 'G4!team accept <teamName>',
    summary: 'Accept a pending squad invitation to confirm joint participation.',
    description:
      'Confirms your membership in the squad. Once all members have accepted, the squad leader can pre-sign the entire team for boost orders.',
    channelContext: 'Any Discord channel',
    requiredRoles: ['advertiser', 'exchanger', 'staff', 'manager', 'admin', 'owner'],
    parameters: [
      {
        name: 'teamName',
        type: 'string',
        required: true,
        description: 'Squad name.',
      },
    ],
    examples: [
      {
        command: 'G4!team accept ApexMythic',
        description: 'Accept invitation to join ApexMythic.',
      },
    ],
    commonErrors: [],
  },
  {
    id: 'team-decline',
    name: 'G4!team decline',
    category: 'teams',
    type: 'text_command',
    syntax: 'G4!team decline <teamName>',
    summary: 'Decline a pending squad invitation.',
    description: 'Declines an invitation and removes the pending invite record.',
    channelContext: 'Any Discord channel',
    requiredRoles: ['advertiser', 'exchanger', 'staff', 'manager', 'admin', 'owner'],
    parameters: [
      {
        name: 'teamName',
        type: 'string',
        required: true,
        description: 'Squad name.',
      },
    ],
    examples: [
      {
        command: 'G4!team decline ApexMythic',
        description: 'Decline invitation to ApexMythic.',
      },
    ],
    commonErrors: [],
  },
  {
    id: 'team-leave',
    name: 'G4!team leave',
    category: 'teams',
    type: 'text_command',
    syntax: 'G4!team leave <teamName>',
    summary: 'Leave a squad with automatic leadership transfer if leader.',
    description:
      'Removes yourself from a squad roster. If you are the leader and other accepted members exist, leadership transfers to the senior member.',
    channelContext: 'Any Discord channel',
    requiredRoles: ['advertiser', 'exchanger', 'staff', 'manager', 'admin', 'owner'],
    parameters: [
      {
        name: 'teamName',
        type: 'string',
        required: true,
        description: 'Squad name.',
      },
    ],
    examples: [
      {
        command: 'G4!team leave ApexMythic',
        description: 'Leave team ApexMythic.',
      },
    ],
    commonErrors: [],
  },
  {
    id: 'team-disband',
    name: 'G4!team disband',
    category: 'teams',
    type: 'text_command',
    syntax: 'G4!team disband <teamName>',
    summary: 'Disband a premade squad. (Squad Leader only)',
    description: 'Disbands the squad and releases all member associations.',
    channelContext: 'Any Discord channel',
    requiredRoles: ['advertiser', 'exchanger', 'staff', 'manager', 'admin', 'owner'],
    requiredPermission: Permission.SQUAD_MANAGE_OWN,
    parameters: [
      {
        name: 'teamName',
        type: 'string',
        required: true,
        description: 'Squad name.',
      },
    ],
    examples: [
      {
        command: 'G4!team disband ApexMythic',
        description: 'Disband ApexMythic squad.',
      },
    ],
    commonErrors: [],
  },
  {
    id: 'team-info',
    name: 'G4!team info',
    category: 'teams',
    type: 'text_command',
    syntax: 'G4!team info <teamName>',
    summary: 'View detailed squad roster, member roles, and status. Aliases: view.',
    description: 'Displays team roster, members, characters, accepted roles, and invitation status.',
    channelContext: 'Any Discord channel',
    requiredRoles: ['advertiser', 'exchanger', 'staff', 'manager', 'admin', 'owner'],
    parameters: [
      {
        name: 'teamName',
        type: 'string',
        required: true,
        description: 'Squad name.',
      },
    ],
    examples: [
      {
        command: 'G4!team info ApexMythic',
        description: 'Inspect ApexMythic roster.',
      },
    ],
    commonErrors: [],
  },

  // ─── 7. INTERACTIVE WORKFLOWS & PANELS ──────────────────────────────────────
  {
    id: 'wizard-order-create',
    name: 'Order Creation Wizard',
    category: 'interactive',
    type: 'select_menu_wizard',
    syntax: 'Click [Create Order] in #wow_midnight_mythic or #pilot -> Follow Step Wizard',
    summary: 'Multi-step dropdown and modal wizard for creating direct or external boost orders.',
    description:
      'Initiated from persistent buttons in order channels. Flow A (Management): Select platform (G4X Direct vs G2G/SkyCoach/Eldorado) -> Game -> Service -> Mode -> Fill modal. Flow B (Advertisers): Game -> Service -> Mode -> Fill modal. Enforces commercial rank commissions and session protection.',
    channelContext: 'Order Creation Channels (`#wow_midnight_mythic`, `#non_pilot`, `#pilot`)',
    requiredRoles: ['advertiser', 'manager', 'admin', 'owner'],
    requiredPermission: Permission.ORDER_CREATE_ADVERTISER,
    parameters: [
      {
        name: 'Platform',
        type: 'choice',
        required: true,
        description: 'Commercial origin: Direct Community or external marketplace.',
      },
      {
        name: 'Service Details Modal',
        type: 'string',
        required: true,
        description: 'Modal inputs for key level, character credentials (pilot), notes, and gross pricing.',
      },
    ],
    examples: [
      {
        command: 'Click "Create Order" button in #wow_midnight_mythic',
        description: 'Launches ephemeral interactive wizard menu.',
      },
    ],
    commonErrors: [
      {
        error: 'Wizard session expired.',
        cause: 'Interactions must be completed within 15 minutes.',
        resolution: 'Click Create Order to start a fresh wizard session.',
      },
    ],
  },
  {
    id: 'presign-buttons-card',
    name: 'Order Card Pre-Signing & Squad Claim',
    category: 'interactive',
    type: 'button_interaction',
    syntax: 'Click [Tank], [Healer], [DPS], or [Premade Team] on published order card',
    summary: 'Public order card interactive buttons for booster pre-signing and squad formation.',
    description:
      'Boosters click role buttons on public order cards to register interest. Keystone owners can toggle keystone contribution. Squad leaders click Premade Team to register their entire active roster. Withdraw button removes registration.',
    channelContext: 'Order Publication Channels (`#mythic_plus_boosts`, `#non_pilot_boosts`, `#pilot_boosts`)',
    requiredRoles: ['advertiser', 'staff', 'manager', 'admin', 'owner'],
    parameters: [
      {
        name: 'Role Button',
        type: 'choice',
        required: true,
        allowedValues: ['Tank', 'Healer', 'DPS', 'Premade Team', 'Keystone Owner', 'Withdraw'],
        description: 'Interactive button selection.',
      },
    ],
    examples: [
      {
        command: 'Click "🛡️ Tank" on Order #1820 Card',
        description: 'Pre-sign for the Tank slot on Order #1820.',
      },
    ],
    commonErrors: [
      {
        error: 'You are not approved as a booster for this game.',
        cause: 'User lacks approved game qualification status.',
        resolution: 'Apply in #become-booster and await staff approval.',
      },
    ],
    notes: 'Claims remain strictly Discord-only; no web buttons exist or are permitted.',
  },
  {
    id: 'execution-channel-controls',
    name: 'Private Execution Channel Controls',
    category: 'interactive',
    type: 'button_interaction',
    syntax: 'Click [Submit Proof] or [Complete Run] inside order-{orderId}-{mode}',
    summary: 'Interactive coordination controls inside private execution channels.',
    description:
      'Inside private order channels (`order-{orderId}-{mode}`), assigned boosters click **Submit Proof** (opens modal for screenshot URL and completion time) or **Complete Run** (marks run finished and requests proof). Pings staff reviewers automatically.',
    channelContext: 'Private Order Execution Channel ONLY (`order-{orderId}-{mode}`)',
    requiredRoles: ['advertiser', 'staff', 'manager', 'admin', 'owner'],
    requiredPermission: Permission.PROOF_SUBMIT_ASSIGNED,
    parameters: [
      {
        name: 'Submit Proof Modal',
        type: 'string',
        required: true,
        description: 'Screenshot URL and completion description.',
      },
    ],
    examples: [
      {
        command: 'Click "📸 Submit Proof" inside #order-1820-mythicplus',
        description: 'Submits completion evidence via modal dialog.',
      },
    ],
    commonErrors: [
      {
        error: 'Unauthorized: Only assigned boosters can submit completion proof.',
        cause: 'Actor is not an actively assigned booster on this order.',
        resolution: 'Only assigned participants may submit proof.',
      },
    ],
  },
  {
    id: 'registration-review-panels',
    name: 'Registration & Application Review Panels',
    category: 'interactive',
    type: 'modal_form',
    syntax: 'Public: Click [Apply in #become-booster] | Management: Click [Approve / Reject] in #app-boosters',
    summary: 'Interactive application submission and staff review decision panels.',
    description:
      'Applicants submit application forms via modals in #become-booster, #become-adv, #become-exchanger. Review panels in #app-boosters, #app-adv render with one-click Approve, Reject, and Request Info buttons for management.',
    channelContext: 'Registration & Application Management Channels',
    requiredRoles: ['manager', 'admin', 'owner'],
    requiredPermission: Permission.BOOSTER_APPLICATION_REVIEW,
    parameters: [
      {
        name: 'Decision',
        type: 'choice',
        required: true,
        allowedValues: ['Approve', 'Reject', 'Request Information'],
        description: 'Management review action.',
      },
    ],
    examples: [
      {
        command: 'Click "✅ Approve" on Booster Application #42',
        description: 'Approves application and assigns booster Discord role.',
      },
    ],
    commonErrors: [],
  },
];

/**
 * Evaluates the union of permitted commands for an authenticated user holding specified roles.
 * Returns null if the user does NOT hold any authorized guide roles (e.g. Booster/Pilot only).
 */
export function getPermittedCommandsForRoles(
  userRoleKeys: string[]
): { commands: DiscordCommandItem[]; categories: CategoryMetadata[] } | null {
  const authorizedGuideRoles: SystemRoleKey[] = [
    'advertiser',
    'exchanger',
    'staff',
    'manager',
    'admin',
    'owner',
  ];

  // 1. Role Gate: Check if user has at least one authorized role
  const effectiveRoles = userRoleKeys.filter((r): r is SystemRoleKey =>
    authorizedGuideRoles.includes(r as SystemRoleKey)
  );

  if (effectiveRoles.length === 0) {
    return null; // Denied: Booster/Pilot-only or unauthenticated
  }

  const isOwner = effectiveRoles.includes('owner');
  const isAdmin = effectiveRoles.includes('admin');
  const isManager = effectiveRoles.includes('manager');
  const isStaff = effectiveRoles.includes('staff');
  const isAdvertiser = effectiveRoles.includes('advertiser');
  const isExchanger = effectiveRoles.includes('exchanger');

  // 2. Filter commands by checking if any of the user's active roles permit the command (True Role Union)
  const permittedMap = new Map<string, DiscordCommandItem>();

  for (const cmd of DISCORD_COMMAND_REGISTRY) {
    if (isOwner) {
      permittedMap.set(cmd.id, cmd);
      continue;
    }

    if (isAdmin) {
      permittedMap.set(cmd.id, cmd);
      continue;
    }

    if (isManager && cmd.id !== 'order-verify-payment') {
      permittedMap.set(cmd.id, cmd);
      continue;
    }

    // Role-specific whitelist checks for union
    const advertiserAllowed = [
      'order-create',
      'order-list',
      'order-view',
      'order-funding',
      'order-pay-wallet',
      'order-cancel',
      'order-help',
      'assign-command',
      'proof-upload',
      'profile-view',
      'profile-add-char',
      'profile-characters',
      'profile-set-main',
      'profile-sync',
      'profile-remove-char',
      'team-create',
      'team-list',
      'team-invite',
      'team-accept',
      'team-decline',
      'team-leave',
      'team-disband',
      'team-info',
      'wizard-order-create',
      'presign-buttons-card',
      'execution-channel-controls',
    ];
    if (isAdvertiser && advertiserAllowed.includes(cmd.id)) {
      permittedMap.set(cmd.id, cmd);
      continue;
    }

    const staffAllowed = [
      'order-list',
      'order-view',
      'order-manage',
      'order-funding',
      'order-help',
      'proof-upload',
      'profile-view',
      'profile-add-char',
      'profile-characters',
      'profile-set-main',
      'profile-sync',
      'profile-remove-char',
      'team-create',
      'team-list',
      'team-invite',
      'team-accept',
      'team-decline',
      'team-leave',
      'team-disband',
      'team-info',
      'presign-buttons-card',
      'execution-channel-controls',
    ];
    if (isStaff && staffAllowed.includes(cmd.id)) {
      permittedMap.set(cmd.id, cmd);
      continue;
    }

    const exchangerAllowed = [
      'profile-view',
      'profile-add-char',
      'profile-characters',
      'profile-set-main',
      'profile-sync',
      'profile-remove-char',
      'team-create',
      'team-list',
      'team-invite',
      'team-accept',
      'team-decline',
      'team-leave',
      'team-disband',
      'team-info',
    ];
    if (isExchanger && exchangerAllowed.includes(cmd.id)) {
      permittedMap.set(cmd.id, cmd);
      continue;
    }
  }

  const permittedList = Array.from(permittedMap.values());

  // 3. Compute Category counts
  const categoryLabels: Record<CommandCategory, { label: string; desc: string }> = {
    orders: { label: 'Orders & Boosting', desc: 'Create, inspect, fund, and manage boost orders.' },
    setup: { label: 'Setup & Infrastructure', desc: 'Discord category, channel, and permission auto-provisioning.' },
    teams: { label: 'Teams & Squads', desc: 'Premade squad formation, invites, and roster management.' },
    profile: { label: 'Characters & Profile', desc: 'WoW characters, Raider.IO stats, and main assignment.' },
    proofs: { label: 'Proofs & Milestones', desc: 'Completion evidence upload and execution channel operations.' },
    interactive: { label: 'Interactive Panels & Wizards', desc: 'Buttons, modals, dropdown wizards, and review dashboards.' },
  };

  const categories: CategoryMetadata[] = [
    {
      id: 'all',
      label: 'All Permitted',
      description: 'Complete catalog of Discord commands available to your roles.',
      count: permittedList.length,
    },
  ];

  for (const [catKey, meta] of Object.entries(categoryLabels) as [CommandCategory, { label: string; desc: string }][]) {
    const count = permittedList.filter((c) => c.category === catKey).length;
    if (count > 0) {
      categories.push({
        id: catKey,
        label: meta.label,
        description: meta.desc,
        count,
      });
    }
  }

  return {
    commands: permittedList,
    categories,
  };
}
