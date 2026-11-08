/**
 * scripts/bootstrap-owner.ts — اسکریپت خط فرمان تعیین مالک اولیه سیستم (Owner Bootstrap CLI)
 * 
 * ویژگی‌ها:
 *  - منحصراً قابل اجرا از طریق CLI (فاقد هرگونه اندپوینت وب یا دستور دیسکورد)
 *  - دریافت Discord ID از متغیر محیطی یا آرگومان دستوری
 *  - اعتبارسنجی دقیق فرمت اسنوفلیک دیسکورد (۱۷ الی ۲۰ رقم عددی)
 *  - قفل امنیتی: عدم امکان ثبت مالک دوم یا تغییر مالک موجود
 *  - پایداری و Idempotency برای همان مالک
 */

import 'dotenv/config';
import prisma from '../src/database/db';
import { bootstrapOwner, validateDiscordSnowflake } from '../src/services/bootstrapService';

export { bootstrapOwner, validateDiscordSnowflake };

async function main() {
  console.log('=== G4X COMMUNITY — INITIAL OWNER BOOTSTRAP ===\n');

  // استخراج Discord ID از آرگومان‌های CLI یا متغیر محیطی
  let targetId = process.argv[2];

  // پشتیبانی از فلگ --discord-id=...
  if (targetId?.startsWith('--discord-id=')) {
    targetId = targetId.split('=')[1];
  }

  // در صورت عدم ارسال در آرگومان، بررسی متغیرهای محیطی
  if (!targetId) {
    targetId = process.env.OWNER_DISCORD_ID || process.env.BOOTSTRAP_OWNER_ID || '';
  }

  if (!targetId) {
    console.error('❌ Error: Owner Discord ID is required.');
    console.error('\nUsage:');
    console.error('  npx ts-node scripts/bootstrap-owner.ts <DISCORD_USER_ID>');
    console.error('  npx ts-node scripts/bootstrap-owner.ts --discord-id=<DISCORD_USER_ID>');
    console.error('  OWNER_DISCORD_ID=<DISCORD_USER_ID> npx ts-node scripts/bootstrap-owner.ts\n');
    process.exit(1);
  }

  try {
    const result = await bootstrapOwner(targetId);
    console.log(`✅ [SUCCESS] ${result.message}`);
    console.log(`Status: ${result.status.toUpperCase()}`);
    console.log(`Owner Discord ID: ${result.discordId}`);
    console.log('\nYou can now run `G4!setup registration` in your Discord server with this account.');
    process.exit(0);
  } catch (error: any) {
    console.error(`\n❌ [FAILED] Bootstrap rejected: ${error.message}\n`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}
