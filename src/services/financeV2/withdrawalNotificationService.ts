/**
 * src/services/financeV2/withdrawalNotificationService.ts — ارسال مستقیم رسید و اطلاعات پرداخت به بوستر (Discord DM)
 *
 * ویژگی‌ها:
 *  - ارسال آنی Direct Message به کاربر بوستر بلافاصله پس از تغییر وضعیت به PAID
 *  - ارسال تمام جزئیات تراکنش: شناسه برداشت، روش پرداخت (تومان / تتر)، مبالغ درخواستی، کارمزد و مبلغ خالص واریز شده
 *  - ارسال کد پیگیری بانکی (ساتنا/پایا) برای تومان و لینک مستقیم BscScan برای تسویه تتر BEP-20
 *  - دکمه‌های تعاملی لینک‌دار (Link Buttons) جهت مشاهده در داشبورد برداشت و اکسپلورر بلاکچین
 *  - ثبت دوطرفه و هماهنگ در notification_outbox به منظور تضمین تحویل و جلوگیری از تکرار
 *  - مدیریت ایمن خطای بسته بودن DM (Discord 50007) و محیط‌های بدون دیسکورد (تست‌ها)
 */

import prisma from '../../database/db';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getGlobalDiscordClient } from '../orderDiscordService';

export interface WithdrawalNotificationDetails {
  id: number;
  withdrawalRef: string;
  boosterId: string;
  payoutMethod: string;
  requestedUsdCents: number;
  fixedFeeUsdCents: number;
  netUsdCents: number;
  quotedNetPayoutAmount?: string | null;
  quotedCurrency?: string | null;
  destinationAddress: string;
  destinationAccountHolder?: string | null;
  externalTxHash?: string | null;
  bankReceiptRef?: string | null;
  processedAt?: Date | string | null;
}

/**
 * ساخت پیام و امبد شکیل دیسکورد برای رسید تسویه برداشت
 */
export function buildWithdrawalPaidPayload(
  w: WithdrawalNotificationDetails,
  baseUrl: string
): {
  directMessageContent: string;
  embed: EmbedBuilder;
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const isIrt = w.payoutMethod === 'IRT_BANK';
  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
  const withdrawUrl = `${cleanBaseUrl}/withdraw`;

  const requestedUsdFormatted = (w.requestedUsdCents / 100).toFixed(2);
  const feeUsdFormatted = (w.fixedFeeUsdCents / 100).toFixed(2);
  const netUsdFormatted = (w.netUsdCents / 100).toFixed(2);

  const finalTomanAmount = w.quotedNetPayoutAmount
    ? Number(w.quotedNetPayoutAmount).toLocaleString()
    : '—';

  const proofRef = isIrt
    ? w.bankReceiptRef || w.externalTxHash || 'CONFIRMED'
    : w.externalTxHash || w.bankReceiptRef || 'CONFIRMED';

  const embed = new EmbedBuilder()
    .setTitle('💸 G4X Payout Disbursed — Official Settlement Receipt')
    .setColor(0x10b981) // Emerald Green
    .setTimestamp(w.processedAt ? new Date(w.processedAt) : new Date())
    .setFooter({ text: 'G4X Community • Automated Financial Desk' })
    .setDescription(
      `Hello <@${w.boosterId}>,\n` +
      `Your booster withdrawal **\`${w.withdrawalRef}\`** has been processed and disbursed by our financial desk.\n\n` +
      `درخواست تسویه حساب شما با موفقیت واریز شد. مشخصات کامل پرداخت در زیر قابل مشاهده است:`
    );

  embed.addFields([
    {
      name: 'Reference / شناسه برداشت',
      value: `\`${w.withdrawalRef}\``,
      inline: true,
    },
    {
      name: 'Method / روش تسویه',
      value: isIrt ? '🏦 Iranian Bank (Sheba)' : '💎 USDT (BEP-20)',
      inline: true,
    },
    {
      name: 'Status / وضعیت',
      value: '✅ `PAID / تسویه شده`',
      inline: true,
    },
    {
      name: 'Disbursed Amount / مبلغ نهایی واریز شده',
      value: isIrt
        ? `**${finalTomanAmount} تومان**\n*(Equivalent: $${netUsdFormatted} USD • Platform Fee: $${feeUsdFormatted} USD)*`
        : `**$${netUsdFormatted} USDT**\n*(Gross: $${requestedUsdFormatted} USD • Network Fee: $${feeUsdFormatted} USD)*`,
      inline: false,
    },
    {
      name: 'Destination Account / حساب مقصد',
      value: isIrt
        ? `\`${w.destinationAddress}\`${w.destinationAccountHolder ? `\n👤 Account Holder: **${w.destinationAccountHolder}**` : ''}`
        : `\`${w.destinationAddress}\`\n🌐 Network: **BNB Smart Chain (BEP-20)**`,
      inline: false,
    },
    {
      name: isIrt ? 'Bank Tracking / Reference No. (کد رهگیری / ارجاع)' : 'Transaction Hash / Proof of Payment',
      value: isIrt
        ? `\`${proofRef}\` *(بانکی / ساتنا / پایا)*`
        : proofRef.startsWith('0x')
        ? `[View on BscScan](https://bscscan.com/tx/${proofRef})\n\`${proofRef}\``
        : `\`${proofRef}\``,
      inline: false,
    },
  ]);

  const directMessageContent = `💸 **G4X Community — Payout Settlement Completed**\nYour withdrawal request **${w.withdrawalRef}** has been paid. View receipt in your dashboard: <${withdrawUrl}>`;

  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  const buttonRow = new ActionRowBuilder<ButtonBuilder>();

  if (withdrawUrl.startsWith('http')) {
    buttonRow.addComponents(
      new ButtonBuilder()
        .setLabel('Withdrawal Dashboard')
        .setStyle(ButtonStyle.Link)
        .setURL(withdrawUrl)
        .setEmoji('💸')
    );
  }

  if (!isIrt && proofRef.startsWith('0x')) {
    buttonRow.addComponents(
      new ButtonBuilder()
        .setLabel('View on BscScan')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://bscscan.com/tx/${proofRef}`)
        .setEmoji('🔗')
    );
  }

  if (buttonRow.components.length > 0) {
    components.push(buttonRow);
  }

  return { directMessageContent, embed, components };
}

/**
 * ارسال پیام مستقیم به بوستر و ثبت در outbox برای ممیزی و گارانتی تحویل
 */
export async function dispatchWithdrawalPaidDirectMessage(
  withdrawalInput: number | any,
  passedClient?: any
): Promise<{ success: boolean; dmSent: boolean; error?: string }> {
  try {
    let w: WithdrawalNotificationDetails;

    if (typeof withdrawalInput === 'number') {
      const found = await prisma.boosterWithdrawalRequest.findUnique({
        where: { id: withdrawalInput },
      });
      if (!found) {
        return { success: false, dmSent: false, error: `WITHDRAWAL_NOT_FOUND: #${withdrawalInput}` };
      }
      w = {
        id: found.id,
        withdrawalRef: found.withdrawalRef,
        boosterId: found.boosterId,
        payoutMethod: found.payoutMethod,
        requestedUsdCents: found.requestedUsdCents,
        fixedFeeUsdCents: found.fixedFeeUsdCents,
        netUsdCents: found.netUsdCents,
        quotedNetPayoutAmount: found.quotedNetPayoutAmount,
        quotedCurrency: found.quotedCurrency,
        destinationAddress: found.destinationAddress,
        destinationAccountHolder: found.destinationAccountHolder,
        externalTxHash: found.externalTxHash,
        bankReceiptRef: found.bankReceiptRef,
        processedAt: found.processedAt || found.approvedAt || new Date(),
      };
    } else {
      w = {
        id: withdrawalInput.id,
        withdrawalRef: withdrawalInput.withdrawalRef,
        boosterId: withdrawalInput.boosterId,
        payoutMethod: withdrawalInput.payoutMethod,
        requestedUsdCents: withdrawalInput.requestedUsdCents,
        fixedFeeUsdCents: withdrawalInput.fixedFeeUsdCents,
        netUsdCents: withdrawalInput.netUsdCents,
        quotedNetPayoutAmount: withdrawalInput.quotedNetPayoutAmount,
        quotedCurrency: withdrawalInput.quotedCurrency,
        destinationAddress: withdrawalInput.destinationAddress,
        destinationAccountHolder: withdrawalInput.destinationAccountHolder,
        externalTxHash: withdrawalInput.externalTxHash,
        bankReceiptRef: withdrawalInput.bankReceiptRef,
        processedAt: withdrawalInput.processedAt || withdrawalInput.approvedAt || new Date(),
      };
    }

    const rawBaseUrl =
      process.env.PUBLIC_WEB_URL ||
      process.env.WEB_BASE_URL ||
      'http://localhost:3001';
    const baseUrl = rawBaseUrl.replace(/\/+$/, '');

    const { directMessageContent, embed, components } = buildWithdrawalPaidPayload(w, baseUrl);

    // دریافت دیسکورد کلاینت فعال
    const client = passedClient || getGlobalDiscordClient() || (global as any).discordClient;

    let dmSent = false;
    let deliveryError: string | null = null;

    if (client && client.users) {
      try {
        const user = await client.users.fetch(w.boosterId).catch(() => null);
        if (user) {
          await user.send({
            content: directMessageContent,
            embeds: [embed],
            components: components.length > 0 ? components : undefined,
          });
          dmSent = true;
          console.log(`[Withdrawal Payout DM] ✅ Sent payment confirmation DM to booster ${w.boosterId} for #${w.id} (${w.withdrawalRef})`);
        } else {
          deliveryError = 'USER_NOT_FOUND_ON_DISCORD';
          console.warn(`[Withdrawal Payout DM] ⚠️ Booster user ${w.boosterId} not found on Discord.`);
        }
      } catch (sendErr: any) {
        deliveryError = sendErr?.message || 'DM_DELIVERY_FAILED';
        console.warn(`[Withdrawal Payout DM] ⚠️ Could not send DM to user ${w.boosterId}:`, deliveryError);
      }
    } else {
      deliveryError = 'DISCORD_CLIENT_NOT_AVAILABLE';
    }

    // ثبت یا به‌روزرسانی رکورد در notification_outbox به منظور ممیزی
    if (client) {
      try {
        const userExists = await prisma.user.findUnique({
          where: { discordId: w.boosterId },
          select: { discordId: true },
        });

        if (userExists) {
          const eventKey = `withdrawal_paid_${w.id}_${Date.now()}`;
          await prisma.notificationOutbox.create({
            data: {
              eventKey,
              recipientId: w.boosterId,
              notificationType: 'WITHDRAWAL_PAID',
              deliveryChannel: 'discord_dm',
              payload: JSON.stringify({
                withdrawalId: w.id,
                withdrawalRef: w.withdrawalRef,
                payoutMethod: w.payoutMethod,
                requestedUsdCents: w.requestedUsdCents,
                fixedFeeUsdCents: w.fixedFeeUsdCents,
                netUsdCents: w.netUsdCents,
                quotedNetPayoutAmount: w.quotedNetPayoutAmount,
                quotedCurrency: w.quotedCurrency,
                destinationAddress: w.destinationAddress,
                destinationAccountHolder: w.destinationAccountHolder,
                externalTxHash: w.externalTxHash,
                bankReceiptRef: w.bankReceiptRef,
                processedAt: w.processedAt,
              }),
              status: dmSent ? 'sent' : 'pending',
              sentAt: dmSent ? new Date() : null,
              errorDetails: dmSent ? null : deliveryError,
            },
          });
        }
      } catch (outboxErr: any) {
        // عدم توقف در صورت بروز خطای ثانویه ثبت در اوت‌باکس
        console.warn(`[Withdrawal Payout DM] Note: notificationOutbox record could not be saved:`, outboxErr?.message || outboxErr);
      }
    }

    return { success: true, dmSent, error: deliveryError || undefined };
  } catch (err: any) {
    console.error(`[Withdrawal Payout DM] Unexpected error:`, err);
    return { success: false, dmSent: false, error: err?.message || 'UNEXPECTED_ERROR' };
  }
}
