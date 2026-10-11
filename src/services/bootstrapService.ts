/**
 * src/services/bootstrapService.ts — سرویس امن تعیین مالک اولیه سیستم (Initial Owner Bootstrap Service)
 * 
 * ویژگی‌ها:
 *  - اعتبارسنجی دقیق فرمت اسنوفلیک دیسکورد (۱۷ الی ۲۰ رقم عددی)
 *  - قفل امنیتی: عدم امکان ثبت مالک دوم یا تغییر مالک موجود
 *  - پایداری و Idempotency برای همان مالک
 *  - اجرای اتمیک درون تراکنش Prisma و ثبت کامل لاگ ممیزی در AuditLog
 */

import prisma from '../database/db';

export const DISCORD_SNOWFLAKE_REGEX = /^\d{17,20}$/;

export interface BootstrapOwnerOptions {
  username?: string;
  client?: any; // پشتیبانی از کلاینت تستی ایزوله یا کلاینت اصلی
}

export interface BootstrapOwnerResult {
  success: boolean;
  discordId: string;
  status: 'created' | 'already_owner';
  message: string;
}

/**
 * اعتبارسنجی فرمت اسنوفلیک دیسکورد
 */
export function validateDiscordSnowflake(discordId: string): void {
  if (!discordId || typeof discordId !== 'string') {
    throw new Error('INVALID_DISCORD_ID: Discord ID is required and must be a string');
  }

  const trimmed = discordId.trim();
  if (!DISCORD_SNOWFLAKE_REGEX.test(trimmed)) {
    throw new Error(
      `INVALID_DISCORD_ID: Discord ID '${trimmed}' is invalid. Must be a numeric snowflake (17 to 20 digits)`
    );
  }
}

/**
 * تابع اصلی تعیین مالک اولیه سیستم
 */
export async function bootstrapOwner(
  rawDiscordId: string,
  options: BootstrapOwnerOptions = {}
): Promise<BootstrapOwnerResult> {
  const discordId = rawDiscordId?.trim();
  validateDiscordSnowflake(discordId);

  const db = options.client || prisma;

  // ۱. بررسی وجود هرگونه مالک قبلی در سیستم (Security Lock)
  const existingOwnerRole = await db.userRole.findFirst({
    where: { roleKey: 'owner' },
  });

  if (existingOwnerRole) {
    if (existingOwnerRole.userId === discordId) {
      // عملیات تکراری برای همان مالک (Idempotent)
      return {
        success: true,
        discordId,
        status: 'already_owner',
        message: `User '${discordId}' is already the registered system Owner. No modifications required.`,
      };
    } else {
      // مالک دیگری در دیتابیس وجود دارد؛ ممانعت کامل از ثبت مالک دوم
      throw new Error(
        `BOOTSTRAP_LOCKED: A system Owner is already registered (${existingOwnerRole.userId}). Cannot register a second owner.`
      );
    }
  }

  // ۲. اجرای تراکنش اتمیک ایجاد/تخصیص نقش مالک و ثبت ممیزی
  return await db.$transaction(async (tx: any) => {
    // ۲.۱ اطمینان از وجود نقش 'owner' در جدول roles
    await tx.role.upsert({
      where: { roleKey: 'owner' },
      update: { name: 'Owner' },
      create: { roleKey: 'owner', name: 'Owner' },
    });

    // ۲.۲ ایجاد یا به‌روزرسانی امن کاربر بدون دستکاری فیلدهای حساس
    const username = options.username || `owner_${discordId.slice(-4)}`;
    await tx.user.upsert({
      where: { discordId },
      update: { isActive: true },
      create: {
        discordId,
        username,
        isActive: true,
      },
    });

    // ۲.۳ تخصیص رول 'owner' به کاربر با حفظ سایر نقش‌های موجود
    await tx.userRole.upsert({
      where: {
        userId_roleKey: {
          userId: discordId,
          roleKey: 'owner',
        },
      },
      update: {
        grantedBy: null,
        grantedAt: new Date(),
      },
      create: {
        userId: discordId,
        roleKey: 'owner',
        grantedBy: null,
        grantedAt: new Date(),
      },
    });

    // ۲.۴ ثبت لاگ ممیزی بدون درز کلیدها یا داده‌های محرمانه
    await tx.auditLog.create({
      data: {
        actorId: discordId,
        action: 'INITIAL_OWNER_BOOTSTRAP',
        entityType: 'UserRole',
        entityId: discordId,
        newValues: JSON.stringify({
          roleKey: 'owner',
          grantedBy: 'system_bootstrap',
        }),
        reason: 'Initial secure system owner bootstrap via CLI',
        isSuccess: true,
      },
    });

    return {
      success: true,
      discordId,
      status: 'created',
      message: `User '${discordId}' successfully bootstrapped as system Owner.`,
    };
  });
}
