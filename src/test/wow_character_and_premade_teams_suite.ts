/**
 * ============================================================================
 * G4X Community — WoW Character & Premade Teams Test Suite (Phase 2)
 * ============================================================================
 * Tests covering 20 required scenarios:
 *  1. Approved Booster adds a character.
 *  2. Unauthorized user cannot add a Booster character.
 *  3. Duplicate character handling.
 *  4. Main Character selection.
 *  5. Raider.IO refresh.
 *  6. Invalid region/realm/character.
 *  7. Unauthorized character modification.
 *  8. Team creation.
 *  9. Team invitation.
 * 10. Invitation acceptance.
 * 11. Invitation rejection.
 * 12. Duplicate invitations.
 * 13. Unauthorized disband.
 * 14. Leader departure.
 * 15. Team size and Mythic+ eligibility.
 * 16. Character-aware order claiming.
 * 17. Team member eligibility.
 * 18. Discord restart recovery.
 * 19. Website and Discord state consistency.
 * 20. No financial wallet mutations.
 * ============================================================================
 */

import prisma from '../database/db';
import {
  addCharacter,
  listUserCharacters,
  setMainCharacter,
  syncCharacterProfile,
  removeCharacter,
} from '../services/characterService';
import {
  createTeam,
  listTeams,
  inviteMember,
  acceptInvitation,
  declineInvitation,
  leaveTeam,
  disbandTeam,
  findSquad,
} from '../services/teamService';
import { createOrderClaim } from '../services/claimService';
import { validatePremadeSquad } from '../services/squadValidationService';
import { DomainError, DomainErrorCode } from '../services/domainErrors';
import { serializeCharacter, serializeSquad } from '../web/serializers';

async function runWowCharactersAndTeamsSuite() {
  console.log('================================================================================');
  console.log('   G4X COMMUNITY — WOW CHARACTERS & PREMADE TEAMS TEST SUITE (PHASE 2)          ');
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
  const booster1Id = `booster1_${timestamp}`;
  const booster2Id = `booster2_${timestamp}`;
  const booster3Id = `booster3_${timestamp}`;
  const booster4Id = `booster4_${timestamp}`;
  const unauthUserId = `unauth_${timestamp}`;

  try {
    // ─── Setup Test Fixtures ──────────────────────────────────────────────────
    // Ensure game & services exist
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

    // Create users & approvals
    for (const [uid, isBooster] of [
      [booster1Id, true],
      [booster2Id, true],
      [booster3Id, true],
      [booster4Id, true],
      [unauthUserId, false],
    ] as [string, boolean][]) {
      await prisma.user.upsert({
        where: { discordId: uid },
        update: { isActive: true },
        create: {
          discordId: uid,
          username: `user_${uid}`,
          displayName: `User ${uid}`,
          isActive: true,
        },
      });

      // Initialize wallet
      await prisma.wallet.upsert({
        where: { userId: uid },
        update: {},
        create: {
          userId: uid,
          balanceUsd: 100,
          balanceIrt: 0,
          balanceGold: 0,
          balanceUsdt: 0,
        },
      });

      if (isBooster) {
        await prisma.userRole.upsert({
          where: { userId_roleKey: { userId: uid, roleKey: 'booster' } },
          update: {},
          create: { userId: uid, roleKey: 'booster' },
        });

        const existingApp = await prisma.userGameApproval.findFirst({
          where: { userId: uid, gameSlug: 'wow_midnight', approvalType: 'booster' },
        });
        if (existingApp) {
          await prisma.userGameApproval.update({
            where: { id: existingApp.id },
            data: { status: 'approved' },
          });
        } else {
          await prisma.userGameApproval.create({
            data: {
              userId: uid,
              gameSlug: 'wow_midnight',
              approvalType: 'booster',
              status: 'approved',
            },
          });
        }
      }
    }

    const initialWallet = await prisma.wallet.findUnique({ where: { userId: booster1Id } });

    // ─── Test 1: Approved Booster adds a character ─────────────────────────────
    const char1 = await addCharacter({
      userId: booster1Id,
      characterName: 'Arthas',
      realm: 'tarren-mill',
      region: 'eu',
    });

    assert(
      char1 && char1.characterName === 'Arthas' && char1.isMain === true && char1.isActive === true,
      '1. Approved Booster adds a character (set as initial Main)'
    );

    // ─── Test 2: Unauthorized user cannot add a Booster character ───────────────
    let unauthError: any = null;
    try {
      await addCharacter({
        userId: unauthUserId,
        characterName: 'UnauthorizedChar',
        realm: 'tarren-mill',
        region: 'eu',
      });
    } catch (e: any) {
      unauthError = e;
    }
    assert(
      unauthError instanceof DomainError && unauthError.code === DomainErrorCode.BOOSTER_NOT_APPROVED,
      '2. Unauthorized user cannot add a Booster character (BOOSTER_NOT_APPROVED)'
    );

    // ─── Test 3: Duplicate character handling ─────────────────────────────────
    let dupError: any = null;
    try {
      await addCharacter({
        userId: booster1Id,
        characterName: 'Arthas',
        realm: 'tarren-mill',
        region: 'eu',
      });
    } catch (e: any) {
      dupError = e;
    }
    assert(
      dupError instanceof DomainError && dupError.code === DomainErrorCode.CHARACTER_ALREADY_EXISTS,
      '3. Duplicate character handling blocks identical active registration'
    );

    // ─── Test 4: Main Character selection ─────────────────────────────────────
    const char2 = await addCharacter({
      userId: booster1Id,
      characterName: 'Sylvanas',
      realm: 'kazzak',
      region: 'eu',
    });

    assert(!char2.isMain, '4a. Second registered character defaults to isMain: false');

    const updatedMain = await setMainCharacter(booster1Id, char2.id, booster1Id);
    const reloadedChar1 = await prisma.wowCharacter.findUnique({ where: { id: char1.id } });

    assert(
      updatedMain.isMain === true && reloadedChar1?.isMain === false,
      '4. Main Character selection sets target as main and demotes previous main'
    );

    // ─── Test 5: Raider.IO refresh ────────────────────────────────────────────
    const syncRes = await syncCharacterProfile(char2.id, booster1Id, booster1Id);
    assert(
      syncRes && syncRes.character && syncRes.character.lastSyncedAt !== null,
      '5. Raider.IO refresh successfully synchronizes profile and updates timestamp'
    );

    // ─── Test 6: Invalid region/realm/character ───────────────────────────────
    let invalidRegionErr: any = null;
    try {
      await addCharacter({
        userId: booster1Id,
        characterName: 'ValidName',
        realm: 'tarren-mill',
        region: 'antarctica',
      });
    } catch (e: any) {
      invalidRegionErr = e;
    }

    let unverifiedCharErr: any = null;
    try {
      await addCharacter({
        userId: booster1Id,
        characterName: 'DefinitelyNonExistentChar99999',
        realm: 'tarren-mill',
        region: 'eu',
        requireVerified: true,
      });
    } catch (e: any) {
      unverifiedCharErr = e;
    }

    assert(
      invalidRegionErr instanceof DomainError &&
      invalidRegionErr.code === DomainErrorCode.INVALID_CHARACTER_REGION &&
      unverifiedCharErr instanceof DomainError &&
      unverifiedCharErr.code === DomainErrorCode.CHARACTER_NOT_FOUND,
      '6. Invalid region and unverified character are strictly rejected'
    );

    // ─── Test 7: Unauthorized character modification ──────────────────────────
    let unauthModErr: any = null;
    try {
      await setMainCharacter(booster1Id, char1.id, booster2Id);
    } catch (e: any) {
      unauthModErr = e;
    }
    assert(
      unauthModErr instanceof DomainError && unauthModErr.code === DomainErrorCode.PERMISSION_DENIED,
      '7. Unauthorized character modification by non-owner is rejected'
    );

    // ─── Test 8: Team creation ────────────────────────────────────────────────
    const teamName = `Team_${timestamp}`;
    const squad = await createTeam({
      leaderId: booster1Id,
      teamName,
      squadType: 'full',
      gameSlug: 'wow_midnight',
    });

    assert(
      squad !== null &&
      squad.teamName === teamName &&
      squad.status === 'active' &&
      squad.members.length === 1 &&
      squad.members[0].userId === booster1Id &&
      squad.members[0].status === 'accepted',
      '8. Team creation creates active squad with leader as accepted member'
    );

    // ─── Test 9: Team invitation ──────────────────────────────────────────────
    const invite = await inviteMember({
      squadIdOrName: squad!.id,
      leaderId: booster1Id,
      targetUserId: booster2Id,
      memberRole: 'healer',
    });

    assert(
      invite.status === 'pending' && invite.userId === booster2Id,
      '9. Team invitation creates pending squad member record'
    );

    // ─── Test 10: Invitation acceptance ───────────────────────────────────────
    const acceptedMember = await acceptInvitation(squad!.id, booster2Id);
    assert(
      acceptedMember.status === 'accepted' && acceptedMember.userId === booster2Id,
      '10. Invitation acceptance transitions pending invite to accepted status'
    );

    // ─── Test 11: Invitation rejection ────────────────────────────────────────
    await inviteMember({
      squadIdOrName: squad!.id,
      leaderId: booster1Id,
      targetUserId: booster3Id,
      memberRole: 'tank',
    });

    const declinedMember = await declineInvitation(squad!.id, booster3Id);
    assert(
      declinedMember.status === 'declined',
      '11. Invitation rejection records declined status'
    );

    // ─── Test 12: Duplicate invitations ───────────────────────────────────────
    let dupInviteErr: any = null;
    try {
      await inviteMember({
        squadIdOrName: squad!.id,
        leaderId: booster1Id,
        targetUserId: booster2Id,
      });
    } catch (e: any) {
      dupInviteErr = e;
    }
    assert(
      dupInviteErr instanceof DomainError && dupInviteErr.code === DomainErrorCode.SQUAD_ALREADY_MEMBER,
      '12. Duplicate invitation to existing accepted member is rejected'
    );

    // ─── Test 13: Unauthorized disband ────────────────────────────────────────
    let unauthDisbandErr: any = null;
    try {
      await disbandTeam(squad!.id, booster2Id);
    } catch (e: any) {
      unauthDisbandErr = e;
    }
    assert(
      unauthDisbandErr instanceof DomainError && unauthDisbandErr.code === DomainErrorCode.PERMISSION_DENIED,
      '13. Unauthorized disband by non-leader member is rejected'
    );

    // ─── Test 14: Leader departure ────────────────────────────────────────────
    const leaveResult = await leaveTeam(squad!.id, booster1Id);
    const reloadedSquad = await findSquad(squad!.id);

    assert(
      leaveResult.action === 'leader_transferred' &&
      reloadedSquad?.leaderId === booster2Id,
      '14. Leader departure safely transfers squad leadership to remaining accepted member'
    );

    // ─── Test 15: Team size and Mythic+ eligibility ───────────────────────────
    // Remove declined/non-accepted records so all current members are accepted, but size is < 4
    await prisma.squadMember.deleteMany({
      where: { squadId: squad!.id, status: { not: 'accepted' } },
    });

    // Mythic+ requires exactly 4 boosters
    let mplusValidationErr: any = null;
    try {
      await validatePremadeSquad(squad!.id, 'wow_midnight', mplusService.id);
    } catch (e: any) {
      mplusValidationErr = e;
    }
    assert(
      mplusValidationErr instanceof DomainError && mplusValidationErr.code === DomainErrorCode.SQUAD_INVALID_SIZE,
      '15a. Squad with fewer than 4 boosters fails Mythic+ eligibility validation'
    );

    // Add remaining 3 boosters to form full 4-man squad
    // Re-invite booster 1, 3, 4
    await inviteMember({ squadIdOrName: squad!.id, leaderId: booster2Id, targetUserId: booster1Id, memberRole: 'tank' });
    await acceptInvitation(squad!.id, booster1Id);

    await inviteMember({ squadIdOrName: squad!.id, leaderId: booster2Id, targetUserId: booster3Id, memberRole: 'dps' });
    await acceptInvitation(squad!.id, booster3Id);

    await inviteMember({ squadIdOrName: squad!.id, leaderId: booster2Id, targetUserId: booster4Id, memberRole: 'dps' });
    await acceptInvitation(squad!.id, booster4Id);

    const validMplusSquad = await validatePremadeSquad(squad!.id, 'wow_midnight', mplusService.id);
    assert(
      validMplusSquad.members.filter((m) => m.status === 'accepted').length === 4,
      '15b. Squad with exactly 4 accepted boosters satisfies Mythic+ eligibility'
    );

    // ─── Test 16: Character-aware order claiming ──────────────────────────────
    // Create an order in open_presign
    const order = await prisma.order.create({
      data: {
        orderRef: `ORD_M16_${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: mplusService.id,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 5000,
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

    const claimWithChar = await createOrderClaim({
      orderId: order.id,
      userId: booster1Id,
      claimType: 'individual',
      registeredRole: 'tank',
      characterId: char1.id,
    });

    assert(
      claimWithChar.characterId === char1.id && claimWithChar.registeredRole === 'tank',
      '16. Character-aware order claiming records valid owned character'
    );

    // ─── Test 17: Team member eligibility ─────────────────────────────────────
    // If a member loses approval, validatePremadeSquad fails closed
    const app4 = await prisma.userGameApproval.findFirst({
      where: {
        userId: booster4Id,
        gameSlug: 'wow_midnight',
        approvalType: 'booster',
      },
    });
    if (app4) {
      await prisma.userGameApproval.update({
        where: { id: app4.id },
        data: { status: 'suspended' },
      });
    }

    let suspendedMemberErr: any = null;
    try {
      await validatePremadeSquad(squad!.id, 'wow_midnight', mplusService.id);
    } catch (e: any) {
      suspendedMemberErr = e;
    }

    assert(
      suspendedMemberErr instanceof DomainError && suspendedMemberErr.code === DomainErrorCode.SQUAD_MEMBER_NOT_APPROVED,
      '17. Team member eligibility enforces all squad members maintain active booster approval'
    );

    // Restore approval
    if (app4) {
      await prisma.userGameApproval.update({
        where: { id: app4.id },
        data: { status: 'approved' },
      });
    }

    // ─── Test 18: Discord restart recovery ────────────────────────────────────
    // Reload characters & squads afresh from persistent database
    const recoveredChars = await listUserCharacters(booster1Id);
    const recoveredSquads = await listTeams(booster1Id);

    assert(
      recoveredChars.length >= 2 &&
      recoveredSquads.length >= 1 &&
      recoveredSquads[0].status === 'active',
      '18. Discord restart recovery cleanly reloads persistent character & team state'
    );

    // ─── Test 19: Website and Discord state consistency ───────────────────────
    const serializedChar = serializeCharacter(char1);
    const serializedSq = serializeSquad(validMplusSquad);

    assert(
      serializedChar.characterName === 'Arthas' &&
      typeof serializedChar.isActive === 'boolean' &&
      serializedSq.members.length === 4 &&
      serializedSq.teamName === teamName,
      '19. Website and Discord state consistency: Serializers match database models'
    );

    // ─── Test 20: No financial wallet mutations ───────────────────────────────
    const finalWallet = await prisma.wallet.findUnique({ where: { userId: booster1Id } });
    assert(
      finalWallet?.balanceUsd === initialWallet?.balanceUsd &&
      finalWallet?.escrowUsd === initialWallet?.escrowUsd,
      '20. No financial wallet mutations: Character & team operations do not alter wallet balances'
    );

    // ─── Clean up test artifacts ──────────────────────────────────────────────
    await removeCharacter(char1.id, booster1Id, booster1Id);
    const charListAfterRemove = await listUserCharacters(booster1Id);
    assert(
      charListAfterRemove.every((c) => c.id !== char1.id),
      'Post-check: Deactivated character is excluded from active roster'
    );

  } catch (error) {
    console.error('Unexpected error during test suite execution:', error);
    failed++;
  }

  console.log('\n================================================================================');
  console.log(`TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runWowCharactersAndTeamsSuite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

export { runWowCharactersAndTeamsSuite };
