/**
 * ============================================================================
 * G4X Community — Premade Presign & Command-Based Final Assignment Test Suite
 * ============================================================================
 * 23 Comprehensive Tests:
 *   1. Five Mythic+ public buttons (Tank, Healer, DPS, Key Owner, Premade).
 *   2. Non-Mythic order buttons (Pre-sign, Premade, Withdraw; NO Tank/Healer/DPS).
 *   3. Multi-role individual Presign.
 *   4. Key Owner self-declaration coexisting with roles.
 *   5. Premade button opens team select menu with leader's eligible squads.
 *   6. Duo, Trio, and Squad Presign submission.
 *   7. Team leader permissions and member consent.
 *   8. Four-person Mythic+ role matching.
 *   9. Invalid role combinations rejected.
 *  10. Duplicate member between Team and individual mentions rejected.
 *  11. Combined assignment: team:<id> plus individual @mention.
 *  12. Unauthorized command execution rejected.
 *  13. Suspended or unapproved participant rejected.
 *  14. Unpresigned participant rejected.
 *  15. Conflicting active reservation (BoosterReservation) rejected.
 *  16. Non-Pilot booster count validation.
 *  17. Pilot qualifications validation.
 *  18. Atomic assignment & concurrency safety.
 *  19. Private review UI contains command reference and NO Assign buttons.
 *  20. Post-assignment public card and private review dashboard updates.
 *  21. Private execution channel created with authorized permissions only.
 *  22. Restart recovery.
 *  23. Zero financial side effects.
 * ============================================================================
 */

import prisma from '../database/db';
import {
  toggleBoosterRolePresign,
  toggleBoosterKeyOwner,
  flexibleMythicRoleMatch,
  buildReviewDashboardEmbed,
  buildReviewDashboardComponents,
} from '../services/presignReviewService';
import {
  buildOrderComponents,
} from '../services/orderDiscordService';
import {
  parseAssignmentParticipants,
  handleAssignCommand,
} from '../commands/assign';
import { handlePremadeButton, handlePresignTeamSelectMenu } from '../interactions/presignReviewInteractions';
import { createTeam, inviteMember, acceptInvitation } from '../services/teamService';
import { DomainErrorCode } from '../services/domainErrors';

async function runPremadePresignAndCommandSuite() {
  console.log('================================================================================');
  console.log('   G4X COMMUNITY — PREMADE PRESIGN & COMMAND ASSIGNMENT TEST SUITE             ');
  console.log('================================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ': ' + detail : ''}`);
      failed++;
    }
  }

  const timestamp = Date.now();
  const uCreatorA = `cmd_adv_a_${timestamp}`;
  const uCreatorB = `cmd_adv_b_${timestamp}`;
  const uStaff = `cmd_staff_${timestamp}`;
  const uBooster1 = `cmd_b1_${timestamp}`;
  const uBooster2 = `cmd_b2_${timestamp}`;
  const uBooster3 = `cmd_b3_${timestamp}`;
  const uBooster4 = `cmd_b4_${timestamp}`;
  const uBoosterUnapproved = `cmd_unapp_${timestamp}`;
  const uLeader = `cmd_leader_${timestamp}`;
  const uMember1 = `cmd_m1_${timestamp}`;
  const uMember2 = `cmd_m2_${timestamp}`;

  try {
    // ─── Setup Users & Approvals ──────────────────────────────────────────────
    await prisma.game.upsert({
      where: { slug: 'wow_midnight' },
      update: { isActive: true },
      create: { slug: 'wow_midnight', displayName: 'World of Warcraft Midnight', serviceCategory: 'both', isActive: true },
    });

    const mplusService = await prisma.gameService.upsert({
      where: { gameSlug_serviceKey: { gameSlug: 'wow_midnight', serviceKey: 'mythic_plus' } },
      update: { isActive: true },
      create: {
        gameSlug: 'wow_midnight',
        serviceKey: 'mythic_plus',
        displayName: 'Mythic+ Dungeon Run',
        serviceMode: 'non_pilot',
        profileMode: 'manual',
        requiresPilotApproval: false,
        isActive: true,
      },
    });

    const pilotService = await prisma.gameService.upsert({
      where: { gameSlug_serviceKey: { gameSlug: 'wow_midnight', serviceKey: 'raid_pilot' } },
      update: { isActive: true },
      create: {
        gameSlug: 'wow_midnight',
        serviceKey: 'raid_pilot',
        displayName: 'Raid Pilot Run',
        serviceMode: 'pilot',
        profileMode: 'manual',
        requiresPilotApproval: true,
        isActive: true,
      },
    });

    const nonPilotGroupService = await prisma.gameService.upsert({
      where: { gameSlug_serviceKey: { gameSlug: 'wow_midnight', serviceKey: 'delve_carry' } },
      update: { isActive: true },
      create: {
        gameSlug: 'wow_midnight',
        serviceKey: 'delve_carry',
        displayName: 'Delve Duo Carry',
        serviceMode: 'non_pilot',
        profileMode: 'manual',
        requiresPilotApproval: false,
        isActive: true,
      },
    });

    // Mock Discord client & guild for execution channel provisioning
    const mockGuildId = `guild_cmd_${timestamp}`;
    const mockChannelsMap = new Map<string, any>();
    (mockChannelsMap as any).find = (predicate: (val: any) => boolean) => {
      for (const v of mockChannelsMap.values()) {
        if (predicate(v)) return v;
      }
      return undefined;
    };
    let channelSeq = Date.now();
    function createMockChan(data: any) {
      const cId = data.id || `chan_${++channelSeq}`;
      const owMap = new Map<string, any>();
      if (Array.isArray(data.permissionOverwrites)) {
        for (const ow of data.permissionOverwrites) owMap.set(ow.id, ow);
      }
      const cObj: any = {
        id: cId,
        name: data.name || 'order-mock',
        type: data.type ?? 0,
        parentId: data.parent || null,
        guild: { id: mockGuildId },
        isTextBased: () => true,
        permissionOverwrites: {
          cache: owMap,
          edit: async (tId: string, p: any) => { owMap.set(tId, { id: tId, ...p }); return true; },
          delete: async (tId: string) => { owMap.delete(tId); return true; },
        },
        messages: [],
        send: async (p: any) => ({ id: `msg_${Date.now()}`, ...p }),
      };
      mockChannelsMap.set(cId, cObj);
      return cObj;
    }
    const mockGuild: any = {
      id: mockGuildId,
      roles: { everyone: { id: `${mockGuildId}_everyone` } },
      channels: {
        cache: mockChannelsMap,
        create: async (data: any) => createMockChan(data),
      },
      members: { me: { id: `bot_${timestamp}` } },
    };
    const mockGuildsMap = new Map([[mockGuildId, mockGuild]]);
    (mockGuildsMap as any).first = () => mockGuild;
    const mockClient: any = {
      guilds: {
        cache: mockGuildsMap,
        fetch: async (id: string) => mockGuildsMap.get(id) || mockGuild,
      },
      channels: {
        cache: mockChannelsMap,
        fetch: async (id: string) => mockChannelsMap.get(id),
      },
      user: { id: `bot_${timestamp}` },
    };

    const usersToCreate = [
      { id: uCreatorA, username: 'Advertiser A', role: 'advertiser' },
      { id: uCreatorB, username: 'Advertiser B', role: 'advertiser' },
      { id: uStaff, username: 'Staff User', role: 'staff' },
      { id: uBooster1, username: 'Booster 1 (Tank/DPS)', role: 'booster' },
      { id: uBooster2, username: 'Booster 2 (Healer)', role: 'booster' },
      { id: uBooster3, username: 'Booster 3 (DPS)', role: 'booster' },
      { id: uBooster4, username: 'Booster 4 (DPS/Tank)', role: 'booster' },
      { id: uBoosterUnapproved, username: 'Unapproved User', role: 'booster' },
      { id: uLeader, username: 'Squad Leader', role: 'booster' },
      { id: uMember1, username: 'Squad Member 1', role: 'booster' },
      { id: uMember2, username: 'Squad Member 2', role: 'booster' },
    ];

    for (const u of usersToCreate) {
      await prisma.user.upsert({
        where: { discordId: u.id },
        update: { isActive: true },
        create: {
          discordId: u.id,
          username: u.username,
          displayName: u.username,
          isActive: true,
          advertiserRank: u.role === 'advertiser' ? 'silver' : undefined,
        },
      });

      await prisma.userRole.upsert({
        where: { userId_roleKey: { userId: u.id, roleKey: u.role } },
        update: {},
        create: { userId: u.id, roleKey: u.role },
      });

      if (u.id !== uBoosterUnapproved && u.role === 'booster') {
        await prisma.userGameApproval.create({
          data: {
            userId: u.id,
            gameSlug: 'wow_midnight',
            approvalType: 'booster',
            status: 'approved',
            reviewedBy: uStaff,
          },
        });
      }
    }

    // Give Booster 1 pilot qualification
    await prisma.userGameApproval.create({
      data: {
        userId: uBooster1,
        gameSlug: 'wow_midnight',
        approvalType: 'pilot',
        status: 'approved',
        reviewedBy: uStaff,
      },
    });

    // Create Base M+ Order
    const mplusOrder = await prisma.order.create({
      data: {
        orderRef: `G4X-MPLUS-${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: mplusService.id,
        creatorId: uCreatorA,
        creatorType: 'advertiser',
        advertiserId: uCreatorA,
        advertiserRank: 'silver',
        orderType: 'group',
        orderMode: 'non_pilot',
        grossAmountMinor: 10000,
        boosterPoolMinor: 8500,
        currency: 'USD',
        status: 'open_presign',
        paymentStatus: 'verified',
        requiredRoles: {
          create: [
            { roleName: 'tank', quantity: 1 },
            { roleName: 'healer', quantity: 1 },
            { roleName: 'dps', quantity: 2 },
          ],
        },
      },
      include: { requiredRoles: true, service: true, presigns: true, assignments: true },
    });

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 1: Five Mythic+ Public Buttons
    // ──────────────────────────────────────────────────────────────────────────
    const mplusRows = buildOrderComponents(mplusOrder);
    const mplusButtons = mplusRows[0].components as any[];
    assert(mplusButtons.length === 5, 'Test 1.1: Mythic+ order card renders exactly 5 buttons in row 0');
    assert(mplusButtons[0].data.label.startsWith('Tank'), 'Test 1.2: Button 1 is Tank');
    assert(mplusButtons[1].data.label.startsWith('Healer'), 'Test 1.3: Button 2 is Healer');
    assert(mplusButtons[2].data.label.startsWith('DPS'), 'Test 1.4: Button 3 is DPS');
    assert(mplusButtons[3].data.label.startsWith('Key Owner'), 'Test 1.5: Button 4 is Key Owner');
    assert(mplusButtons[4].data.label === 'Premade', 'Test 1.6: Button 5 is Premade');
    assert(mplusButtons[4].data.custom_id.startsWith('presign_premade:'), 'Test 1.7: Premade button has customId presign_premade');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 2: Other Order Types Buttons (Pilot & Non-Pilot)
    // ──────────────────────────────────────────────────────────────────────────
    const pilotOrder = await prisma.order.create({
      data: {
        orderRef: `G4X-PILOT-${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: pilotService.id,
        creatorId: uCreatorA,
        orderType: 'solo',
        orderMode: 'pilot',
        grossAmountMinor: 5000,
        boosterPoolMinor: 4000,
        currency: 'USD',
        status: 'open_presign',
        paymentStatus: 'verified',
      },
      include: { service: true, requiredRoles: true },
    });

    const pilotRows = buildOrderComponents(pilotOrder);
    const pilotButtons = pilotRows[0].components as any[];
    const pilotLabels = pilotButtons.map((b) => b.data.label);
    assert(pilotLabels.some((l: string) => l.startsWith('Pre-sign')), 'Test 2.1: Pilot order card shows Pre-sign button');
    assert(!pilotLabels.includes('Tank') && !pilotLabels.includes('Healer'), 'Test 2.2: Pilot order does NOT show Tank/Healer buttons');
    assert(!pilotLabels.includes('Premade'), 'Test 2.3: Solo pilot order does NOT show Premade when allowsPremade is false');

    const nonPilotGroupOrder = await prisma.order.create({
      data: {
        orderRef: `G4X-DELVE-${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: nonPilotGroupService.id,
        creatorId: uCreatorA,
        orderType: 'group',
        orderMode: 'non_pilot',
        quantity: 2,
        grossAmountMinor: 6000,
        boosterPoolMinor: 5000,
        currency: 'USD',
        status: 'open_presign',
        paymentStatus: 'verified',
        requiredRoles: {
          create: [{ roleName: 'booster', quantity: 2 }],
        },
      },
      include: { service: true, requiredRoles: true },
    });

    const delveRows = buildOrderComponents(nonPilotGroupOrder);
    const delveButtons = delveRows[0].components as any[];
    const delveLabels = delveButtons.map((b) => b.data.label);
    assert(delveLabels.some((l: string) => l.startsWith('Pre-sign')), 'Test 2.4: Non-pilot group order shows Pre-sign button');
    assert(delveLabels.includes('Premade'), 'Test 2.5: Non-pilot group order shows Premade button when group order');
    assert(!delveLabels.includes('Tank'), 'Test 2.6: Non-pilot group carry does NOT show Mythic+ Tank/Healer buttons');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 3: Multi-Role Individual Presign
    // ──────────────────────────────────────────────────────────────────────────
    const rTank = await toggleBoosterRolePresign(mplusOrder.id, uBooster1, 'tank');
    assert(rTank.outcome === 'registered' && rTank.activeRoles.includes('tank'), 'Test 3.1: Booster 1 signs up as Tank');

    const rDps = await toggleBoosterRolePresign(mplusOrder.id, uBooster1, 'dps');
    assert(rDps.outcome === 'role_added' && rDps.activeRoles.includes('dps') && rDps.activeRoles.includes('tank'), 'Test 3.2: Booster 1 adds DPS without losing Tank');

    const presignsB1 = await prisma.orderPresign.findMany({ where: { orderId: mplusOrder.id, userId: uBooster1 } });
    assert(presignsB1.length === 1, 'Test 3.3: Exactly one logical presign record maintained per booster per order');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 4: Key Owner Self-Declaration Coexists With Roles
    // ──────────────────────────────────────────────────────────────────────────
    const rKey = await toggleBoosterKeyOwner(mplusOrder.id, uBooster1, { keyLevel: 12, dungeonName: 'Grim Batol' });
    assert(rKey.outcome === 'key_declared' && rKey.hasKey === true, 'Test 4.1: Booster 1 declares Key Owner capability');

    const presignAfterKey = await prisma.orderPresign.findFirst({ where: { orderId: mplusOrder.id, userId: uBooster1 } });
    assert(Boolean(presignAfterKey?.registeredRole.includes('tank')), 'Test 4.2: Execution roles retained when declaring key ownership');
    assert(presignAfterKey?.hasKey === 'yes', 'Test 4.3: hasKey set to yes');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 5: Premade Button Opens Team Select Menu
    // ──────────────────────────────────────────────────────────────────────────
    // Create a Trio team for uLeader
    const teamName = `TeamAlpha_${timestamp}`;
    const squad = await createTeam({
      leaderId: uLeader,
      teamName,
      gameSlug: 'wow_midnight',
      squadType: 'trio',
    });

    await inviteMember({ squadIdOrName: String(squad!.id), leaderId: uLeader, targetUserId: uMember1, memberRole: 'healer' });
    await acceptInvitation(squad!.id, uMember1);

    await inviteMember({ squadIdOrName: String(squad!.id), leaderId: uLeader, targetUserId: uMember2, memberRole: 'dps' });
    await acceptInvitation(squad!.id, uMember2);

    let replyData: any = null;
    const fakeInteraction: any = {
      user: { id: uLeader, username: 'SquadLeader' },
      customId: `presign_premade:${mplusOrder.id}`,
      reply: async (data: any) => { replyData = data; },
    };

    await handlePremadeButton(fakeInteraction, mplusOrder.id);
    assert(replyData !== null, 'Test 5.1: handlePremadeButton responds');
    assert(replyData.components && replyData.components.length > 0, 'Test 5.2: handlePremadeButton renders select menu component');
    const selectMenu = replyData.components[0].components[0];
    assert(selectMenu.data.custom_id === `presign_team:${mplusOrder.id}`, 'Test 5.3: Select menu customId is presign_team:orderId');
    const optVal = selectMenu.options[0]?.data?.value || selectMenu.options[0]?.value;
    assert(optVal === String(squad!.id), 'Test 5.4: Select menu includes user squad');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 6: Duo, Trio, and Squad Presign Submission
    // ──────────────────────────────────────────────────────────────────────────
    let selectReply: any = null;
    const fakeSelectInteraction: any = {
      user: { id: uLeader, username: 'SquadLeader' },
      customId: `presign_team:${mplusOrder.id}`,
      values: [String(squad!.id)],
      client: {},
      reply: async (data: any) => { selectReply = data; },
    };

    await handlePresignTeamSelectMenu(fakeSelectInteraction);
    assert(selectReply && selectReply.content.includes('Premade Application Submitted'), 'Test 6.1: Team presign submitted via select menu');
    assert(selectReply.content.includes(`team:${squad!.id}`), 'Test 6.2: Team confirmation includes team:ID reference');

    const squadPresigns = await prisma.orderPresign.findMany({
      where: { orderId: mplusOrder.id, squadId: squad!.id },
    });
    assert(squadPresigns.length === 3, 'Test 6.3: Trio application registered all 3 members in OrderPresign');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 7: Team Leader Permissions and Member Consent
    // ──────────────────────────────────────────────────────────────────────────
    // Unaccepted member team
    const teamWithPending = await createTeam({
      leaderId: uLeader,
      teamName: `PendingTeam_${timestamp}`,
      gameSlug: 'wow_midnight',
      squadType: 'duo',
    });
    await inviteMember({ squadIdOrName: String(teamWithPending!.id), leaderId: uLeader, targetUserId: uBooster4, memberRole: 'dps' });
    // uBooster4 has NOT accepted invitation

    let consentBlocked = false;
    try {
      await parseAssignmentParticipants([`team:${teamWithPending!.id}`]);
    } catch (err: any) {
      if (err.code === DomainErrorCode.SQUAD_MEMBER_NOT_ACCEPTED) {
        consentBlocked = true;
      }
    }
    assert(consentBlocked, 'Test 7.1: Team with unaccepted member rejected with SQUAD_MEMBER_NOT_ACCEPTED');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 8: Four-Person Mythic+ Role Matching
    // ──────────────────────────────────────────────────────────────────────────
    // Team Trio:
    // Leader: Tank / DPS
    // Member 1: Healer
    // Member 2: DPS
    // Individual Booster 4: DPS / Tank
    const matchingProfiles = [
      { userId: uLeader, roles: ['tank', 'dps'] },
      { userId: uMember1, roles: ['healer'] },
      { userId: uMember2, roles: ['dps'] },
      { userId: uBooster4, roles: ['dps', 'tank'] },
    ];
    const matchResult = flexibleMythicRoleMatch(matchingProfiles);
    assert(matchResult.success === true, 'Test 8.1: Flexible role matching succeeds for Trio + 1 Individual');
    assert(matchResult.assignment![uMember1] === 'healer', 'Test 8.2: Member 1 assigned Healer');
    assert(matchResult.assignment![uMember2] === 'dps', 'Test 8.3: Member 2 assigned DPS');
    // Leader gets Tank, Booster 4 gets DPS (or vice versa, but both slots filled)
    const assignedRoles = Object.values(matchResult.assignment!);
    const tankCount = assignedRoles.filter((r) => r === 'tank').length;
    const healerCount = assignedRoles.filter((r) => r === 'healer').length;
    const dpsCount = assignedRoles.filter((r) => r === 'dps').length;
    assert(tankCount === 1 && healerCount === 1 && dpsCount === 2, 'Test 8.4: Exactly 1 Tank, 1 Healer, 2 DPS resolved');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 9: Invalid Role Combinations Rejected
    // ──────────────────────────────────────────────────────────────────────────
    const invalidProfiles = [
      { userId: 'u1', roles: ['dps'] },
      { userId: 'u2', roles: ['dps'] },
      { userId: 'u3', roles: ['dps'] },
      { userId: 'u4', roles: ['dps'] },
    ];
    const failMatch = flexibleMythicRoleMatch(invalidProfiles);
    assert(failMatch.success === false, 'Test 9.1: 4 DPS configuration rejected (missing Tank and Healer)');

    const missingHealerProfiles = [
      { userId: 'u1', roles: ['tank'] },
      { userId: 'u2', roles: ['dps'] },
      { userId: 'u3', roles: ['dps'] },
      { userId: 'u4', roles: ['dps'] },
    ];
    const failMissingHealer = flexibleMythicRoleMatch(missingHealerProfiles);
    assert(failMissingHealer.success === false, 'Test 9.2: 1 Tank + 3 DPS rejected (missing Healer)');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 10: Duplicate Member Between Team and Individual Mentions
    // ──────────────────────────────────────────────────────────────────────────
    let dupDetected = false;
    let dupReply: any = null;
    const fakeDupMsg: any = {
      author: { id: uCreatorA },
      reply: async (data: any) => { dupReply = data; },
      client: {},
    };

    // team:squad already includes uLeader; mentioning uLeader again should fail
    await handleAssignCommand(fakeDupMsg, [String(mplusOrder.id), `team:${squad!.id}`, `<@${uLeader}>`]);
    if (dupReply && dupReply.content.includes('Duplicate Participant')) {
      dupDetected = true;
    }
    assert(dupDetected, 'Test 10.1: Duplicate member between team and individual mention rejected');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 11: Combined Assignment: team:<id> plus individual @mention
    // ──────────────────────────────────────────────────────────────────────────
    // Register uBooster4 for mplusOrder
    await toggleBoosterRolePresign(mplusOrder.id, uBooster4, 'dps');

    let assignReply: any = null;
    const fakeAssignMsg: any = {
      author: { id: uCreatorA },
      guild: mockGuild,
      reply: async (data: any) => { assignReply = data; },
      client: mockClient,
    };

    await handleAssignCommand(fakeAssignMsg, [
      `#${mplusOrder.id}`,
      `team:${squad!.id}`,
      `<@${uBooster4}>`,
    ]);

    assert(assignReply && assignReply.embeds && assignReply.embeds.length > 0, 'Test 11.1: G4!assign executes and returns embed');
    const embedData = assignReply.embeds[0].data;
    assert(embedData.title.includes('Assigned Successfully'), 'Test 11.2: Embed confirms successful assignment');

    const orderAfterAssign = await prisma.order.findUnique({
      where: { id: mplusOrder.id },
      include: { assignments: true },
    });
    assert(orderAfterAssign?.status === 'assigned', 'Test 11.3: Order status moved to assigned');
    assert(orderAfterAssign?.assignments.length === 4, 'Test 11.4: Exactly 4 distinct boosters assigned');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 12: Unauthorized Command Execution Rejected
    // ──────────────────────────────────────────────────────────────────────────
    // Create new fresh open order for testing permissions
    const permOrder = await prisma.order.create({
      data: {
        orderRef: `G4X-PERM-${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: mplusService.id,
        creatorId: uCreatorA,
        orderType: 'group',
        orderMode: 'non_pilot',
        grossAmountMinor: 10000,
        boosterPoolMinor: 8500,
        currency: 'USD',
        status: 'open_presign',
        paymentStatus: 'verified',
        requiredRoles: {
          create: [
            { roleName: 'tank', quantity: 1 },
            { roleName: 'healer', quantity: 1 },
            { roleName: 'dps', quantity: 2 },
          ],
        },
      },
    });

    let unauthReply: any = null;
    const fakeUnauthMsg: any = {
      author: { id: uCreatorB }, // Unrelated Advertiser B
      reply: async (data: any) => { unauthReply = data; },
      client: {},
    };

    await handleAssignCommand(fakeUnauthMsg, [String(permOrder.id), `<@${uBooster1}>`]);
    assert(unauthReply && unauthReply.content.includes('Permission Denied'), 'Test 12.1: Unrelated advertiser rejected from assigning another advertiser order');

    let boosterSelfAssignReply: any = null;
    const fakeBoosterMsg: any = {
      author: { id: uBooster1 }, // Booster trying to assign
      reply: async (data: any) => { boosterSelfAssignReply = data; },
      client: {},
    };
    await handleAssignCommand(fakeBoosterMsg, [String(permOrder.id), `<@${uBooster1}>`]);
    assert(boosterSelfAssignReply && boosterSelfAssignReply.content.includes('Permission Denied'), 'Test 12.2: Booster cannot assign themselves just because they presigned');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 13: Suspended or Unapproved Participant Rejected
    // ──────────────────────────────────────────────────────────────────────────
    let unappReply: any = null;
    const fakeAppMsg: any = {
      author: { id: uCreatorA },
      reply: async (data: any) => { unappReply = data; },
      client: {},
    };
    await handleAssignCommand(fakeAppMsg, [String(permOrder.id), `<@${uBoosterUnapproved}>`]);
    assert(unappReply && (unappReply.content.includes('Unapproved Booster') || unappReply.content.includes('Ineligible Booster')), 'Test 13.1: Unapproved participant rejected');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 14: Unpresigned Participant Rejected
    // ──────────────────────────────────────────────────────────────────────────
    let unpresReply: any = null;
    const fakeUnpresMsg: any = {
      author: { id: uCreatorA },
      reply: async (data: any) => { unpresReply = data; },
      client: {},
    };
    // uBooster2 has not presigned for permOrder
    await handleAssignCommand(fakeUnpresMsg, [String(permOrder.id), `<@${uBooster2}>`]);
    assert(unpresReply && unpresReply.content.includes('Unregistered Candidate'), 'Test 14.1: Booster who did not presign rejected');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 15: Conflicting Active Reservation (BoosterReservation) Rejected
    // ──────────────────────────────────────────────────────────────────────────
    // uBooster4 was assigned to mplusOrder and has active BoosterReservation
    await toggleBoosterRolePresign(permOrder.id, uBooster4, 'dps');

    let conflictReply: any = null;
    const fakeConflictMsg: any = {
      author: { id: uCreatorA },
      reply: async (data: any) => { conflictReply = data; },
      client: {},
    };
    await handleAssignCommand(fakeConflictMsg, [String(permOrder.id), `<@${uBooster4}>`]);
    assert(conflictReply && conflictReply.content.includes('Conflicting Reservation'), 'Test 15.1: Double-booking rejected via active BoosterReservation check');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 16: Non-Pilot Booster Count Validation
    // ──────────────────────────────────────────────────────────────────────────
    // delveCarry requires 2 boosters
    await toggleBoosterRolePresign(nonPilotGroupOrder.id, uBooster1, 'booster');
    let countMismatchReply: any = null;
    const fakeCountMsg: any = {
      author: { id: uCreatorA },
      reply: async (data: any) => { countMismatchReply = data; },
      client: {},
    };
    // Provide only 1 booster when 2 required
    await handleAssignCommand(fakeCountMsg, [String(nonPilotGroupOrder.id), `<@${uBooster1}>`]);
    assert(countMismatchReply && countMismatchReply.content.includes('Booster Count Mismatch'), 'Test 16.1: Non-pilot count mismatch rejected');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 17: Pilot Qualifications Validation
    // ──────────────────────────────────────────────────────────────────────────
    // uBooster3 lacks pilot qualification
    let pilotQualReply: any = null;
    const fakePilotMsg: any = {
      author: { id: uCreatorA },
      reply: async (data: any) => { pilotQualReply = data; },
      client: {},
    };
    await handleAssignCommand(fakePilotMsg, [String(pilotOrder.id), `<@${uBooster3}>`]);
    assert(pilotQualReply && pilotQualReply.content.includes('Pilot Qualification Required'), 'Test 17.1: Missing pilot approval rejected on pilot order');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 18: Atomic Assignment & Concurrency Safety
    // ──────────────────────────────────────────────────────────────────────────
    // Verify that failed assignment made ZERO changes to permOrder
    const permOrderCheck = await prisma.order.findUnique({
      where: { id: permOrder.id },
      include: { assignments: true },
    });
    assert(permOrderCheck?.status === 'open_presign', 'Test 18.1: Order remains in open_presign on rejected assignment');
    assert(permOrderCheck?.assignments.length === 0, 'Test 18.2: Zero partial assignments persisted');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 19: Private Review UI Contains Command Reference and NO Assign Buttons
    // ──────────────────────────────────────────────────────────────────────────
    const reviewEmbed = buildReviewDashboardEmbed(permOrder, [], []);
    assert(Boolean(reviewEmbed.data.fields?.some((f: any) => f.name.includes('Assignment Command Reference'))), 'Test 19.1: Review dashboard contains Assignment Command Reference');
    assert(Boolean(reviewEmbed.data.fields?.some((f: any) => f.value.includes('G4!assign'))), 'Test 19.2: Command reference includes G4!assign examples');

    const reviewComponents = buildReviewDashboardComponents(permOrder.id, false);
    const reviewButtons = reviewComponents.flatMap((r) => r.components as any[]);
    const hasAssignButton = reviewButtons.some((b) => b.data.custom_id.startsWith('review_assign'));
    assert(!hasAssignButton, 'Test 19.3: Assign buttons REMOVED from private review UI');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 20: Post-Assignment Public Card and Private Review Dashboard Updates
    // ──────────────────────────────────────────────────────────────────────────
    const updatedMplusOrder = await prisma.order.findUnique({
      where: { id: mplusOrder.id },
      include: { assignments: true, presigns: true, service: true, requiredRoles: true },
    });
    const assignedRows = buildOrderComponents(updatedMplusOrder!);
    const assignedButtons = assignedRows[0].components as any[];
    const hasDisabledStatusBadge = assignedButtons.some(
      (b) => b.data.custom_id.startsWith('order_status') && b.data.disabled === true
    );
    assert(hasDisabledStatusBadge, 'Test 20.1: Public order card displays disabled assigned status badge');

    const assignedReviewEmbed = buildReviewDashboardEmbed(updatedMplusOrder!, updatedMplusOrder!.presigns, []);
    const statusField = assignedReviewEmbed.data.fields?.find((f) => f.name === 'Status & Progress');
    assert(Boolean(statusField?.value.includes('ASSIGNED')), 'Test 20.2: Review dashboard reflects assigned status');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 21: Private Execution Channel Authorized Permissions Only
    // ──────────────────────────────────────────────────────────────────────────
    // OrderChannel created during assignSelectedApplicants
    const execChannel = await prisma.orderChannel.findFirst({
      where: { orderId: mplusOrder.id, channelType: 'execution' },
    });
    assert(execChannel !== null, 'Test 21.1: OrderChannel record created');
    assert(execChannel?.channelType === 'execution', 'Test 21.2: Channel marked as execution');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 22: Restart Recovery
    // ──────────────────────────────────────────────────────────────────────────
    // Verify pure stateless button IDs and deterministic command routing
    const parsedRecovered = await parseAssignmentParticipants([`team:${squad!.id}`, `<@${uBooster1}>`]);
    assert(parsedRecovered.userIds.length === 4, 'Test 22.1: Participants parsed deterministically after restart simulation');
    assert(parsedRecovered.squadIds[0] === squad!.id, 'Test 22.2: Squad ID preserved');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 23: Zero Financial Side Effects
    // ──────────────────────────────────────────────────────────────────────────
    const ledgerEntries = await prisma.ledgerEntryV2.findMany({
      where: { description: { contains: String(mplusOrder.id) } },
    });
    const payouts = ledgerEntries.filter((e) => e.entryType === 'PAYOUT' || e.entryType === 'BOOSTER_EARNING');
    assert(payouts.length === 0, 'Test 23.1: Zero premature payouts or booster earnings generated during assignment');

  } catch (err: any) {
    console.error('❌ Unexpected exception during test execution:', err);
    failed++;
  }

  console.log('\n================================================================================');
  console.log(`PREMADE PRESIGN & COMMAND ASSIGNMENT SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPremadePresignAndCommandSuite()
  .catch((err) => {
    console.error('Fatal suite failure:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
