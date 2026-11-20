/**
 * systemSettingService.ts - General System Settings & Global Config Management
 */

import prisma from '../database/db';

export const DEFAULT_GLOBAL_CHANNEL_RULES = `🔒 **G4X Community — Fixed Operational Rules**
1. **Confidentiality:** Do not share customer information, account credentials, or internal details outside this channel.
2. **Streaming & Recording:** Streaming is strictly prohibited unless explicitly approved in order specifications.
3. **Communication:** Keep all order-related coordination strictly inside this temporary execution channel.
4. **Completion Proof:** Clear screenshot/video proof must be posted here upon completion before requesting closure.
5. **VPN & Security:** Follow the VPN and safety instructions specified for this order at all times.`;

export async function getSystemSetting(key: string, defaultValue: string = ''): Promise<string> {
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key },
    });
    return setting ? setting.value : defaultValue;
  } catch (err) {
    console.warn(`[SystemSetting] Failed to fetch key ${key}:`, err);
    return defaultValue;
  }
}

export async function setSystemSetting(
  key: string,
  value: string,
  actorId?: string,
  description?: string
): Promise<string> {
  const result = await prisma.systemSetting.upsert({
    where: { key },
    create: {
      key,
      value,
      description: description || null,
      updatedBy: actorId || null,
    },
    update: {
      value,
      description: description !== undefined ? description : undefined,
      updatedBy: actorId || null,
    },
  });
  return result.value;
}

export async function getGlobalChannelRules(): Promise<string> {
  return await getSystemSetting('discord_temp_channel_global_rules', DEFAULT_GLOBAL_CHANNEL_RULES);
}

export async function setGlobalChannelRules(rules: string, actorId?: string): Promise<string> {
  return await setSystemSetting(
    'discord_temp_channel_global_rules',
    rules,
    actorId,
    'Fixed Global Rules for Temporary Discord Execution Channels'
  );
}
