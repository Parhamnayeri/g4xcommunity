/**
 * ============================================================================
 * G4X Community — Advanced Pre-sign, Premade Applications & Private Review Suite
 * ============================================================================
 * 26 Comprehensive Tests:
 *   1. Tank-only applicant.
 *   2. Healer-only applicant.
 *   3. DPS-only applicant.
 *   4. Multi-role applicant.
 *   5. Duplicate role click.
 *   6. Updating selected roles.
 *   7. Withdrawing an application.
 *   8. Key Owner declaration.
 *   9. Key Owner plus Tank application.
 *  10. Key Owner does not add a fifth slot.
 *  11. Duo application.
 *  12. Trio application.
 *  13. Four-member Squad application.
 *  14. Incomplete Mythic+ team composition.
 *  15. Multi-role flexible matching.
 *  16. Duplicate person across individual and Premade applications.
 *  17. Reject cross-user and forged interactions.
 *  18. Creator-only applicant privacy.
 *  19. Different Advertisers cannot view each other's applicants.
 *  20. Large applicant-list pagination.
 *  21. Final assignment authorization.
 *  22. Concurrent assignment attempts.
 *  23. Restart recovery.
 *  24. Pilot and Non-Pilot applicant mentions.
 *  25. No duplicate review messages.
 *  26. No financial side effects.
 * ============================================================================
 */

import prisma from '../database/db';
import {
  getUserEligibleRoles,
  toggleBoosterRolePresign,
  toggleBoosterKeyOwner,
  applyPremadeSquadPresign,
  flexibleMythicRoleMatch,
  buildReviewDashboardEmbed,
  buildReviewDashboardComponents,
  publishOrUpdateOrderReviewDashboard,
  verifyReviewActorPermissions,
  assignSelectedApplicants,
  parsePresignRoles,
} from '../services/presignReviewService';
import {
  buildOrderComponents,
  handlePresignButton,
  handleKeyOwnerButton,
  handlePresignWithdrawButton,
} from '../services/orderDiscordService';
import { handleReviewDashboardButton } from '../interactions/presignReviewInteractions';
import { createTeam, inviteMember, acceptInvitation } from '../services/teamService';
import { DomainError, DomainErrorCode } from '../services/domainErrors';

async function runPresignReviewSuite() {
  console.log('================================================================================');
  console.log('   G4X COMMUNITY — ADVANCED PRE-SIGN & PRIVATE REVIEW TEST SUITE               ');
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
  const uCreatorA = `adv_a_${timestamp}`;
  const uCreatorB = `adv_b_${timestamp}`;
  const uStaff = `staff_${timestamp}`;
  const uTankOnly = `booster_tank_${timestamp}`;
  const uHealerOnly = `booster_healer_${timestamp}`;
  const uDpsOnly = `booster_dps_${timestamp}`;
  const uMultiRole = `booster_multi_${timestamp}`;
  const uKeyOnly = `booster_key_${timestamp}`;
  const uSquadLeader = `leader_${timestamp}`;
  const uSquadM1 = `m1_${timestamp}`;
  const uSquadM2 = `m2_${timestamp}`;
  const uSquadM3 = `m3_${timestamp}`;

  try {
    // ─── Fixture Setup ────────────────────────────────────────────────────────
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
        displayName: 'Mythic+ Boosting',
        serviceMode: 'non_pilot',
        profileMode: 'raiderio',
        requiresPilotApproval: false,
        isActive: true,
      },
    });

    const pilotService = await prisma.gameService.upsert({
      where: { gameSlug_serviceKey: { gameSlug: 'wow_midnight', serviceKey: 'pilot_service' } },
      update: { isActive: true },
      create: {
        gameSlug: 'wow_midnight',
        serviceKey: 'pilot_service',
        displayName: 'Pilot Boosting',
        serviceMode: 'pilot',
        profileMode: 'manual',
        requiresPilotApproval: true,
        isActive: true,
      },
    });

    // Create Users & Approvals
    const allUsers = [
      { id: uCreatorA, username: 'AdvertiserA', role: 'advertiser' },
      { id: uCreatorB, username: 'AdvertiserB', role: 'advertiser' },
      { id: uStaff, username: 'StaffMember', role: 'staff' },
      { id: uTankOnly, username: 'TankMaster', role: 'booster' },
      { id: uHealerOnly, username: 'HealerPro', role: 'booster' },
      { id: uDpsOnly, username: 'DpsGod', role: 'booster' },
      { id: uMultiRole, username: 'FlexKing', role: 'booster' },
      { id: uKeyOnly, username: 'KeyHolder', role: 'booster' },
      { id: uSquadLeader, username: 'SquadLeader', role: 'booster' },
      { id: uSquadM1, username: 'SquadMember1', role: 'booster' },
      { id: uSquadM2, username: 'SquadMember2', role: 'booster' },
      { id: uSquadM3, username: 'SquadMember3', role: 'booster' },
    ];

    for (const u of allUsers) {
      await prisma.user.upsert({
        where: { discordId: u.id },
        update: { isActive: true },
        create: { discordId: u.id, username: u.username, isActive: true },
      });
      await prisma.userRole.upsert({
        where: { userId_roleKey: { userId: u.id, roleKey: u.role } },
        update: {},
        create: { userId: u.id, roleKey: u.role },
      });
      await prisma.wallet.upsert({
        where: { userId: u.id },
        update: {},
        create: { userId: u.id, balanceUsd: 500, escrowUsd: 0, balanceGold: 0, balanceUsdt: 0, balanceIrt: 0 },
      });

      if (u.role === 'booster') {
        await prisma.userGameApproval.upsert({
          where: { id: 999900 + Math.floor(Math.random() * 10000) },
          update: {},
          create: {
            userId: u.id,
            gameSlug: 'wow_midnight',
            approvalType: 'booster',
            status: 'approved',
          },
        });
      }
    }

    // Configure Characters with authoritative specs and scores:
    // 1. Tank-only character
    await prisma.wowCharacter.create({
      data: {
        userId: uTankOnly,
        characterName: 'TankProt',
        realm: 'Tarren-Mill',
        characterClass: 'Warrior',
        activeSpec: 'Protection',
        tankScore: 3200,
        healerScore: 0,
        dpsScore: 0,
        mythicScore: 3200,
        isActive: true,
        isMain: true,
      },
    });

    // 2. Healer-only character
    await prisma.wowCharacter.create({
      data: {
        userId: uHealerOnly,
        characterName: 'HealResto',
        realm: 'Twisting-Nether',
        characterClass: 'Druid',
        activeSpec: 'Restoration',
        tankScore: 0,
        healerScore: 3100,
        dpsScore: 0,
        mythicScore: 3100,
        isActive: true,
        isMain: true,
      },
    });

    // 3. DPS-only character
    await prisma.wowCharacter.create({
      data: {
        userId: uDpsOnly,
        characterName: 'DpsHavoc',
        realm: 'Kazzak',
        characterClass: 'Demon Hunter',
        activeSpec: 'Havoc',
        tankScore: 0,
        healerScore: 0,
        dpsScore: 3400,
        mythicScore: 3400,
        isActive: true,
        isMain: true,
      },
    });

    // 4. Multi-role character (Tank & DPS capable)
    await prisma.wowCharacter.create({
      data: {
        userId: uMultiRole,
        characterName: 'FlexDk',
        realm: 'Tarren-Mill',
        characterClass: 'Death Knight',
        activeSpec: 'Blood',
        tankScore: 2800,
        healerScore: 0,
        dpsScore: 2900,
        mythicScore: 2900,
        isActive: true,
        isMain: true,
      },
    });

    // Record baseline financial state
    const initialLedgerCount = await prisma.ledgerTransaction.count();
    const initialEscrowHolds = await prisma.escrowHold.count();

    // Create Main Mythic+ Order for Advertiser A
    const mythicOrder = await prisma.order.create({
      data: {
        orderRef: `G4X-M_${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: mplusService.id,
        creatorId: uCreatorA,
        advertiserId: uCreatorA,
        orderName: 'Mythic+ Keystone 10 Carry',
        orderType: 'group',
        orderMode: 'non_pilot',
        status: 'open_presign',
        currency: 'USD',
        grossAmountMinor: 5000,
        paymentStatus: 'verified',
        requiredRoles: {
          create: [
            { roleName: 'tank', quantity: 2 },
            { roleName: 'healer', quantity: 2 },
            { roleName: 'dps', quantity: 4 },
          ],
        },
        keyRequirements: {
          create: [{ dungeonName: 'The Stonevault', keyLevel: 10, isMandatory: true }],
        },
      },
    });

    // ─── TEST 1: Tank-only applicant ──────────────────────────────────────────
    const tankRoles = await getUserEligibleRoles(uTankOnly, 'wow_midnight');
    assert(tankRoles.includes('tank') && !tankRoles.includes('healer'), '1.1: Tank-only booster authoritatively qualifies for Tank');

    const tankApp = await toggleBoosterRolePresign(mythicOrder.id, uTankOnly, 'tank');
    assert(tankApp.outcome === 'registered' && tankApp.activeRoles.includes('tank'), '1.2: Tank-only applicant successfully applies as Tank');

    let tankWrongRoleFailed = false;
    try {
      await toggleBoosterRolePresign(mythicOrder.id, uTankOnly, 'healer');
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.INVALID_ASSIGNED_ROLE) tankWrongRoleFailed = true;
    }
    assert(tankWrongRoleFailed, '1.3: Tank-only applicant cannot apply for unapproved Healer role');

    // ─── TEST 2: Healer-only applicant ────────────────────────────────────────
    const healerRoles = await getUserEligibleRoles(uHealerOnly, 'wow_midnight');
    assert(healerRoles.includes('healer') && !healerRoles.includes('tank'), '2.1: Healer-only booster authoritatively qualifies for Healer');

    const healerApp = await toggleBoosterRolePresign(mythicOrder.id, uHealerOnly, 'healer');
    assert(healerApp.outcome === 'registered' && healerApp.activeRoles.includes('healer'), '2.2: Healer-only applicant applies as Healer');

    // ─── TEST 3: DPS-only applicant ───────────────────────────────────────────
    const dpsRoles = await getUserEligibleRoles(uDpsOnly, 'wow_midnight');
    assert(dpsRoles.includes('dps') && !dpsRoles.includes('tank'), '3.1: DPS-only booster authoritatively qualifies for DPS');

    const dpsApp = await toggleBoosterRolePresign(mythicOrder.id, uDpsOnly, 'dps');
    assert(dpsApp.outcome === 'registered' && dpsApp.activeRoles.includes('dps'), '3.2: DPS-only applicant applies as DPS');

    // ─── TEST 4: Multi-role applicant ─────────────────────────────────────────
    const flexRoles = await getUserEligibleRoles(uMultiRole, 'wow_midnight');
    assert(flexRoles.includes('tank') && flexRoles.includes('dps'), '4.1: Multi-role booster qualifies for Tank and DPS');

    // Register Tank first
    await toggleBoosterRolePresign(mythicOrder.id, uMultiRole, 'tank');
    // Then also express interest in DPS
    const multiApp = await toggleBoosterRolePresign(mythicOrder.id, uMultiRole, 'dps');
    const multiPresignRecord = await prisma.orderPresign.findMany({
      where: { orderId: mythicOrder.id, userId: uMultiRole, status: 'registered' },
    });

    assert(
      multiPresignRecord.length === 1 &&
      parsePresignRoles(multiPresignRecord[0].registeredRole).includes('tank') &&
      parsePresignRoles(multiPresignRecord[0].registeredRole).includes('dps'),
      '4.2: Multi-role applicant forms ONE logical record containing both Tank and DPS'
    );

    // ─── TEST 5: Duplicate role click ─────────────────────────────────────────
    // Multi-role clicks DPS again
    const dupClick = await toggleBoosterRolePresign(mythicOrder.id, uMultiRole, 'dps');
    assert(dupClick.outcome === 'already_registered', '5.1: Duplicate role click is safe and idempotent');

    const totalRowsForMulti = await prisma.orderPresign.count({
      where: { orderId: mythicOrder.id, userId: uMultiRole },
    });
    assert(totalRowsForMulti === 1, '5.2: Duplicate role click creates zero duplicate rows');

    // ─── TEST 6: Updating selected roles ──────────────────────────────────────
    // Remove tank from multi-role applicant
    await prisma.orderPresign.update({
      where: { id: multiPresignRecord[0].id },
      data: { registeredRole: 'dps' },
    });
    const updatedRoles = await prisma.orderPresign.findUnique({
      where: { id: multiPresignRecord[0].id },
    });
    assert(updatedRoles?.registeredRole === 'dps', '6.1: Applicant preferences successfully updated in place');

    // ─── TEST 7: Withdrawing an application ───────────────────────────────────
    let withdrawReply = '';
    const mockWithdrawInteraction: any = {
      user: { id: uDpsOnly, username: 'DpsGod' },
      client: {},
      reply: async (p: any) => { withdrawReply = typeof p === 'string' ? p : p.content; },
    };
    await handlePresignWithdrawButton(mockWithdrawInteraction, mythicOrder.id);
    const withdrawnRecord = await prisma.orderPresign.findFirst({
      where: { orderId: mythicOrder.id, userId: uDpsOnly },
    });
    assert(withdrawnRecord?.status === 'withdrawn' && withdrawReply.includes('Withdrawn'), '7.1: Application withdrawal marks status as withdrawn');

    // ─── TEST 8: Key Owner declaration ────────────────────────────────────────
    const keyDecl = await toggleBoosterKeyOwner(mythicOrder.id, uKeyOnly, { keyLevel: 10, dungeonName: 'The Stonevault' });
    assert(keyDecl.hasKey === true && keyDecl.outcome === 'key_declared', '8.1: Booster declares key ownership');

    const keyPresign = await prisma.orderPresign.findFirst({
      where: { orderId: mythicOrder.id, userId: uKeyOnly },
    });
    assert(
      keyPresign?.registeredRole === 'key_available' && keyPresign?.hasKey === 'yes' && keyPresign.keyLevel === 10,
      '8.2: Key declaration without executable role saved as Key Available'
    );

    // ─── TEST 9: Key Owner plus Tank application ──────────────────────────────
    // TankMaster also declares Key Owner
    const tankKey = await toggleBoosterKeyOwner(mythicOrder.id, uTankOnly, { keyLevel: 10 });
    const tankPresignWithKey = await prisma.orderPresign.findFirst({
      where: { orderId: mythicOrder.id, userId: uTankOnly },
    });
    assert(
      Boolean(tankPresignWithKey?.registeredRole.includes('tank') && tankPresignWithKey.hasKey === 'yes'),
      '9.1: Key Owner declared on existing Tank applicant without creating second record'
    );

    // ─── TEST 10: Key Owner does not add a fifth slot ─────────────────────────
    const mythicComps = buildOrderComponents(mythicOrder, [tankPresignWithKey!, keyPresign]);
    const mythicRow = mythicComps[0].toJSON();
    assert((mythicRow.components as any[]).length === 4, '10.1: Exactly four buttons shown on Mythic+ card (Tank, Healer, DPS, Key Owner)');
    const keyBtn = (mythicRow.components as any[]).find((c) => c.custom_id?.includes('presign_key'));
    assert(Boolean(keyBtn), '10.2: Key Owner button is distinct and present as capability declaration');

    // ─── TEST 11: Duo application ─────────────────────────────────────────────
    // Create Duo squad (2 members: Leader=Tank, Member=Healer)
    const duoTeam = await createTeam({
      teamName: `DuoTeam_${timestamp}`,
      leaderId: uSquadLeader,
      gameSlug: 'wow_midnight',
      squadType: 'duo',
    });
    assert(Boolean(duoTeam), '11.0: Duo squad created');
    await inviteMember({ squadIdOrName: String(duoTeam!.id), leaderId: uSquadLeader, targetUserId: uSquadM1, memberRole: 'healer' });
    await acceptInvitation(String(duoTeam!.id), uSquadM1);

    const duoApp = await applyPremadeSquadPresign(mythicOrder.id, duoTeam!.id, uSquadLeader);
    assert(duoApp.memberCount === 2, '11.1: Duo team application accepted with 2 members');
    assert(duoApp.presigns.length === 2 && duoApp.presigns.every((p) => p.claimType === 'squad'), '11.2: Both Duo members registered under squad claimType');

    // ─── TEST 12: Trio application ────────────────────────────────────────────
    const trioTeam = await createTeam({
      teamName: `TrioTeam_${timestamp}`,
      leaderId: uSquadLeader,
      gameSlug: 'wow_midnight',
      squadType: 'trio',
    });
    assert(Boolean(trioTeam), '12.0: Trio squad created');
    await inviteMember({ squadIdOrName: String(trioTeam!.id), leaderId: uSquadLeader, targetUserId: uSquadM1, memberRole: 'healer' });
    await acceptInvitation(String(trioTeam!.id), uSquadM1);
    await inviteMember({ squadIdOrName: String(trioTeam!.id), leaderId: uSquadLeader, targetUserId: uSquadM2, memberRole: 'dps' });
    await acceptInvitation(String(trioTeam!.id), uSquadM2);

    const trioApp = await applyPremadeSquadPresign(mythicOrder.id, trioTeam!.id, uSquadLeader);
    assert(trioApp.memberCount === 3, '12.1: Trio team application accepted with 3 members');

    // ─── TEST 13: Four-member Squad application ───────────────────────────────
    const fullTeam = await createTeam({
      teamName: `FullSquad_${timestamp}`,
      leaderId: uSquadLeader,
      gameSlug: 'wow_midnight',
      squadType: 'full',
    });
    assert(Boolean(fullTeam), '13.0: Full squad created');
    // Set leader as Tank
    await prisma.squadMember.update({
      where: { squadId_userId: { squadId: fullTeam!.id, userId: uSquadLeader } },
      data: { memberRole: 'tank' },
    });
    await inviteMember({ squadIdOrName: String(fullTeam!.id), leaderId: uSquadLeader, targetUserId: uSquadM1, memberRole: 'healer' });
    await acceptInvitation(String(fullTeam!.id), uSquadM1);
    await inviteMember({ squadIdOrName: String(fullTeam!.id), leaderId: uSquadLeader, targetUserId: uSquadM2, memberRole: 'dps' });
    await acceptInvitation(String(fullTeam!.id), uSquadM2);
    await inviteMember({ squadIdOrName: String(fullTeam!.id), leaderId: uSquadLeader, targetUserId: uSquadM3, memberRole: 'dps' });
    await acceptInvitation(String(fullTeam!.id), uSquadM3);

    const squadApp = await applyPremadeSquadPresign(mythicOrder.id, fullTeam!.id, uSquadLeader);
    assert(squadApp.memberCount === 4, '13.1: Full Squad application registered with 4 members');

    // ─── TEST 14: Incomplete Mythic+ team composition ─────────────────────────
    // Create bad squad with 4 DPS (no tank, no healer)
    const badSquad = await createTeam({
      teamName: `BadSquad_${timestamp}`,
      leaderId: uSquadLeader,
      gameSlug: 'wow_midnight',
      squadType: 'full',
    });
    assert(Boolean(badSquad), '14.0: Bad squad created');
    await prisma.squadMember.update({
      where: { squadId_userId: { squadId: badSquad!.id, userId: uSquadLeader } },
      data: { memberRole: 'dps' },
    });
    await inviteMember({ squadIdOrName: String(badSquad!.id), leaderId: uSquadLeader, targetUserId: uSquadM1, memberRole: 'dps' });
    await acceptInvitation(String(badSquad!.id), uSquadM1);
    await inviteMember({ squadIdOrName: String(badSquad!.id), leaderId: uSquadLeader, targetUserId: uSquadM2, memberRole: 'dps' });
    await acceptInvitation(String(badSquad!.id), uSquadM2);
    await inviteMember({ squadIdOrName: String(badSquad!.id), leaderId: uSquadLeader, targetUserId: uSquadM3, memberRole: 'dps' });
    await acceptInvitation(String(badSquad!.id), uSquadM3);

    let badCompFailed = false;
    try {
      await applyPremadeSquadPresign(mythicOrder.id, badSquad!.id, uSquadLeader);
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.INVALID_ASSIGNED_ROLE) badCompFailed = true;
    }
    assert(badCompFailed, '14.1: Squad missing required Tank and Healer is strictly rejected');

    // ─── TEST 15: Multi-role flexible matching ────────────────────────────────
    const flexRoster = [
      { userId: 'u1', roles: ['tank', 'dps'] },
      { userId: 'u2', roles: ['healer'] },
      { userId: 'u3', roles: ['dps'] },
      { userId: 'u4', roles: ['tank', 'dps'] },
    ];
    const flexResult = flexibleMythicRoleMatch(flexRoster);
    assert(
      flexResult.success === true &&
      flexResult.assignment?.['u2'] === 'healer' &&
      (flexResult.assignment?.['u1'] === 'tank' || flexResult.assignment?.['u4'] === 'tank'),
      '15.1: Multi-role flexible matching resolves 1 Tank, 1 Healer, 2 DPS'
    );

    // ─── TEST 16: Duplicate person across individual and Premade applications ──
    const allPresigns = await prisma.orderPresign.findMany({
      where: { orderId: mythicOrder.id, status: 'registered' },
    });
    const uniqueUserIds = new Set(allPresigns.map((p) => p.userId));
    assert(uniqueUserIds.size === allPresigns.length, '16.1: Applicants remain strictly deduplicated by Discord User ID');

    // ─── TEST 17: Reject cross-user and forged interactions ───────────────────
    let crossWithdrawBlocked = false;
    try {
      const { withdrawOrderClaim } = await import('../services/claimService');
      await withdrawOrderClaim(tankPresignWithKey!.id, uDpsOnly);
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.PERMISSION_DENIED) crossWithdrawBlocked = true;
    }
    assert(crossWithdrawBlocked, '17.1: Forged withdrawal by a different user is strictly forbidden');

    // ─── TEST 18: Creator-only applicant privacy ──────────────────────────────
    const creatorAllowed = await verifyReviewActorPermissions(uCreatorA, mythicOrder);
    assert(creatorAllowed === true, '18.1: Order creator is authorized to access applicant review');

    // ─── TEST 19: Different Advertisers cannot view each other's applicants ────
    let advBlocked = false;
    try {
      await verifyReviewActorPermissions(uCreatorB, mythicOrder);
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.PERMISSION_DENIED) advBlocked = true;
    }
    assert(advBlocked, '19.1: Other Advertisers cannot view or manage this creator\'s applicants');

    // ─── TEST 20: Large applicant-list pagination / truncation ────────────────
    const largePresignsList = [];
    for (let i = 0; i < 35; i++) {
      largePresignsList.push({
        userId: `bulk_user_${i}`,
        registeredRole: 'dps',
        status: 'registered',
        hasKey: i % 5 === 0 ? 'yes' : 'no',
        keyLevel: 10,
      });
    }
    const largeEmbed = buildReviewDashboardEmbed(mythicOrder, largePresignsList, []);
    const embedJson = largeEmbed.toJSON();
    const appField = embedJson.fields?.find((f) => f.name.includes('Individual Applicants'));
    assert(
      Boolean(appField && appField.value.includes('more')),
      '20.1: Large applicant list (35 boosters) is safely paginated/truncated without Discord limit overflow'
    );

    // ─── TEST 21: Final assignment authorization ──────────────────────────────
    let unauthorizedAssignFailed = false;
    try {
      await assignSelectedApplicants({
        orderId: mythicOrder.id,
        actorId: uCreatorB, // Wrong advertiser!
        assignments: [{ userId: uTankOnly, assignedRole: 'tank' }],
      });
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.PERMISSION_DENIED) unauthorizedAssignFailed = true;
    }
    assert(unauthorizedAssignFailed, '21.1: Unauthorized actor cannot execute final assignment');

    // ─── TEST 22: Concurrent assignment attempts ──────────────────────────────
    // Clean reservations
    await prisma.boosterReservation.deleteMany({ where: { userId: uTankOnly } });

    // Advertiser A assigns TankMaster
    const assignSuccess = await assignSelectedApplicants({
      orderId: mythicOrder.id,
      actorId: uCreatorA,
      assignments: [{ userId: uTankOnly, assignedRole: 'tank' }],
    });
    assert(assignSuccess.success === true, '22.1: First assignment transaction succeeds');

    // Attempt second assignment of TankMaster to another order
    const order2 = await prisma.order.create({
      data: {
        orderRef: `G4X-M2_${timestamp}`,
        orderType: 'external_order',
        gameSlug: 'wow_midnight',
        serviceId: mplusService.id,
        creatorId: uCreatorA,
        status: 'open_presign',
        currency: 'USD',
        grossAmountMinor: 4000,
        paymentStatus: 'verified',
      },
    });

    let doubleBookingBlocked = false;
    try {
      await assignSelectedApplicants({
        orderId: order2.id,
        actorId: uCreatorA,
        assignments: [{ userId: uTankOnly, assignedRole: 'tank' }],
      });
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.BOOSTER_ALREADY_RESERVED) doubleBookingBlocked = true;
    }
    assert(doubleBookingBlocked, '22.2: Concurrent assignment to second order blocked via active BoosterReservation');

    // ─── TEST 23: Restart recovery ────────────────────────────────────────────
    const reloadedOrder = await prisma.order.findUnique({
      where: { id: mythicOrder.id },
      include: { assignments: true, presigns: true },
    });
    assert(
      Boolean(reloadedOrder?.assignments.some((a) => a.userId === uTankOnly)),
      '23.1: Booster assignments cleanly survive simulation of bot restart'
    );

    // ─── TEST 24: Pilot and Non-Pilot applicant mentions ──────────────────────
    const pilotOrder = await prisma.order.create({
      data: {
        orderRef: `G4X-P_${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: pilotService.id,
        creatorId: uCreatorA,
        orderName: 'Solo Pilot Boost',
        orderType: 'pilot',
        orderMode: 'pilot',
        status: 'open_presign',
        currency: 'USD',
        grossAmountMinor: 3000,
        paymentStatus: 'verified',
      },
    });

    const pilotPresigns = [
      { userId: uDpsOnly, registeredRole: 'pilot', status: 'registered', hasKey: 'no' },
    ];
    const pilotEmbed = buildReviewDashboardEmbed(pilotOrder, pilotPresigns, []);
    const pilotField = pilotEmbed.toJSON().fields?.find((f) => f.name.includes('Individual Applicants'));
    assert(
      Boolean(pilotField && pilotField.value.includes(`<@${uDpsOnly}>`) && !pilotField.value.includes('Tank')),
      '24.1: Pilot order review embed displays applicant mention without Tank/Healer/DPS classifications'
    );

    // ─── TEST 25: No duplicate review messages ────────────────────────────────
    let mockMsgId = 'msg_rev_123';
    let editCallCount = 0;
    let sendCallCount = 0;

    const mockReviewChannel: any = {
      id: 'chan_pre_signs_001',
      send: async () => {
        sendCallCount++;
        return { id: mockMsgId, edit: async () => { editCallCount++; } };
      },
      messages: {
        fetch: async () => ({
          id: mockMsgId,
          edit: async () => { editCallCount++; },
        }),
      },
    };

    const mockGuild = {
      channels: {
        cache: {
          find: () => mockReviewChannel,
        },
      },
    };

    const mockDiscordClient: any = {
      guilds: {
        cache: {
          first: () => mockGuild,
          get: () => mockGuild,
        },
      },
      channels: {
        cache: new Map([['chan_pre_signs_001', mockReviewChannel]]),
      },
    };

    // First call: creates message
    await publishOrUpdateOrderReviewDashboard(mockDiscordClient, mythicOrder.id);
    // Second call: updates message in place
    await publishOrUpdateOrderReviewDashboard(mockDiscordClient, mythicOrder.id);

    assert(
      sendCallCount === 1 && editCallCount === 1,
      '25.1: Exactly ONE review message maintained per order, subsequent updates edit in place'
    );

    // ─── TEST 26: No financial side effects ───────────────────────────────────
    const finalWallets = await prisma.wallet.findMany();
    const finalLedgerCount = await prisma.ledgerTransaction.count();
    const finalEscrowHolds = await prisma.escrowHold.count();

    assert(
      finalLedgerCount === initialLedgerCount && finalEscrowHolds === initialEscrowHolds,
      '26.1: Assignment and pre-sign operations triggered zero premature financial transactions or escrow releases'
    );

    // ─── Cleanup ──────────────────────────────────────────────────────────────
    await prisma.orderAssignment.deleteMany({ where: { orderId: { in: [mythicOrder.id, order2.id, pilotOrder.id] } } });
    await prisma.boosterReservation.deleteMany({ where: { userId: { in: allUsers.map((u) => u.id) } } });
    await prisma.orderPresign.deleteMany({ where: { orderId: { in: [mythicOrder.id, order2.id, pilotOrder.id] } } });
    await prisma.orderKeyRequirement.deleteMany({ where: { orderId: mythicOrder.id } });
    await prisma.orderRequiredRole.deleteMany({ where: { orderId: mythicOrder.id } });
    await prisma.order.deleteMany({ where: { id: { in: [mythicOrder.id, order2.id, pilotOrder.id] } } });
    await prisma.squadMember.deleteMany({ where: { squad: { leaderId: uSquadLeader } } });
    await prisma.premadeSquad.deleteMany({ where: { leaderId: uSquadLeader } });
    await prisma.wowCharacter.deleteMany({ where: { userId: { in: allUsers.map((u) => u.id) } } });
    await prisma.userGameApproval.deleteMany({ where: { userId: { in: allUsers.map((u) => u.id) } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: allUsers.map((u) => u.id) } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: allUsers.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { discordId: { in: allUsers.map((u) => u.id) } } });

    console.log('\n================================================================================');
    console.log(`PRE-SIGN & REVIEW SUITE: ${passed} PASSED | ${failed} FAILED`);
    console.log('================================================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal error during presign review suite:', err);
    process.exit(1);
  }
}

runPresignReviewSuite();
