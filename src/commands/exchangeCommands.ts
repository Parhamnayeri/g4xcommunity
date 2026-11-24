/**
 * src/commands/exchangeCommands.ts
 *
 * G4!exchange Bot Command Handler — G4X Community Exchange Phase 6.
 *
 * Supported Commands:
 *  - G4!exchange info                   — Live trade overview & pricing breakdown
 *  - G4!exchange proof [attach files]   — Delivery proof requirements & Discord upload logger
 *  - G4!exchange confirm                — Buyer ONLY confirms receipt -> AWAITING_FINAL_APPROVAL
 *  - G4!exchange dispute [reason]       — Opens dispute & freezes escrow (FROZEN_DISPUTE)
 *  - G4!exchange done                   — Staff/Admin ONLY flags trade for Final Review on Web
 *  - G4!exchange close                  — Staff/Admin ONLY archives completed/cancelled room (NEVER deletes)
 */

import { Message, EmbedBuilder } from 'discord.js';
import prisma from '../database/db';
import { isActorStaffOrHigher } from '../services/orderChannelArchiveService';
import {
  archiveExchangeDiscordRoom,
  buildTradeInfoEmbed,
  buildTradeDisputeEmbed,
  getPublicWebUrl,
} from '../services/exchangeDiscordService';
import { logExchangeAudit } from '../services/exchangeConfigService';
import { getSystemSetting } from '../services/systemSettingService';
import { getGlobalDiscordClient } from '../services/orderDiscordService';
import {
  submitExchangeProof,
  confirmExchangeDeliveryByBuyer,
} from '../services/exchangeSettlementService';
import {
  openExchangeDispute,
} from '../services/exchangeDisputeService';


/**
 * Sends an alert message to the configured exchange alert channel (if any).
 */
async function sendExchangeAlert(embed: EmbedBuilder): Promise<void> {
  const alertChannelId = await getSystemSetting(
    'exchange_alert_channel_id',
    process.env.DISCORD_EXCHANGE_ALERT_CHANNEL_ID || ''
  );

  if (!alertChannelId) return;

  const client = getGlobalDiscordClient();
  if (!client) return;

  try {
    const channel =
      client.channels?.cache?.get(alertChannelId) ||
      (await client.channels?.fetch?.(alertChannelId).catch(() => null));

    if (channel && typeof channel.send === 'function') {
      await channel.send({ embeds: [embed] }).catch(() => {});
    }
  } catch (err: any) {
    console.warn('[ExchangeDiscord] Failed to send alert to alertChannel:', err.message);
  }
}

/**
 * Handles incoming `G4!exchange` command.
 */
export async function handleExchangeCommand(message: Message, args: string[]): Promise<void> {
  const subcommand = args[0]?.toLowerCase();
  const publicUrl = getPublicWebUrl();

  if (!subcommand || subcommand === 'help') {
    const helpEmbed = new EmbedBuilder()
      .setColor(0x2196f3)
      .setTitle('🤝 G4X Exchange Bot Commands Guide')
      .setDescription(
        'Use these commands inside your private trade channel to coordinate and update trade milestones:\n\n' +
        '• `G4!exchange info` — View live trade details, pricing, and escrow status\n' +
        '• `G4!exchange proof` — View delivery proof guidelines or attach screenshots directly\n' +
        '• `G4!exchange confirm` — **(Buyer Only)** Confirm in-game receipt of goods\n' +
        '• `G4!exchange dispute [reason]` — Open a dispute and freeze escrow funds\n' +
        '• `G4!exchange done` — **(Admin/Owner)** Flag trade for Final Review on Web\n' +
        '• `G4!exchange close` — **(Admin/Owner)** Archive closed trade room\n\n' +
        `🔗 **[Open G4X Web Portal](${publicUrl}/exchange)**`
      )
      .setFooter({ text: 'G4X Exchange Protected Escrow' });

    await message.reply({ embeds: [helpEmbed] });
    return;
  }

  // 1. Resolve room via database (channelId -> tradeId)
  let room = await prisma.exchangeDiscordRoom.findUnique({
    where: { channelId: message.channel.id },
    include: {
      trade: {
        include: {
          game: true,
          currency: true,
          region: true,
          deliveryMethod: true,
          escrow: true,
          discordRoom: true,
        },
      },
    },
  });

  // Fallback for Admins running `G4!exchange info <tradeCode>` outside the room
  if (!room) {
    if (subcommand === 'info' && args[1]) {
      const isStaff = await isActorStaffOrHigher(message.author.id, message.member);
      if (isStaff) {
        const trade = await prisma.exchangeTrade.findFirst({
          where: {
            OR: [{ id: args[1] }, { tradeCode: args[1] }],
          },
          include: {
            game: true,
            currency: true,
            region: true,
            deliveryMethod: true,
            escrow: true,
            discordRoom: true,
          },
        });
        if (trade) {
          const embed = buildTradeInfoEmbed(trade, publicUrl);
          await message.reply({ embeds: [embed] });
          return;
        }
      }
    }

    await message.reply('⚠️ This command must be used inside a private G4X Exchange trade room.');
    return;
  }

  const trade = room.trade;
  const isBuyer = trade.buyerDiscordId === message.author.id;
  const isSeller = trade.sellerDiscordId === message.author.id;
  const isStaff = await isActorStaffOrHigher(message.author.id, message.member);

  // 2. Dispatch Subcommands
  switch (subcommand) {
    // ─── G4!exchange info ─────────────────────────────────────────────────────
    case 'info': {
      if (!isBuyer && !isSeller && !isStaff) {
        await message.reply('❌ Unauthorized: You are not a participant in this trade.');
        return;
      }

      const embed = buildTradeInfoEmbed(trade, publicUrl);
      await message.reply({ embeds: [embed] });
      break;
    }

    // ─── G4!exchange proof ────────────────────────────────────────────────────
    case 'proof': {
      if (!isBuyer && !isSeller && !isStaff) {
        await message.reply('❌ Unauthorized: You are not a participant in this trade.');
        return;
      }

      // Check for attached images/files in the command message
      const attachments = message.attachments ? Array.from(message.attachments.values()) : [];
      if (attachments.length > 0) {
        const attachmentUrls = attachments.map((a) => a.url);

        await submitExchangeProof({
          tradeId: trade.id,
          submittedByUserId: isSeller ? trade.sellerUserId : isBuyer ? trade.buyerUserId : message.author.id,
          submittedByDiscordId: message.author.id,
          submitterRole: isSeller ? 'SELLER' : isBuyer ? 'BUYER' : 'ADMIN',
          fileUrl: attachmentUrls[0],
          evidenceLinks: attachmentUrls,
          note: `Shared ${attachments.length} proof attachment(s) in Discord.`,
        });

        await prisma.exchangeTradeEvent.create({
          data: {
            tradeId: trade.id,
            eventType: 'PROOF_SHARED_IN_DISCORD',
            actorDiscordId: message.author.id,
            actorRole: isSeller ? 'SELLER' : isBuyer ? 'BUYER' : 'ADMIN',
            fromStatus: trade.status,
            toStatus: trade.status,
            note: `Shared ${attachments.length} proof attachment(s) in Discord: ${attachmentUrls[0]}`,
            metadataJson: JSON.stringify({ urls: attachmentUrls }),
          },
        });

        await message.reply(
          `✅ **Proof Received!** ${attachments.length} attachment(s) logged in the Trade Audit Timeline.\n` +
          `You can also manage formal proof submissions directly on the **[Web Portal](${publicUrl}/exchange/trades/${trade.id})**.`
        );
        return;
      }

      // Structured guidelines based on delivery method
      const methodName = trade.deliveryMethod?.name || 'In-Game Delivery';
      const proofEmbed = new EmbedBuilder()
        .setColor(0x00bcd4) // Cyan
        .setTitle(`📸 Delivery Proof Instructions — ${methodName}`)
        .setDescription(
          `For your protection and prompt payout, please ensure clear delivery evidence is documented:\n\n` +
          `• **Screenshot / Video:** Capture full-screen trade window showing character names, items/gold, and chat timestamp.\n` +
          `• **In-Game Chat:** Ensure trade recipient confirms character identity before trading.\n` +
          `• **Quick Upload:** Simply send the screenshot directly in this Discord channel with \`G4!exchange proof\`, or upload via the web link below.\n\n` +
          `🔗 **[Formal Proof Upload on Web Portal](${publicUrl}/exchange/trades/${trade.id})**`
        )
        .setFooter({ text: 'Both Discord & Web submissions are permanently preserved in audit logs.' });

      await message.reply({ embeds: [proofEmbed] });
      break;
    }

    // ─── G4!exchange confirm ──────────────────────────────────────────────────
    case 'confirm': {
      if (!isBuyer) {
        await message.reply('❌ Only the Trade Buyer can confirm delivery.');
        return;
      }

      try {
        await confirmExchangeDeliveryByBuyer({
          tradeId: trade.id,
          buyerUserId: trade.buyerUserId,
          buyerDiscordId: message.author.id,
          note: 'Buyer confirmed receipt via Discord G4!exchange confirm.',
        });

        await message.reply(
          '✅ **Delivery Confirmed by Buyer!**\n' +
          'The trade is now placed in the **Admin/Owner Final Review Queue** for payout settlement.\n' +
          'Funds remain safely protected in Escrow until final administrative sign-off.'
        );
      } catch (err: any) {
        await message.reply(`❌ ${err.message}`);
      }
      break;
    }

    // ─── G4!exchange dispute [reason] ─────────────────────────────────────────
    case 'dispute': {
      if (!isBuyer && !isSeller && !isStaff) {
        await message.reply('❌ Unauthorized: Only participants or staff can dispute this trade.');
        return;
      }

      const reason = args.slice(1).join(' ').trim() || 'Dispute opened by participant in Discord';

      try {
        await openExchangeDispute({
          tradeId: trade.id,
          openedByUserId: isBuyer ? trade.buyerUserId : isSeller ? trade.sellerUserId : message.author.id,
          openedByDiscordId: message.author.id,
          openedByRole: isBuyer ? 'BUYER' : isSeller ? 'SELLER' : 'ADMIN',
          category: 'OTHER',
          description: reason,
        });

        const disputeEmbed = buildTradeDisputeEmbed(trade, reason, message.author.id, publicUrl);
        await message.reply({
          content: '🚨 **Dispute Opened!**\nEscrow funds have been frozen (`FROZEN_DISPUTE`). G4X Staff have been alerted to review evidence.',
          embeds: [disputeEmbed],
        });
      } catch (err: any) {
        await message.reply(`❌ ${err.message}`);
      }
      break;
    }

    // ─── G4!exchange done ─────────────────────────────────────────────────────
    case 'done': {
      if (!isStaff) {
        await message.reply('❌ Only G4X Admin or Owner can start Final Review.');
        return;
      }

      if (['CANCELLED', 'COMPLETED', 'DISPUTED'].includes(trade.status)) {
        await message.reply(`❌ Cannot start final review for trade in status '${trade.status}'.`);
        return;
      }

      await prisma.exchangeTrade.update({
        where: { id: trade.id },
        data: { status: 'AWAITING_FINAL_APPROVAL' },
      });

      await prisma.exchangeTradeEvent.create({
        data: {
          tradeId: trade.id,
          eventType: 'FINAL_REVIEW_STARTED',
          actorDiscordId: message.author.id,
          actorRole: 'STAFF',
          fromStatus: trade.status,
          toStatus: 'AWAITING_FINAL_APPROVAL',
          note: 'Admin/Owner initiated final review in Discord.',
        },
      });

      await logExchangeAudit({
        actorId: message.author.id,
        action: 'FINAL_REVIEW_STARTED',
        entityType: 'ExchangeTrade',
        entityId: trade.id,
        previousValues: { status: trade.status },
        newValues: { status: 'AWAITING_FINAL_APPROVAL' },
        reason: 'Staff initiated final review in Discord channel.',
      });

      const doneEmbed = new EmbedBuilder()
        .setColor(0x5c6bc0)
        .setTitle(`🔍 Final Review Initiated — ${trade.tradeCode}`)
        .setDescription(
          `Staff has initiated final review for Trade **${trade.tradeCode}**.\n` +
          `To finalize the order, release Escrow, and credit the Seller, complete the payout on the Web Admin Panel:\n\n` +
          `🔗 **[Complete Settlement on Web Portal](${publicUrl}/exchange/trades/${trade.id})**\n\n` +
          `*(Strict Security Rule: The Discord bot never performs direct wallet balance mutations.)*`
        )
        .setTimestamp();

      await message.reply({ embeds: [doneEmbed] });
      break;
    }

    // ─── G4!exchange close ────────────────────────────────────────────────────
    case 'close': {
      if (!isStaff) {
        await message.reply('❌ Only G4X Admin or Owner can close this trade room.');
        return;
      }

      if (trade.status !== 'COMPLETED' && trade.status !== 'CANCELLED') {
        await message.reply(
          `⚠️ Cannot close this room: Trade status is currently **${trade.status}**.\n` +
          `The trade must be **COMPLETED** or **CANCELLED** on the Web Admin Panel before closing this channel.`
        );
        return;
      }

      await archiveExchangeDiscordRoom(trade.id, message.author.id, 'Closed via G4!exchange close');
      await message.reply('🔒 **Trade room has been archived and locked.** All message history is permanently preserved.');
      break;
    }

    default:
      await message.reply(`❌ Unknown exchange subcommand: \`${subcommand}\`. Type \`G4!exchange help\` for usage.`);
  }
}
