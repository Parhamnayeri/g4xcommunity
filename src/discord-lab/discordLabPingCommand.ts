import { Message } from 'discord.js';

export const DISCORD_LAB_PING_RESPONSE = 'G4X Staging Lab: pong';

/**
 * Minimal Discord Lab-only command handler for 'G4!ping'.
 *
 * Invariants:
 *  - Available ONLY when DISCORD_LAB_MODE === 'true'.
 *  - Returns exact string 'G4X Staging Lab: pong'.
 *  - ZERO database reads or writes (no prisma access).
 *  - ZERO channel creation, role changes, order creation, payments, or external services.
 *  - Never active in production bot.
 */
export async function handleDiscordLabPingCommand(message: Message): Promise<boolean> {
  if (process.env.DISCORD_LAB_MODE !== 'true') {
    return false;
  }

  await message.reply({ content: DISCORD_LAB_PING_RESPONSE });
  return true;
}
