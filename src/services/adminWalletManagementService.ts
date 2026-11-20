/**
 * src/services/adminWalletManagementService.ts
 *
 * Full administrative wallet control service for Boosters & Users:
 *  - Listing wallets with balance breakdowns and search
 *  - Atomic balance adjustments (BONUS / DEDUCT)
 *  - Atomic fund freezes/unfreezes and wallet-level freeze toggles
 *  - Immutable double-entry ledger & audit logging
 */

import prisma from '../database/db';

export interface WalletListItem {
  discordId: string;
  username: string;
  displayName: string;
  roles: string[];
  availableBalance: number;       // in USD, e.g. 10.50
  availableBalanceCents: number;  // in cents, e.g. 1050
  pendingEscrowBalance: number;   // in USD
  pendingEscrowCents: number;     // in cents
  frozenBalance: number;          // in USD
  frozenBalanceCents: number;     // in cents
  isFrozen: boolean;
  payoutAddress: string | null;
  payoutMethod: string | null;
  updatedAt: string;
}

export interface WalletListResult {
  wallets: WalletListItem[];
  totals: {
    totalUsersCount: number;
    totalAvailableUsd: number;
    totalEscrowUsd: number;
    totalFrozenUsd: number;
    frozenWalletsCount: number;
  };
}

export interface AdjustWalletInput {
  discordId: string;
  action: 'BONUS' | 'DEDUCT';
  amount: number; // in USD
  reason: string;
  allowNegative?: boolean;
  actorId?: string;
}

export interface FreezeWalletInput {
  discordId: string;
  mode: 'FREEZE_AMOUNT' | 'UNFREEZE_AMOUNT' | 'FREEZE_WALLET' | 'UNFREEZE_WALLET';
  amount?: number; // in USD, required for FREEZE_AMOUNT / UNFREEZE_AMOUNT
  reason: string;
  actorId?: string;
}

/**
 * Lists all user & booster wallets with balance breakdowns, search, and totals.
 */
export async function listUserWallets(search?: string): Promise<WalletListResult> {
  const searchTerm = search ? search.trim() : '';

  let whereClause: any = {};
  if (searchTerm) {
    whereClause = {
      OR: [
        { username: { contains: searchTerm } },
        { displayName: { contains: searchTerm } },
        { discordId: { contains: searchTerm } },
      ],
    };
  }

  const users = await prisma.user.findMany({
    where: whereClause,
    select: {
      discordId: true,
      username: true,
      displayName: true,
      userRoles: {
        select: {
          roleKey: true,
        },
      },
      wallet: true,
      walletV2: true,
      payoutPreference: {
        select: {
          cryptoAddress: true,
          cryptoNetwork: true,
          bankIban: true,
          bankAccountHolder: true,
        },
      },
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });

  let totalAvailableCents = 0;
  let totalEscrowCents = 0;
  let totalFrozenCents = 0;
  let frozenWalletsCount = 0;

  const wallets: WalletListItem[] = users.map((u) => {
    // Balances prioritize WalletV2, fallback to legacy Wallet, or 0
    const availableCents = u.walletV2?.availableCents ?? u.wallet?.balanceUsd ?? 0;
    const escrowCents = u.walletV2?.reservedCents ?? u.wallet?.escrowUsd ?? 0;
    const frozenCents = u.wallet?.frozenBalance ?? u.walletV2?.frozenCents ?? 0;
    const isFrozen = Boolean(u.wallet?.isFrozen || u.walletV2?.isFrozen);

    totalAvailableCents += availableCents;
    totalEscrowCents += escrowCents;
    totalFrozenCents += frozenCents;
    if (isFrozen) {
      frozenWalletsCount++;
    }

    const payoutAddress =
      u.payoutPreference?.cryptoAddress ||
      u.payoutPreference?.bankIban ||
      null;

    const payoutMethod = u.payoutPreference?.cryptoAddress
      ? 'CRYPTO_BEP20'
      : u.payoutPreference?.bankIban
      ? 'IRT_BANK'
      : null;

    const updatedAtDate = u.walletV2?.updatedAt || u.wallet?.updatedAt || u.createdAt;

    return {
      discordId: u.discordId,
      username: u.username,
      displayName: u.displayName || u.username,
      roles: u.userRoles.map((r) => r.roleKey),
      availableBalance: parseFloat((availableCents / 100).toFixed(2)),
      availableBalanceCents: availableCents,
      pendingEscrowBalance: parseFloat((escrowCents / 100).toFixed(2)),
      pendingEscrowCents: escrowCents,
      frozenBalance: parseFloat((frozenCents / 100).toFixed(2)),
      frozenBalanceCents: frozenCents,
      isFrozen,
      payoutAddress,
      payoutMethod,
      updatedAt: updatedAtDate.toISOString(),
    };
  });

  return {
    wallets,
    totals: {
      totalUsersCount: users.length,
      totalAvailableUsd: parseFloat((totalAvailableCents / 100).toFixed(2)),
      totalEscrowUsd: parseFloat((totalEscrowCents / 100).toFixed(2)),
      totalFrozenUsd: parseFloat((totalFrozenCents / 100).toFixed(2)),
      frozenWalletsCount,
    },
  };
}

/**
 * Adjusts a user's wallet balance atomically (BONUS or DEDUCT).
 * Records an immutable LedgerTransaction, LedgerEntryV2, and AuditLog.
 */
export async function adjustUserWalletBalance(input: AdjustWalletInput) {
  const { discordId, action, amount, reason, allowNegative, actorId } = input;

  if (action !== 'BONUS' && action !== 'DEDUCT') {
    throw new Error("INVALID_ACTION: Action must be either 'BONUS' or 'DEDUCT'");
  }

  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    throw new Error('INVALID_AMOUNT: Amount must be a positive number greater than 0');
  }

  const cleanReason = (reason || '').trim();
  if (!cleanReason) {
    throw new Error('MISSING_REASON: A descriptive reason is strictly required for balance adjustments');
  }

  const amountCents = Math.round(numAmount * 100);

  return await prisma.$transaction(async (tx) => {
    // Verify target user exists
    const user = await tx.user.findUnique({
      where: { discordId },
      include: { wallet: true, walletV2: true },
    });

    if (!user) {
      throw new Error(`USER_NOT_FOUND: User '${discordId}' does not exist`);
    }

    // Auto-create Wallet if missing
    let wallet = user.wallet;
    if (!wallet) {
      wallet = await tx.wallet.create({
        data: {
          userId: discordId,
          balanceUsd: 0,
          escrowUsd: 0,
          frozenBalance: 0,
          isFrozen: false,
        },
      });
    }

    // Auto-create WalletV2 if missing
    let walletV2 = user.walletV2;
    if (!walletV2) {
      walletV2 = await tx.walletV2.create({
        data: {
          userId: discordId,
          availableCents: 0,
          reservedCents: 0,
          frozenCents: 0,
          isFrozen: false,
        },
      });
    }

    const prevBalanceUsd = wallet.balanceUsd;
    const prevAvailableCents = walletV2.availableCents;

    let newBalanceUsd: number;
    let newAvailableCents: number;
    let entryType: string;
    let ledgerTxType: string;

    if (action === 'BONUS') {
      newBalanceUsd = prevBalanceUsd + amountCents;
      newAvailableCents = prevAvailableCents + amountCents;
      entryType = 'credit';
      ledgerTxType = 'ADMIN_BONUS';
    } else {
      // DEDUCT
      if (!allowNegative && (prevBalanceUsd < amountCents || prevAvailableCents < amountCents)) {
        throw new Error(
          `INSUFFICIENT_FUNDS: Available balance ($${(prevAvailableCents / 100).toFixed(2)}) is less than deduction amount ($${numAmount.toFixed(2)})`
        );
      }
      newBalanceUsd = prevBalanceUsd - amountCents;
      newAvailableCents = prevAvailableCents - amountCents;
      entryType = 'debit';
      ledgerTxType = 'ADMIN_DEDUCTION';
    }

    // Update Wallet (v1)
    const updatedWallet = await tx.wallet.update({
      where: { userId: discordId },
      data: {
        balanceUsd: newBalanceUsd,
      },
    });

    // Update WalletV2
    const updatedWalletV2 = await tx.walletV2.update({
      where: { userId: discordId },
      data: {
        availableCents: newAvailableCents,
      },
    });

    // Immutable Ledger Transaction (v1)
    const txRef = `TX_${ledgerTxType}_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    await tx.ledgerTransaction.create({
      data: {
        transactionRef: txRef,
        userId: discordId,
        currency: 'USD',
        amountMinor: amountCents,
        entryType,
        status: 'posted',
        createdBy: actorId ?? null,
      },
    });

    // Immutable Ledger Entry (v2)
    const entryRef = `L2_${ledgerTxType}_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    await tx.ledgerEntryV2.create({
      data: {
        entryRef,
        accountType: 'USER_WALLET',
        userId: discordId,
        amountCents,
        entryType: 'MANUAL_ADJUSTMENT',
        direction: action === 'BONUS' ? 'CREDIT' : 'DEBIT',
        balanceAfterAvailableCents: newAvailableCents,
        balanceAfterReservedCents: walletV2.reservedCents,
        description: `[${ledgerTxType}] ${cleanReason}`,
        metadata: JSON.stringify({
          action,
          amountUsd: numAmount,
          reason: cleanReason,
          actorId,
        }),
        createdBy: actorId ?? null,
      },
    });

    // Immutable Audit Log
    await tx.auditLog.create({
      data: {
        actorId: actorId ?? null,
        action: `WALLET_${action}`,
        entityType: 'Wallet',
        entityId: discordId,
        previousValues: JSON.stringify({
          balanceUsd: prevBalanceUsd,
          availableCents: prevAvailableCents,
        }),
        newValues: JSON.stringify({
          balanceUsd: newBalanceUsd,
          availableCents: newAvailableCents,
          adjustmentAmountCents: amountCents,
        }),
        reason: cleanReason,
        isSuccess: true,
      },
    });

    return {
      success: true,
      message: `Wallet for ${user.username} successfully updated (${action === 'BONUS' ? '+' : '-'}$${numAmount.toFixed(2)} USD).`,
      wallet: {
        discordId,
        availableBalance: parseFloat((newAvailableCents / 100).toFixed(2)),
        pendingEscrowBalance: parseFloat(((walletV2.reservedCents || wallet.escrowUsd) / 100).toFixed(2)),
        frozenBalance: parseFloat(((updatedWallet.frozenBalance || updatedWalletV2.frozenCents) / 100).toFixed(2)),
        isFrozen: Boolean(updatedWallet.isFrozen || updatedWalletV2.isFrozen),
      },
    };
  });
}

/**
 * Freezes / unfreezes specific funds or toggles wallet-level freeze state.
 * Moves funds between availableBalance and frozenBalance atomically.
 */
export async function freezeUserWallet(input: FreezeWalletInput) {
  const { discordId, mode, amount, reason, actorId } = input;

  const validModes = ['FREEZE_AMOUNT', 'UNFREEZE_AMOUNT', 'FREEZE_WALLET', 'UNFREEZE_WALLET'];
  if (!validModes.includes(mode)) {
    throw new Error(`INVALID_MODE: Mode must be one of: ${validModes.join(', ')}`);
  }

  const cleanReason = (reason || '').trim();
  if (!cleanReason) {
    throw new Error('MISSING_REASON: A reason is strictly required for wallet freeze / unfreeze operations');
  }

  return await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { discordId },
      include: { wallet: true, walletV2: true },
    });

    if (!user) {
      throw new Error(`USER_NOT_FOUND: User '${discordId}' does not exist`);
    }

    // Auto-create Wallet if missing
    let wallet = user.wallet;
    if (!wallet) {
      wallet = await tx.wallet.create({
        data: {
          userId: discordId,
          balanceUsd: 0,
          escrowUsd: 0,
          frozenBalance: 0,
          isFrozen: false,
        },
      });
    }

    // Auto-create WalletV2 if missing
    let walletV2 = user.walletV2;
    if (!walletV2) {
      walletV2 = await tx.walletV2.create({
        data: {
          userId: discordId,
          availableCents: 0,
          reservedCents: 0,
          frozenCents: 0,
          isFrozen: false,
        },
      });
    }

    let updatedWallet = wallet;
    let updatedWalletV2 = walletV2;
    let auditAction = `WALLET_${mode}`;
    let ledgerTxType = mode;
    let amountCents = 0;

    if (mode === 'FREEZE_WALLET') {
      updatedWallet = await tx.wallet.update({
        where: { userId: discordId },
        data: { isFrozen: true },
      });
      updatedWalletV2 = await tx.walletV2.update({
        where: { userId: discordId },
        data: { isFrozen: true },
      });
    } else if (mode === 'UNFREEZE_WALLET') {
      updatedWallet = await tx.wallet.update({
        where: { userId: discordId },
        data: { isFrozen: false },
      });
      updatedWalletV2 = await tx.walletV2.update({
        where: { userId: discordId },
        data: { isFrozen: false },
      });
    } else if (mode === 'FREEZE_AMOUNT') {
      const numAmount = Number(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        throw new Error('INVALID_AMOUNT: Amount must be greater than 0 to freeze funds');
      }
      amountCents = Math.round(numAmount * 100);

      if (wallet.balanceUsd < amountCents || walletV2.availableCents < amountCents) {
        throw new Error(
          `INSUFFICIENT_FUNDS: Available balance ($${(walletV2.availableCents / 100).toFixed(2)}) is less than amount to freeze ($${numAmount.toFixed(2)})`
        );
      }

      const newBalanceUsd = wallet.balanceUsd - amountCents;
      const newFrozenBalance = wallet.frozenBalance + amountCents;
      const newAvailableCents = walletV2.availableCents - amountCents;
      const newFrozenCents = walletV2.frozenCents + amountCents;

      updatedWallet = await tx.wallet.update({
        where: { userId: discordId },
        data: {
          balanceUsd: newBalanceUsd,
          frozenBalance: newFrozenBalance,
        },
      });

      updatedWalletV2 = await tx.walletV2.update({
        where: { userId: discordId },
        data: {
          availableCents: newAvailableCents,
          frozenCents: newFrozenCents,
        },
      });
    } else if (mode === 'UNFREEZE_AMOUNT') {
      const numAmount = Number(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        throw new Error('INVALID_AMOUNT: Amount must be greater than 0 to unfreeze funds');
      }
      amountCents = Math.round(numAmount * 100);

      const currentFrozen = Math.max(wallet.frozenBalance, walletV2.frozenCents);
      if (currentFrozen < amountCents) {
        throw new Error(
          `INSUFFICIENT_FROZEN_FUNDS: Frozen balance ($${(currentFrozen / 100).toFixed(2)}) is less than amount to unfreeze ($${numAmount.toFixed(2)})`
        );
      }

      const newBalanceUsd = wallet.balanceUsd + amountCents;
      const newFrozenBalance = Math.max(0, wallet.frozenBalance - amountCents);
      const newAvailableCents = walletV2.availableCents + amountCents;
      const newFrozenCents = Math.max(0, walletV2.frozenCents - amountCents);

      updatedWallet = await tx.wallet.update({
        where: { userId: discordId },
        data: {
          balanceUsd: newBalanceUsd,
          frozenBalance: newFrozenBalance,
        },
      });

      updatedWalletV2 = await tx.walletV2.update({
        where: { userId: discordId },
        data: {
          availableCents: newAvailableCents,
          frozenCents: newFrozenCents,
        },
      });
    }

    // Ledger Transaction
    const txRef = `TX_${ledgerTxType}_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    await tx.ledgerTransaction.create({
      data: {
        transactionRef: txRef,
        userId: discordId,
        currency: 'USD',
        amountMinor: amountCents,
        entryType: 'adjustment',
        status: 'posted',
        createdBy: actorId ?? null,
      },
    });

    // Ledger Entry V2
    const entryRef = `L2_${ledgerTxType}_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    await tx.ledgerEntryV2.create({
      data: {
        entryRef,
        accountType: 'USER_WALLET',
        userId: discordId,
        amountCents,
        entryType: 'MANUAL_ADJUSTMENT',
        direction: mode.startsWith('UNFREEZE') ? 'CREDIT' : 'DEBIT',
        balanceAfterAvailableCents: updatedWalletV2.availableCents,
        balanceAfterReservedCents: updatedWalletV2.reservedCents,
        description: `[${mode}] ${cleanReason}`,
        metadata: JSON.stringify({
          mode,
          amountCents,
          reason: cleanReason,
          actorId,
        }),
        createdBy: actorId ?? null,
      },
    });

    // Audit Log
    await tx.auditLog.create({
      data: {
        actorId: actorId ?? null,
        action: auditAction,
        entityType: 'Wallet',
        entityId: discordId,
        previousValues: JSON.stringify({
          isFrozen: wallet.isFrozen || walletV2.isFrozen,
          frozenBalance: wallet.frozenBalance,
          frozenCents: walletV2.frozenCents,
          availableCents: walletV2.availableCents,
        }),
        newValues: JSON.stringify({
          isFrozen: updatedWallet.isFrozen || updatedWalletV2.isFrozen,
          frozenBalance: updatedWallet.frozenBalance,
          frozenCents: updatedWalletV2.frozenCents,
          availableCents: updatedWalletV2.availableCents,
          amountCents,
        }),
        reason: cleanReason,
        isSuccess: true,
      },
    });

    return {
      success: true,
      message: `Operation '${mode}' successfully applied to user ${user.username}.`,
      wallet: {
        discordId,
        availableBalance: parseFloat((updatedWalletV2.availableCents / 100).toFixed(2)),
        pendingEscrowBalance: parseFloat(((updatedWalletV2.reservedCents || updatedWallet.escrowUsd) / 100).toFixed(2)),
        frozenBalance: parseFloat(((updatedWallet.frozenBalance || updatedWalletV2.frozenCents) / 100).toFixed(2)),
        isFrozen: Boolean(updatedWallet.isFrozen || updatedWalletV2.isFrozen),
      },
    };
  });
}

/**
 * Lists all advertiser deposit invoices for administrators with optional status filter and search.
 */
export async function listAdminDepositInvoices(statusFilter?: string, searchQuery?: string) {
  const where: any = {};
  if (statusFilter && statusFilter.toUpperCase() !== 'ALL') {
    where.status = statusFilter.toUpperCase();
  }
  if (searchQuery && searchQuery.trim()) {
    const q = searchQuery.trim();
    where.OR = [
      { intentRef: { contains: q } },
      { paymentId: { contains: q } },
      { user: { username: { contains: q } } },
      { user: { displayName: { contains: q } } },
      { user: { discordId: { contains: q } } },
    ];
  }

  const deposits = await prisma.depositIntent.findMany({
    where,
    include: {
      user: {
        select: {
          discordId: true,
          username: true,
          displayName: true,
          advertiserRank: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return {
    deposits: deposits.map((d) => ({
      id: d.id,
      intentRef: d.intentRef,
      userId: d.userId,
      username: d.user?.username || 'Unknown',
      displayName: d.user?.displayName || d.user?.username || 'Unknown',
      advertiserRank: d.user?.advertiserRank || 'BRONZE',
      amountUsd: d.amountUsd,
      payCurrency: d.payCurrency,
      paymentId: d.paymentId,
      invoiceUrl: d.invoiceUrl,
      status: d.status,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      confirmedAt: d.confirmedAt,
      provider: d.provider,
    })),
  };
}

/**
 * Manually confirms a WAITING deposit invoice and credits the amount to the advertiser's wallet.
 */
export async function adminConfirmDepositInvoice(depositId: number, actorId?: string, reason?: string) {
  return await prisma.$transaction(async (tx) => {
    const deposit = await tx.depositIntent.findUnique({
      where: { id: depositId },
      include: {
        user: {
          include: {
            wallet: true,
            walletV2: true,
          },
        },
      },
    });

    if (!deposit) {
      throw new Error(`DEPOSIT_NOT_FOUND: Deposit invoice #${depositId} not found`);
    }

    if (deposit.status === 'CONFIRMED') {
      throw new Error(`ALREADY_CONFIRMED: Deposit invoice #${depositId} is already confirmed`);
    }

    if (deposit.status === 'CANCELLED') {
      throw new Error(`ALREADY_CANCELLED: Deposit invoice #${depositId} has been cancelled`);
    }

    const discordId = deposit.userId;
    const amountCents = Math.round(deposit.amountUsd * 100);

    // Auto-create Wallet if missing
    let wallet = deposit.user.wallet;
    if (!wallet) {
      wallet = await tx.wallet.create({
        data: {
          userId: discordId,
          balanceUsd: 0,
          escrowUsd: 0,
          frozenBalance: 0,
          isFrozen: false,
        },
      });
    }

    // Auto-create WalletV2 if missing
    let walletV2 = deposit.user.walletV2;
    if (!walletV2) {
      walletV2 = await tx.walletV2.create({
        data: {
          userId: discordId,
          availableCents: 0,
          reservedCents: 0,
          frozenCents: 0,
          isFrozen: false,
        },
      });
    }

    const newBalanceUsd = wallet.balanceUsd + amountCents;
    const newAvailableCents = walletV2.availableCents + amountCents;

    // Update Wallet (v1)
    await tx.wallet.update({
      where: { userId: discordId },
      data: { balanceUsd: newBalanceUsd },
    });

    // Update WalletV2
    const updatedWalletV2 = await tx.walletV2.update({
      where: { userId: discordId },
      data: { availableCents: newAvailableCents },
    });

    // Immutable Ledger Transaction (v1)
    const txRef = `TX_DEPOSIT_CONFIRMED_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    await tx.ledgerTransaction.create({
      data: {
        transactionRef: txRef,
        userId: discordId,
        currency: 'USD',
        amountMinor: amountCents,
        entryType: 'credit',
        status: 'posted',
        createdBy: actorId ?? null,
      },
    });

    // Immutable Ledger Entry (v2)
    const entryRef = `L2_DEPOSIT_CONFIRMED_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    await tx.ledgerEntryV2.create({
      data: {
        entryRef,
        accountType: 'USER_WALLET',
        userId: discordId,
        amountCents,
        entryType: 'DEPOSIT',
        direction: 'CREDIT',
        balanceAfterAvailableCents: newAvailableCents,
        balanceAfterReservedCents: walletV2.reservedCents,
        description: `[DEPOSIT_CONFIRMED] NOWPayments Deposit Confirmed: $${deposit.amountUsd.toFixed(2)} (${deposit.payCurrency}) - Ref: ${deposit.intentRef}`,
        metadata: JSON.stringify({
          depositId: deposit.id,
          intentRef: deposit.intentRef,
          amountUsd: deposit.amountUsd,
          payCurrency: deposit.payCurrency,
          actorId,
          reason: reason || 'Owner/Admin manual deposit confirmation',
        }),
        createdBy: actorId ?? null,
      },
    });

    // Update DepositIntent
    let existingMeta: any = {};
    try {
      if (deposit.metadata) existingMeta = JSON.parse(deposit.metadata);
    } catch {}

    const updatedDeposit = await tx.depositIntent.update({
      where: { id: depositId },
      data: {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        metadata: JSON.stringify({
          ...existingMeta,
          confirmedBy: actorId ?? null,
          confirmedAt: new Date().toISOString(),
          manualConfirmation: true,
          reason: reason || 'Manual confirmation by administrator',
        }),
      },
    });

    // Audit Log
    await tx.auditLog.create({
      data: {
        actorId: actorId ?? null,
        action: 'DEPOSIT_CONFIRMED',
        entityType: 'DepositIntent',
        entityId: String(deposit.id),
        previousValues: JSON.stringify({
          status: deposit.status,
          amountUsd: deposit.amountUsd,
        }),
        newValues: JSON.stringify({
          status: 'CONFIRMED',
          amountUsd: deposit.amountUsd,
          creditedWalletBalanceUsd: newBalanceUsd,
          creditedWalletV2AvailableCents: newAvailableCents,
          actorId,
        }),
        reason: reason || 'Owner/Admin manual deposit confirmation and wallet balance credit',
        isSuccess: true,
      },
    });

    return {
      success: true,
      message: `Deposit invoice #${deposit.id} ($${deposit.amountUsd.toFixed(2)}) confirmed and credited to ${deposit.user.username}'s wallet.`,
      deposit: updatedDeposit,
      wallet: {
        discordId,
        availableBalance: parseFloat((updatedWalletV2.availableCents / 100).toFixed(2)),
        pendingEscrowBalance: parseFloat((updatedWalletV2.reservedCents / 100).toFixed(2)),
      },
    };
  });
}

/**
 * Cancels a WAITING deposit invoice on administrative request.
 */
export async function adminCancelDepositInvoice(depositId: number, actorId?: string, reason?: string) {
  return await prisma.$transaction(async (tx) => {
    const deposit = await tx.depositIntent.findUnique({
      where: { id: depositId },
      include: { user: true },
    });

    if (!deposit) {
      throw new Error(`DEPOSIT_NOT_FOUND: Deposit invoice #${depositId} not found`);
    }

    if (deposit.status === 'CONFIRMED') {
      throw new Error(`CANNOT_CANCEL: Deposit invoice #${depositId} is already confirmed and credited`);
    }

    if (deposit.status === 'CANCELLED') {
      throw new Error(`ALREADY_CANCELLED: Deposit invoice #${depositId} is already cancelled`);
    }

    let existingMeta: any = {};
    try {
      if (deposit.metadata) existingMeta = JSON.parse(deposit.metadata);
    } catch {}

    const updatedDeposit = await tx.depositIntent.update({
      where: { id: depositId },
      data: {
        status: 'CANCELLED',
        metadata: JSON.stringify({
          ...existingMeta,
          cancelledBy: actorId ?? null,
          cancelledAt: new Date().toISOString(),
          cancelReason: reason || 'Cancelled by administrator',
        }),
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: actorId ?? null,
        action: 'DEPOSIT_CANCELLED',
        entityType: 'DepositIntent',
        entityId: String(deposit.id),
        previousValues: JSON.stringify({ status: deposit.status }),
        newValues: JSON.stringify({ status: 'CANCELLED', actorId }),
        reason: reason || 'Cancelled by administrator',
        isSuccess: true,
      },
    });

    return {
      success: true,
      message: `Deposit invoice #${deposit.id} has been cancelled.`,
      deposit: updatedDeposit,
    };
  });
}
