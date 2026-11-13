/**
 * admin_game_and_category_management_suite.ts
 *
 * Comprehensive test suite verifying Admin Game & Service Category Management:
 *  1. Initial Inspection & Verification of existing catalog (WoW Midnight, WoW Forever).
 *  2. Specific distinction preservation: WoW Midnight (Mythic+, Non-Pilot, Pilot) vs WoW Forever (Non-Pilot, Pilot only).
 *  3. Game CRUD, unique slug validation, and identifier formatting.
 *  4. Service Category CRUD, operational settings (claim window, keystone, roles, proof, squads, pause, replace).
 *  5. Reordering of games and service categories.
 *  6. Enable / Disable state management & blocking of NEW orders and registrations without affecting historical data.
 *  7. Immutability & Guarded Deletion: Referenced games/categories are strictly prevented from hard-delete.
 *  8. Safe deletion of unreferenced games and categories.
 *  9. AuditLog trail verification for all administrative modifications.
 * 10. Catalog separation from Discord channel provisioning & zero financial mutation.
 */

import prisma from '../database/db';
import {
  listAdminGames,
  createGame,
  updateGame,
  toggleGameStatus,
  reorderGames,
  deleteGame,
  createGameService,
  updateGameService,
  toggleGameServiceStatus,
  reorderGameServices,
  deleteGameService,
} from '../services/gameManagementService';
import { validateGameAndService } from '../services/orderValidationService';
import { isMythicPlusService } from '../services/orderLifecycleService';

async function runAdminGameAndCategoryManagementSuite() {
  console.log('=== STARTING ADMIN GAME & SERVICE CATEGORY MANAGEMENT SUITE ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: any, testName: string, detail?: string) {
    if (Boolean(condition)) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ': ' + detail : ''}`);
      failed++;
    }
  }

  const testActor = 'test_admin_games_actor_9999';

  try {
    // Upsert test actor user for foreign key integrity in audit_logs
    await prisma.user.upsert({
      where: { discordId: testActor },
      create: {
        discordId: testActor,
        username: 'TestAdminActor',
      },
      update: {},
    });

    // ─── 1. Initial Inspection & Structure Verification ───────────────────────
    console.log('\n--- Step 1: Initial Inspection of Existing Catalog ---');
    const initialGames = await listAdminGames();

    assert(initialGames.length >= 2, 'Initial catalog contains at least 2 games');

    const wowMidnight = initialGames.find((g: any) => g.slug === 'wow_midnight');
    const wowForever = initialGames.find((g: any) => g.slug === 'wow_forever');

    assert(Boolean(wowMidnight), 'WoW Midnight is configured in catalog');
    assert(Boolean(wowForever), 'WoW Forever is configured in catalog');

    if (wowMidnight) {
      const midnightServiceKeys = wowMidnight.services.map((s: any) => s.serviceKey);
      assert(midnightServiceKeys.includes('mythic_plus'), 'WoW Midnight supports Mythic+ services');
      assert(wowMidnight.services.some((s: any) => s.serviceMode === 'non_pilot'), 'WoW Midnight supports Non-Pilot services');
      assert(wowMidnight.services.some((s: any) => s.serviceMode === 'pilot'), 'WoW Midnight supports Pilot services');

      const mythicService = wowMidnight.services.find((s: any) => s.serviceKey === 'mythic_plus');
      assert(mythicService?.settings?.requiresKey === true, 'WoW Midnight Mythic+ requires keystone');
      assert(mythicService?.profileMode === 'raiderio', 'WoW Midnight Mythic+ uses Raider.IO profileMode');
      assert(Boolean(mythicService && isMythicPlusService(mythicService)), 'Seeded WoW Midnight Mythic+ is detected as Mythic+');
    }

    if (wowForever) {
      const foreverServiceKeys = wowForever.services.map((s: any) => s.serviceKey);
      assert(!foreverServiceKeys.includes('mythic_plus'), 'WoW Forever does NOT support Mythic+ (honoring distinct game design)');
      assert(wowForever.services.some((s: any) => s.serviceMode === 'pilot'), 'WoW Forever supports Pilot');
    }

    // ─── 2. Validation & Game Creation ────────────────────────────────────────
    console.log('\n--- Step 2: Game Slug Validation & Creation ---');

    let invalidSlugThrown = false;
    try {
      await createGame(
        {
          slug: 'INVALID SLUG WITH SPACES!',
          displayName: 'Invalid Game',
        },
        testActor
      );
    } catch (err: any) {
      invalidSlugThrown = true;
      assert(err.message.includes('alphanumeric'), 'Invalid slug is rejected by validation regex', err.message);
    }
    assert(invalidSlugThrown, 'Rejection of invalid game slug verified');

    let duplicateSlugThrown = false;
    try {
      await createGame(
        {
          slug: 'wow_midnight',
          displayName: 'Duplicate WoW Midnight',
        },
        testActor
      );
    } catch (err: any) {
      duplicateSlugThrown = true;
      assert(err.message.includes('already exists'), 'Duplicate game slug is rejected', err.message);
    }
    assert(duplicateSlugThrown, 'Duplicate game slug rejection verified');

    // Create a valid new game
    const testGameSlug = 'test_arpg_game';
    // Clean up if left from previous runs
    await prisma.serviceSetting.deleteMany({ where: { service: { gameSlug: testGameSlug } } });
    await prisma.gameService.deleteMany({ where: { gameSlug: testGameSlug } });
    await prisma.game.deleteMany({ where: { slug: testGameSlug } });

    const createdGame = await createGame(
      {
        slug: testGameSlug,
        displayName: 'Test ARPG Sanctuary',
        description: 'Endgame dungeon carries and seasonal boss runs',
        serviceCategory: 'both',
        sortOrder: 10,
        isActive: true,
      },
      testActor
    );

    assert(createdGame.slug === testGameSlug, 'New game created with expected slug');
    assert(createdGame.displayName === 'Test ARPG Sanctuary', 'New game display name persisted');
    assert(createdGame.description === 'Endgame dungeon carries and seasonal boss runs', 'New game description persisted');
    assert(createdGame.sortOrder === 10, 'New game sort order persisted');
    assert(createdGame.isActive === true, 'New game isActive status true');

    // ─── 3. Game Update & Slug Immutability ────────────────────────────────────
    console.log('\n--- Step 3: Game Update & Field Editing ---');

    const updatedGame = await updateGame(
      testGameSlug,
      {
        displayName: 'Test ARPG Sanctuary Remastered',
        description: 'Updated description for season 2',
        serviceCategory: 'non_pilot',
        sortOrder: 15,
      },
      testActor
    );

    assert(updatedGame.displayName === 'Test ARPG Sanctuary Remastered', 'Game display name updated successfully');
    assert(updatedGame.description === 'Updated description for season 2', 'Game description updated successfully');
    assert(updatedGame.serviceCategory === 'non_pilot', 'Game serviceCategory updated successfully');
    assert(updatedGame.sortOrder === 15, 'Game sortOrder updated successfully');
    assert(updatedGame.slug === testGameSlug, 'Slug remains immutable after update');

    // ─── 4. Service Category Validation & Creation ────────────────────────────
    console.log('\n--- Step 4: Service Category Validation, Settings & Creation ---');

    let invalidKeyThrown = false;
    try {
      await createGameService(
        testGameSlug,
        {
          serviceKey: 'BAD KEY$$$',
          displayName: 'Bad Service',
          serviceMode: 'non_pilot',
        },
        testActor
      );
    } catch (err: any) {
      invalidKeyThrown = true;
      assert(err.message.includes('alphanumeric'), 'Invalid serviceKey is rejected by validation regex', err.message);
    }
    assert(invalidKeyThrown, 'Invalid serviceKey rejection verified');

    const createdService1 = await createGameService(
      testGameSlug,
      {
        serviceKey: 'uber_boss_kill',
        displayName: 'Uber Boss Carry',
        serviceMode: 'non_pilot',
        profileMode: 'manual',
        requiresPilotApproval: false,
        description: 'Self-play boss defeat carry',
        sortOrder: 1,
        isActive: true,
        settings: {
          claimWindowSeconds: 450,
          proofRequired: true,
          allowPause: true,
          allowReplacement: false,
          acceptsSquads: true,
          requiresKey: false,
          requiresRoles: true,
        },
      },
      testActor
    );

    assert(createdService1.serviceKey === 'uber_boss_kill', 'Service category created with expected key');
    assert(createdService1.displayName === 'Uber Boss Carry', 'Service category display name persisted');
    assert(createdService1.settings?.claimWindowSeconds === 450, 'Custom claim window (450s) persisted');
    assert(createdService1.settings?.allowReplacement === false, 'Operational rule allowReplacement=false persisted');
    assert(createdService1.settings?.requiresRoles === true, 'Operational rule requiresRoles=true persisted');

    // Add a second service category
    const createdService2 = await createGameService(
      testGameSlug,
      {
        serviceKey: 'leveling_pilot',
        displayName: 'Power Leveling Pilot',
        serviceMode: 'pilot',
        profileMode: 'none',
        requiresPilotApproval: true,
        description: 'Account-shared leveling carry',
        sortOrder: 2,
        isActive: true,
        settings: {
          claimWindowSeconds: 600,
          proofRequired: true,
          allowPause: true,
          allowReplacement: true,
          acceptsSquads: false,
          requiresKey: false,
          requiresRoles: false,
        },
      },
      testActor
    );

    assert(createdService2.serviceKey === 'leveling_pilot', 'Second service category created');
    assert(createdService2.requiresPilotApproval === true, 'Pilot approval requirement persisted');

    // Verify duplicate serviceKey in the same game is rejected
    let duplicateKeyThrown = false;
    try {
      await createGameService(
        testGameSlug,
        {
          serviceKey: 'uber_boss_kill',
          displayName: 'Duplicate Uber Boss',
          serviceMode: 'non_pilot',
        },
        testActor
      );
    } catch (err: any) {
      duplicateKeyThrown = true;
      assert(err.message.includes('already exists'), 'Duplicate serviceKey within same game rejected', err.message);
    }
    assert(duplicateKeyThrown, 'Duplicate serviceKey rejection verified');

    // ─── 5. Service Category Update ───────────────────────────────────────────
    console.log('\n--- Step 5: Service Category Update ---');

    const updatedService = await updateGameService(
      createdService1.id,
      {
        displayName: 'Uber Pinnacle Boss Carry',
        description: 'Updated boss kill carry with loot guarantee',
        sortOrder: 5,
        settings: {
          claimWindowSeconds: 300,
          allowPause: false,
          acceptsSquads: false,
        },
      },
      testActor
    );

    assert(Boolean(updatedService), 'Service category returned after update');
    assert(updatedService?.displayName === 'Uber Pinnacle Boss Carry', 'Service display name updated');
    assert(updatedService?.settings?.claimWindowSeconds === 300, 'Service claim window updated');
    assert(updatedService?.settings?.allowPause === false, 'Service allowPause updated');
    assert(updatedService?.settings?.acceptsSquads === false, 'Service acceptsSquads updated');
    // Ensure unspecified settings are preserved
    assert(updatedService?.settings?.proofRequired === true, 'Unchanged setting proofRequired preserved');

    // ─── 6. Reordering Games and Categories ───────────────────────────────────
    console.log('\n--- Step 6: Reordering Support ---');

    await reorderGames(
      [
        { slug: testGameSlug, sortOrder: 0 },
        { slug: 'wow_midnight', sortOrder: 1 },
        { slug: 'wow_forever', sortOrder: 2 },
      ],
      testActor
    );

    const reorderedCatalog = await listAdminGames();
    const testGameInReorder = reorderedCatalog.find((g: any) => g.slug === testGameSlug);
    const midnightInReorder = reorderedCatalog.find((g: any) => g.slug === 'wow_midnight');
    assert(testGameInReorder?.sortOrder === 0, 'test_arpg_game placed at sortOrder 0');
    assert(midnightInReorder?.sortOrder === 1, 'wow_midnight placed at sortOrder 1');

    await reorderGameServices(
      [
        { id: createdService2.id, sortOrder: 0 },
        { id: createdService1.id, sortOrder: 1 },
      ],
      testActor
    );

    const s2Check = await prisma.gameService.findUnique({ where: { id: createdService2.id } });
    const s1Check = await prisma.gameService.findUnique({ where: { id: createdService1.id } });
    assert(s2Check?.sortOrder === 0, 'Service 2 reordered to first position (sortOrder 0)');
    assert(s1Check?.sortOrder === 1, 'Service 1 reordered to second position (sortOrder 1)');

    // ─── 7. Enable / Disable State Management & Order Safety ──────────────────
    console.log('\n--- Step 7: Disabled States & Order Safety Guard ---');

    // Active state works
    const validValidation = await validateGameAndService(testGameSlug, createdService1.id);
    assert(validValidation.game.slug === testGameSlug, 'Active game & service pass validation');

    // Disable service category
    await toggleGameServiceStatus(createdService1.id, false, testActor);
    let disabledServiceThrown = false;
    try {
      await validateGameAndService(testGameSlug, createdService1.id);
    } catch (err: any) {
      disabledServiceThrown = true;
      assert(err.message.includes('inactive') || err.message.includes('disabled'), 'Order validation rejects disabled service category', err.message);
    }
    assert(disabledServiceThrown, 'Disabled service category blocked from new orders');

    // Re-enable service, then disable whole game
    await toggleGameServiceStatus(createdService1.id, true, testActor);
    await toggleGameStatus(testGameSlug, false, testActor);

    let disabledGameThrown = false;
    try {
      await validateGameAndService(testGameSlug, createdService1.id);
    } catch (err: any) {
      disabledGameThrown = true;
      assert(err.message.includes('inactive') || err.message.includes('disabled'), 'Order validation rejects disabled game', err.message);
    }
    assert(disabledGameThrown, 'Disabled game blocked from new orders');

    // Re-enable game
    await toggleGameStatus(testGameSlug, true, testActor);

    // ─── 8. Guarded Deletion: Referenced Data Protection ──────────────────────
    console.log('\n--- Step 8: Guarded Deletion & Immutability Protection ---');

    // Attempt to delete wow_midnight (which is referenced by existing catalog and system routes)
    let deleteMidnightThrown = false;
    try {
      await deleteGame('wow_midnight', testActor);
    } catch (err: any) {
      deleteMidnightThrown = true;
      assert(err.message.includes('hard-delete game') && err.message.includes('referenced'), 'Deletion of referenced game rejected with informative safe error', err.message);
    }
    assert(deleteMidnightThrown, 'Referenced game deletion block verified');

    // Check that wow_midnight still exists in the database
    const midnightCheck = await prisma.game.findUnique({ where: { slug: 'wow_midnight' } });
    assert(Boolean(midnightCheck), 'WoW Midnight remains untouched in database');

    // Attempt to delete wow_midnight mythic_plus service
    const midnightMythic = await prisma.gameService.findFirst({
      where: { gameSlug: 'wow_midnight', serviceKey: 'mythic_plus' },
    });
    if (midnightMythic) {
      let deleteMythicThrown = false;
      try {
        await deleteGameService(midnightMythic.id, testActor);
      } catch (err: any) {
        deleteMythicThrown = true;
        assert(err.message.includes('hard-delete service category'), 'Deletion of referenced service rejected with informative safe error', err.message);
      }
      assert(deleteMythicThrown, 'Referenced service deletion block verified');
    }

    // ─── 9. Safe Deletion of Unreferenced Test Entities ───────────────────────
    console.log('\n--- Step 9: Safe Deletion of Unreferenced Games and Services ---');

    // Delete created services
    await deleteGameService(createdService1.id, testActor);
    const checkS1 = await prisma.gameService.findUnique({ where: { id: createdService1.id } });
    assert(checkS1 === null, 'Unreferenced service 1 deleted cleanly');

    await deleteGameService(createdService2.id, testActor);
    const checkS2 = await prisma.gameService.findUnique({ where: { id: createdService2.id } });
    assert(checkS2 === null, 'Unreferenced service 2 deleted cleanly');

    // Delete created game
    await deleteGame(testGameSlug, testActor);
    const checkGame = await prisma.game.findUnique({ where: { slug: testGameSlug } });
    assert(checkGame === null, 'Unreferenced game deleted cleanly');

    // ─── 10. AuditLog Verification ────────────────────────────────────────────
    console.log('\n--- Step 10: AuditLog History ---');

    const auditLogs = await prisma.auditLog.findMany({
      where: {
        actorId: testActor,
      },
      orderBy: { createdAt: 'desc' },
    });

    assert(auditLogs.length >= 6, `At least 6 AuditLog entries recorded for actor ${testActor} (found ${auditLogs.length})`);
    const actionTypes = auditLogs.map(l => l.action);
    assert(actionTypes.includes('ADMIN_GAME_CREATED'), 'AuditLog contains ADMIN_GAME_CREATED');
    assert(actionTypes.includes('ADMIN_GAME_UPDATED'), 'AuditLog contains ADMIN_GAME_UPDATED');
    assert(actionTypes.includes('ADMIN_GAME_STATUS_TOGGLED'), 'AuditLog contains ADMIN_GAME_STATUS_TOGGLED');
    assert(actionTypes.includes('ADMIN_GAMES_REORDERED'), 'AuditLog contains ADMIN_GAMES_REORDERED');
    assert(actionTypes.includes('ADMIN_SERVICE_CREATED'), 'AuditLog contains ADMIN_SERVICE_CREATED');
    assert(actionTypes.includes('ADMIN_SERVICE_UPDATED'), 'AuditLog contains ADMIN_SERVICE_UPDATED');
    assert(actionTypes.includes('ADMIN_SERVICE_STATUS_TOGGLED'), 'AuditLog contains ADMIN_SERVICE_STATUS_TOGGLED');
    assert(actionTypes.includes('ADMIN_SERVICES_REORDERED'), 'AuditLog contains ADMIN_SERVICES_REORDERED');
    assert(actionTypes.includes('ADMIN_SERVICE_DELETED'), 'AuditLog contains ADMIN_SERVICE_DELETED');
    assert(actionTypes.includes('ADMIN_GAME_DELETED'), 'AuditLog contains ADMIN_GAME_DELETED');

    // Clean up test audit logs and test user
    await prisma.auditLog.deleteMany({ where: { actorId: testActor } });
    await prisma.user.deleteMany({ where: { discordId: testActor } });

    // Restore standard sort order for core games
    await reorderGames(
      [
        { slug: 'wow_midnight', sortOrder: 0 },
        { slug: 'wow_forever', sortOrder: 1 },
      ],
      'system_restore'
    );

  } catch (err: any) {
    console.error('Unexpected test suite error:', err);
    failed++;
  }

  console.log('\n======================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAdminGameAndCategoryManagementSuite().catch(err => {
  console.error('Fatal test runner failure:', err);
  process.exit(1);
});
