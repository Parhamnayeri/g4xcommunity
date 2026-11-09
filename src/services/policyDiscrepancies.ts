/**
 * policyDiscrepancies.ts — Policy-to-Implementation Discrepancy Evaluation
 *
 * In accordance with Section 9 of Task 6:
 * Identifies areas where public policy statements represent operational/legal guidelines
 * or require manual team discretion rather than automated backend code execution.
 */

export interface PolicyDiscrepancyWarning {
  id: string;
  section: string;
  severity: 'WARNING' | 'INFO';
  policyStatement: string;
  operationalReality: string;
}

export const POLICY_DISCREPANCY_WARNINGS: PolicyDiscrepancyWarning[] = [
  {
    id: 'PENALTY_1_TO_1000',
    section: '2.E (Booster Rules — Replacements & Penalties)',
    severity: 'WARNING',
    policyStatement:
      'Failing to complete a boost, abandoning an order, or claiming an order by mistake will result in a penalty ranging from $1 to $1,000, determined at the discretion of the G4X Team.',
    operationalReality:
      'Penalties are manual administrative and disciplinary determinations handled via Support Tickets. There is no automated fine deduction engine; all financial adjustments require manual ledger entries.',
  },
  {
    id: 'PENALTY_1_TO_10000',
    section: '2.E (Booster Rules — Severe Violations & Sabotage)',
    severity: 'WARNING',
    policyStatement:
      'Severe Violations & Sabotage... will result in a financial penalty of $1 to $10,000, permanent account termination, and the immediate cancellation/forfeiture of any pending withdrawal requests.',
    operationalReality:
      'Account termination and cancellation of pending withdrawals are manual administrative actions. The system does not automatically seize funds or confiscate pending withdrawal balances.',
  },
  {
    id: 'WITHDRAWAL_FORFEITURE',
    section: '2.E (Booster Rules — Replacements & Penalties)',
    severity: 'WARNING',
    policyStatement:
      'Immediate cancellation/forfeiture of any pending withdrawal requests.',
    operationalReality:
      'Pending withdrawals can only be rejected by an Admin with a recorded audit reason via the Admin Withdrawal Queue. Automatic forfeiture is prohibited by financial invariants.',
  },
  {
    id: 'ADVERTISER_12H_AUTO_COMPLETION',
    section: '3 (Advertiser Rules) & 5.A (Booster Payout Schedule)',
    severity: 'WARNING',
    policyStatement:
      "Orders that are not reviewed or confirmed by the Advertiser within 12 hours of the Booster's completion notice will be reviewed by the G4X Team and marked as Completed if verified.",
    operationalReality:
      'The 12-hour window flags the order for operational escalation in the G4X Staff Queue. Orders are not auto-completed without authorized human verification.',
  },
  {
    id: 'EXCHANGER_1H_SETTLEMENT',
    section: '4 (Exchanger Rules — 1-Hour Settlement Limit)',
    severity: 'WARNING',
    policyStatement:
      'After receiving the currency, the Exchanger must settle the payment within 1 hour. Failure to settle within 1 hour will result in order cancellation and escalation to the G4X Team, which may lead to fines or account suspension.',
    operationalReality:
      'The 1-hour deadline is an operational escalation threshold. The system does not automatically cancel orders or suspend accounts without human review.',
  },
  {
    id: 'EXCHANGER_4H_EXPIRATION',
    section: '4 (Exchanger Rules — 4-Hour Order Expiration)',
    severity: 'WARNING',
    policyStatement:
      'Currency orders not completed within 4 hours are automatically sent to the G4X Team for review.',
    operationalReality:
      'Orders exceeding 4 hours are highlighted in the management review queue; collateral is not automatically cancelled.',
  },
  {
    id: 'BOOSTER_3D_CONFIRMATION_HOLD',
    section: '5.A (Booster Payout Schedule)',
    severity: 'WARNING',
    policyStatement:
      'G4X Official Orders: Funds undergo a 3-day customer confirmation hold, then move to "Pending Payout," and become available for withdrawal once approved by the G4X Team.',
    operationalReality:
      'Escrow holds require manual staff inspection. Automated release is strictly disabled under ESCROW_RELEASE_ENABLED=false.',
  },
  {
    id: 'MIN_WITHDRAWAL_USD_6',
    section: '5.A (Booster Payout Schedule)',
    severity: 'INFO',
    policyStatement:
      'Users must have a minimum balance of $6 to request a withdrawal.',
    operationalReality:
      'Confirmed: Exactly matches backend rule MIN_WITHDRAWAL_USD_CENTS = 600 ($6.00 USD).',
  },
  {
    id: 'ADVERTISER_COMMISSION_RATES',
    section: '5.B (Advertiser Order Commissions Table)',
    severity: 'INFO',
    policyStatement:
      'Bronze 14.99%, Silver 12.99%, Gold 10.99%, Diamond 8.99%, Founding Partner 8.99%, Official Partner 6.99%.',
    operationalReality:
      'Confirmed: Exactly matches ADVERTISER_RANK_RATES_BPS in advertiserRankService.ts.',
  },
  {
    id: 'NOWPAYMENTS_SETTLEMENT',
    section: '4 & 5.C (Settlement Methods & Fees)',
    severity: 'WARNING',
    policyStatement:
      'Cryptocurrency via the NOWPayments gateway... Network Gas Fees and NOWPayments processing fees are covered by the user.',
    operationalReality:
      'NOWPayments live collection is currently disabled (NOWPAYMENTS_LIVE_COLLECTION_ENABLED=false). Crypto transactions are processed manually.',
  },
  {
    id: 'KYC_DATA_SECURITY',
    section: '6 (KYC & Data Privacy)',
    severity: 'WARNING',
    policyStatement:
      'All KYC documents are stored securely and encrypted by G4X and are strictly confidential.',
    operationalReality:
      'Documents are stored in restricted server storage with strict RBAC (Admin/Owner only via Permission.SENSITIVE_IDENTITY_REVIEW). This is server-side access control, not client-side zero-knowledge encryption.',
  },
];

/**
 * Returns all discrepancy warnings that must be reviewed before policy publication.
 */
export function getPolicyDiscrepancyWarnings(): PolicyDiscrepancyWarning[] {
  return POLICY_DISCREPANCY_WARNINGS;
}
