import prisma from '../database/db';
import { authorize } from './authorizationService';
import { Permission } from './permissionTypes';
import { validateDiscordChannel } from './discordProvisioningService';
import { validateBotChannelPermissions } from './orderPublicationChannelService';
import { getGlobalDiscordClient } from './orderDiscordService';

export const DISCORD_SNOWFLAKE = /^[1-9][0-9]{16,19}$/;
export async function configureChannelMapping(
  actorId: string,
  key: string,
  input: any,
  operation: 'create' | 'update' | 'remove',
) {
  if (!(await authorize(actorId, Permission.SERVICE_CONFIG_MANAGE)).allowed)
    throw new Error('PERMISSION_DENIED');
  if (!/^(reg|order_panel|publication|execution):[a-z0-9_:-]{1,120}$/.test(key))
    throw new Error('INVALID_MAPPING_KEY');
  return prisma.$transaction(async (tx) => {
    const existing = await tx.discordChannelMapping.findUnique({ where: { channelKey: key } });
    if (operation === 'create' && existing) throw new Error('DUPLICATE_MAPPING_KEY');
    if (operation !== 'create' && !existing) throw new Error('MAPPING_NOT_FOUND');
    const affected = existing || (operation === 'create' ? input : null);
    if (
      affected &&
      (affected.discordChannelId || affected.gameSlug || affected.channelType === 'GUILD_CATEGORY')
    ) {
      const active = await tx.order.count({
        where: {
          status: { notIn: ['completed', 'cancelled'] },
          OR: [
            ...(affected.discordChannelId
              ? [
                  { discordChannelId: affected.discordChannelId },
                  { executionChannelId: affected.discordChannelId },
                  { reviewChannelId: affected.discordChannelId },
                ]
              : []),
            ...(affected.gameSlug
              ? [
                  {
                    gameSlug: affected.gameSlug,
                    ...(affected.serviceId ? { serviceId: Number(affected.serviceId) } : {}),
                  },
                ]
              : []),
            ...(affected.channelType === 'GUILD_CATEGORY' ? [{}] : []),
          ],
        },
      });
      if (active)
        throw new Error(
          'ACTIVE_ORDER_WORKFLOW: Mapping is in use; complete or explicitly migrate active workflows first',
        );
    }
    if (operation === 'remove') {
      await tx.discordChannelMapping.delete({ where: { channelKey: key } });
      if (existing!.gameSlug && existing!.serviceMode)
        await tx.channelRoute.updateMany({
          where: {
            discordGuildId: existing!.guildId,
            gameSlug: existing!.gameSlug,
            serviceMode: existing!.serviceMode,
            discordChannelId: existing!.discordChannelId || '',
          },
          data: { isActive: false },
        });
    } else {
      if (
        !input ||
        typeof input.guildId !== 'string' ||
        typeof input.discordChannelId !== 'string' ||
        !DISCORD_SNOWFLAKE.test(input.guildId) ||
        !DISCORD_SNOWFLAKE.test(input.discordChannelId)
      )
        throw new Error('INVALID_DISCORD_SNOWFLAKE');
      for (const field of ['categoryName', 'channelName', 'purpose'])
        if (typeof input[field] !== 'string' || !input[field].trim() || input[field].length > 200)
          throw new Error('INVALID_MAPPING_LABEL');
      if (!['GUILD_TEXT', 'GUILD_CATEGORY'].includes(input.channelType))
        throw new Error('INVALID_CHANNEL_TYPE');
      if (input.isActive !== undefined && typeof input.isActive !== 'boolean')
        throw new Error('INVALID_ACTIVE_FLAG');
      const serviceId = input.serviceId ? Number(input.serviceId) : null;
      if (serviceId && !Number.isSafeInteger(serviceId)) throw new Error('INVALID_SERVICE');
      const gameSlug = input.gameSlug || null;
      if (gameSlug && !(await tx.game.findUnique({ where: { slug: gameSlug } })))
        throw new Error('GAME_NOT_FOUND');
      if (serviceId) {
        const service = await tx.gameService.findUnique({ where: { id: serviceId } });
        if (!service || service.gameSlug !== gameSlug) throw new Error('SERVICE_GAME_MISMATCH');
        if (input.serviceMode && input.serviceMode !== service.serviceMode)
          throw new Error('SERVICE_MODE_MISMATCH');
      }
      if (input.serviceMode && !['pilot', 'non_pilot'].includes(input.serviceMode))
        throw new Error('INVALID_SERVICE_MODE');
      if (
        existing &&
        (existing.gameSlug !== gameSlug ||
          existing.serviceId !== serviceId ||
          existing.serviceMode !== (input.serviceMode || null) ||
          existing.channelType !== input.channelType)
      )
        throw new Error(
          'WORKFLOW_SCOPE_IMMUTABLE: Create a separate mapping instead of repurposing an existing workflow',
        );
      const conflict = await tx.discordChannelMapping.findFirst({
        where: { guildId: input.guildId, discordChannelId: input.discordChannelId, channelKey: { not: key } },
      });
      if (conflict) throw new Error('CONFLICTING_CHANNEL_MAPPING');
      if (gameSlug && key.startsWith('publication:') && input.channelType === 'GUILD_TEXT') {
        const scope = await tx.discordChannelMapping.findFirst({
          where: {
            guildId: input.guildId,
            gameSlug,
            serviceId,
            serviceMode: input.serviceMode || null,
            channelType: 'GUILD_TEXT',
            channelKey: { startsWith: 'publication:', not: key },
          },
        });
        if (scope) throw new Error('CONFLICTING_PUBLICATION_WORKFLOW');
      }
      const data = {
        guildId: input.guildId,
        discordChannelId: input.discordChannelId,
        categoryName: input.categoryName.trim(),
        channelName: input.channelName.trim(),
        purpose: input.purpose.trim(),
        channelType: input.channelType,
        gameSlug,
        serviceId,
        serviceMode: input.serviceMode || null,
        isActive: input.isActive ?? true,
        syncStatus: input.isActive === false ? 'DISABLED' : 'MANUAL',
        lastSyncedAt: null,
        lastSyncResult: 'Saved configuration; live Discord connectivity has not been verified.',
      };
      if (operation === 'create')
        await tx.discordChannelMapping.create({ data: { ...data, channelKey: key } });
      else await tx.discordChannelMapping.update({ where: { channelKey: key }, data });
      // Keep an existing publication route coherent without deleting historical references.
      if (existing?.gameSlug && existing.serviceMode)
        await tx.channelRoute.updateMany({
          where: {
            discordGuildId: existing.guildId,
            gameSlug: existing.gameSlug,
            serviceMode: existing.serviceMode,
            discordChannelId: existing.discordChannelId || '',
          },
          data: {
            discordGuildId: data.guildId,
            discordChannelId: data.discordChannelId,
            isActive: data.isActive,
          },
        });
    }
    await tx.auditLog.create({
      data: {
        actorId,
        action: `DISCORD_MAPPING_${operation.toUpperCase()}`,
        entityType: 'DiscordChannelMapping',
        entityId: key,
        previousValues: existing ? JSON.stringify(existing) : null,
        newValues:
          operation === 'remove'
            ? null
            : JSON.stringify(await tx.discordChannelMapping.findUnique({ where: { channelKey: key } })),
        reason: 'Native React channel configuration; Discord channels are never deleted.',
      },
    });
    return { success: true };
  });
}

export async function inspectMappingConnectivity(key: string) {
  const mapping = await prisma.discordChannelMapping.findUnique({ where: { channelKey: key } });
  if (!mapping) throw new Error('MAPPING_NOT_FOUND');
  const client = getGlobalDiscordClient();
  if (!client)
    return { valid: false, error: 'DISCORD_CLIENT_NOT_INITIALIZED', savedStatus: mapping.syncStatus };
  try {
    const guild = client.guilds?.cache?.get(mapping.guildId) || (await client.guilds?.fetch(mapping.guildId));
    if (!guild) return { valid: false, error: 'GUILD_INACCESSIBLE' };
    const result = await validateDiscordChannel(
      mapping.discordChannelId || '',
      guild,
      mapping.channelType as 'GUILD_TEXT' | 'GUILD_CATEGORY',
    );
    if (!result.valid) return result;
    const channel =
      guild.channels?.cache?.get(mapping.discordChannelId) ||
      (await guild.channels.fetch(mapping.discordChannelId));
    const permissions = validateBotChannelPermissions(channel);
    if (!permissions.valid)
      return { valid: false, error: `BOT_PERMISSIONS_MISSING: ${permissions.missing.join(', ')}` };
    return { ...result, checkedAt: new Date().toISOString(), savedStatus: mapping.syncStatus };
  } catch {
    return { valid: false, error: 'DISCORD_API_FAILURE_OR_INACCESSIBLE_GUILD' };
  }
}
