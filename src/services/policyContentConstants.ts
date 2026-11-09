/**
 * policyContentConstants.ts — Authoritative Initial Policy Text & Structured Content
 *
 * G4X Community Official Policy & Rules
 *
 * In accordance with Mission Specification:
 * - The original English wording, headings, subheadings, lists, amounts, percentages,
 *   and commission table are preserved VERBATIM without summarization, omission, or alteration.
 */

export const INITIAL_POLICY_RAW_TEXT = `G4X Community Official Policy & Rules

1. General Rules & Communication
By accepting an order or operating within the G4X platform, every member (Booster, Advertiser, and Exchanger) agrees to follow these rules:
Issue Resolution: Any issue, dispute, or problem must be reported and resolved exclusively by opening a Ticket with the G4X Support Team.
No Direct Messages (DMs): Sending private/direct messages (DMs) to any person present in the order channel (customers, boosters, or advertisers) is strictly prohibited. Everything must take place inside the designated G4X Discord channel.
No Advertising: Inviting users to other Discord servers or advertising external platforms/services is strictly forbidden.
No Off-Platform Deals: Arranging private payments or off-platform deals with customers is strictly prohibited and leads to a permanent ban.

2. Booster Rules
A) Order Start Times & Availability
Boosters must only accept orders they can complete and start according to priority:
Super Express: Start immediately once assigned.
Express: Start within 10–20 minutes.
Regular: Start within 30 minutes.
Do not go AFK or offline with active responsibilities without informing an Admin. Never accept an order and disappear.

B) Customer Communication & In-Game Chat
In party chat or any chat visible to the customer, Boosters must use English ONLY.
Always use formal, polite, and simple words. Avoid writing long paragraphs—always assume the customer has a basic/low level of English proficiency.
Never insult, argue with, blame, or pressure the customer for tips.

C) Proof of Completion & Streaming Rules
All screenshots must be unedited, taken directly from the game showing character identifiers, and uploaded only inside the order channel:
Mythic+ Orders: The Booster must take a complete screenshot of ALL runs and upload them to the channel. Strictly refrain from sending unrelated images in the order channel.
Pilot & Non-Pilot (Selfplay) Orders: The Booster must upload a screenshot at the start of the project, at the end of the project, and whenever requested by the customer or Admin.
Streaming Policy: If a customer requests a live stream, the Booster is obligated to create a Google Meet, post the link inside the order channel, and grant access to both the customer and the Admin. The stream must continue uninterrupted until the customer requests it to end.

D) Account Security & Pilot Orders
VPN Requirement: Boosters must use a reliable, verified VPN and ensure connection stability. Using public/free VPNs with flagged or invalid IPs is strictly prohibited; any resulting consequences (such as account bans) are entirely the Booster's responsibility.
Customer Assets: During Pilot boosts, no harm or loss must come to the customer’s assets (gold, items, currencies, materials). Do not spend or alter anything without explicit permission.
Never change the customer's password or email, and log out immediately after completion. For Selfplay orders, remove the customer from your in-game friend list once finished.

E) Replacements & Penalties
Replacements: Replacing a booster during an active order is strictly prohibited unless approved by the G4X Team. (If using an approved helper, the primary assigned Booster remains 100% responsible for the order).
Failure / Wrong Order Penalty: Failing to complete a boost, abandoning an order, or claiming an order by mistake will result in a penalty ranging from $1 to $1,000, determined at the discretion of the G4X Team.
Severe Violations & Sabotage: Any malicious behavior—including changing passwords, unauthorized account alterations, getting the user's account banned, stealing assets, or using unauthorized third-party software (cheats, hacks, bots, exploits)—will result in a financial penalty of $1 to $10,000, permanent account termination, and the immediate cancellation/forfeiture of any pending withdrawal requests.

3. Advertiser Rules
Wallet Balance: Advertisers must top up and fund their wallet before posting any boost order.
Order Cancellation: Posted boosts can only be canceled at the discretion and approval of the G4X Team.
Game Currency Top-Ups: When funding via in-game currency, the Advertiser must follow the Exchanger’s exact instructions. If video recording is requested as proof of delivery, it must be recorded completely and clearly.
Respectful Conduct: Advertisers must treat Boosters with respect and politeness. Insulting or harassing a Booster is strictly prohibited and carries penalties.
No Unauthorized Replacements: Replacing a Booster during a boost is forbidden. Advertisers must contact the G4X Team to request a replacement.
Order Completion & 12-Hour Auto-Completion: Advertisers are obligated to mark the boost as "Completed" once the Booster announces its completion. Orders that are not reviewed or confirmed by the Advertiser within 12 hours of the Booster's completion notice will be reviewed by the G4X Team and marked as Completed if verified.

4. Exchanger Rules
Professionalism & Clarity: Exchangers must treat all users politely. The currency transfer method and any required proof must be explained clearly and transparently (and taught to the seller if necessary).
1-Hour Settlement Limit: After receiving the currency, the Exchanger must settle the payment within 1 hour. Failure to settle within 1 hour will result in order cancellation and escalation to the G4X Team, which may lead to fines or account suspension. (This timeframe can only be extended by the G4X Team).
4-Hour Order Expiration: Currency orders not completed within 4 hours are automatically sent to the G4X Team for review.
Approved Settlement Methods: Settlements must only be processed via official G4X methods:
Toman Card-to-Card transfer to G4X
Cryptocurrency via the NOWPayments gateway
Direct deduction from the Exchanger's G4X Wallet balance.

5. Financials, Commissions & Fees
A) Booster Payout Schedule
G4X Official Orders: Funds undergo a 3-day customer confirmation hold, then move to "Pending Payout," and become available for withdrawal once approved by the G4X Team.
Advertiser Orders: Only require the Advertiser's confirmation (or G4X verification after the 12-hour timeout) to become immediately available for withdrawal.
Minimum Withdrawal: Users must have a minimum balance of $6 to request a withdrawal.

B) Advertiser Order Commissions (By Rank)
Advertiser Rank Commission Rate
Bronze 14.99%
Silver 12.99%
Gold 10.99%
Diamond 8.99%
Founding Partner 8.99%
Official Partner 6.99%

C) Deposit & Withdrawal Fees and Timelines
Deposit Fees:
Toman (IRR): $0.5 flat fee.
Crypto: Network Gas Fees and NOWPayments processing fees are covered by the user.
Withdrawal Fees & Processing Times:
Toman (IRR): 3% + $0.5 fee | Processing time: Up to 5 business days.
USDT (BNB Chain / BEP20): 3% fee | Processing time: 1 to 48 hours.
Exchange Rates: All Toman, Gold, and USDT conversions are calculated using G4X's internal platform rates to protect the community against market volatility and banking/network costs.

6. KYC (Know Your Customer) & Data Privacy
Mandatory KYC: Completing KYC verification is mandatory for all Pilot Boosters, Advertisers, and Exchangers.
KYC Requirements:
Clear front and back photos of a valid Government ID, Passport, or Driver's License.
A clear selfie holding the ID document in your hand, with the G4X website homepage clearly visible in the background (e.g., on a monitor screen).
Data Security: All KYC documents are stored securely and encrypted by G4X and are strictly confidential.`;

export interface PolicySubsectionSeed {
  subsectionKey?: string;
  title: string;
  sortOrder: number;
  content: string;
  contentType: 'MARKDOWN' | 'TABLE' | 'LIST';
  tableDataJson?: string;
}

export interface PolicySectionSeed {
  sectionNumber: number;
  sectionKey: string;
  title: string;
  sortOrder: number;
  content?: string;
  subsections: PolicySubsectionSeed[];
}

export const INITIAL_SECTIONS_SEED: PolicySectionSeed[] = [
  {
    sectionNumber: 1,
    sectionKey: 'general',
    title: '1. General Rules & Communication',
    sortOrder: 1,
    content:
      'By accepting an order or operating within the G4X platform, every member (Booster, Advertiser, and Exchanger) agrees to follow these rules:',
    subsections: [
      {
        subsectionKey: 'issue_resolution',
        title: 'Issue Resolution',
        sortOrder: 1,
        contentType: 'MARKDOWN',
        content:
          'Any issue, dispute, or problem must be reported and resolved exclusively by opening a Ticket with the G4X Support Team.',
      },
      {
        subsectionKey: 'no_dms',
        title: 'No Direct Messages (DMs)',
        sortOrder: 2,
        contentType: 'MARKDOWN',
        content:
          'Sending private/direct messages (DMs) to any person present in the order channel (customers, boosters, or advertisers) is strictly prohibited. Everything must take place inside the designated G4X Discord channel.',
      },
      {
        subsectionKey: 'no_advertising',
        title: 'No Advertising',
        sortOrder: 3,
        contentType: 'MARKDOWN',
        content:
          'Inviting users to other Discord servers or advertising external platforms/services is strictly forbidden.',
      },
      {
        subsectionKey: 'no_off_platform_deals',
        title: 'No Off-Platform Deals',
        sortOrder: 4,
        contentType: 'MARKDOWN',
        content:
          'Arranging private payments or off-platform deals with customers is strictly prohibited and leads to a permanent ban.',
      },
    ],
  },
  {
    sectionNumber: 2,
    sectionKey: 'boosters',
    title: '2. Booster Rules',
    sortOrder: 2,
    subsections: [
      {
        subsectionKey: 'order_start_times',
        title: 'A) Order Start Times & Availability',
        sortOrder: 1,
        contentType: 'MARKDOWN',
        content: `Boosters must only accept orders they can complete and start according to priority:
- **Super Express:** Start immediately once assigned.
- **Express:** Start within 10–20 minutes.
- **Regular:** Start within 30 minutes.

Do not go AFK or offline with active responsibilities without informing an Admin. Never accept an order and disappear.`,
      },
      {
        subsectionKey: 'customer_communication',
        title: 'B) Customer Communication & In-Game Chat',
        sortOrder: 2,
        contentType: 'MARKDOWN',
        content: `In party chat or any chat visible to the customer, Boosters must use English ONLY.
Always use formal, polite, and simple words. Avoid writing long paragraphs—always assume the customer has a basic/low level of English proficiency.
Never insult, argue with, blame, or pressure the customer for tips.`,
      },
      {
        subsectionKey: 'proof_and_streaming',
        title: 'C) Proof of Completion & Streaming Rules',
        sortOrder: 3,
        contentType: 'MARKDOWN',
        content: `All screenshots must be unedited, taken directly from the game showing character identifiers, and uploaded only inside the order channel:
- **Mythic+ Orders:** The Booster must take a complete screenshot of ALL runs and upload them to the channel. Strictly refrain from sending unrelated images in the order channel.
- **Pilot & Non-Pilot (Selfplay) Orders:** The Booster must upload a screenshot at the start of the project, at the end of the project, and whenever requested by the customer or Admin.
- **Streaming Policy:** If a customer requests a live stream, the Booster is obligated to create a Google Meet, post the link inside the order channel, and grant access to both the customer and the Admin. The stream must continue uninterrupted until the customer requests it to end.`,
      },
      {
        subsectionKey: 'account_security',
        title: 'D) Account Security & Pilot Orders',
        sortOrder: 4,
        contentType: 'MARKDOWN',
        content: `- **VPN Requirement:** Boosters must use a reliable, verified VPN and ensure connection stability. Using public/free VPNs with flagged or invalid IPs is strictly prohibited; any resulting consequences (such as account bans) are entirely the Booster's responsibility.
- **Customer Assets:** During Pilot boosts, no harm or loss must come to the customer’s assets (gold, items, currencies, materials). Do not spend or alter anything without explicit permission.
- Never change the customer's password or email, and log out immediately after completion. For Selfplay orders, remove the customer from your in-game friend list once finished.`,
      },
      {
        subsectionKey: 'replacements_and_penalties',
        title: 'E) Replacements & Penalties',
        sortOrder: 5,
        contentType: 'MARKDOWN',
        content: `- **Replacements:** Replacing a booster during an active order is strictly prohibited unless approved by the G4X Team. (If using an approved helper, the primary assigned Booster remains 100% responsible for the order).
- **Failure / Wrong Order Penalty:** Failing to complete a boost, abandoning an order, or claiming an order by mistake will result in a penalty ranging from $1 to $1,000, determined at the discretion of the G4X Team.
- **Severe Violations & Sabotage:** Any malicious behavior—including changing passwords, unauthorized account alterations, getting the user's account banned, stealing assets, or using unauthorized third-party software (cheats, hacks, bots, exploits)—will result in a financial penalty of $1 to $10,000, permanent account termination, and the immediate cancellation/forfeiture of any pending withdrawal requests.`,
      },
    ],
  },
  {
    sectionNumber: 3,
    sectionKey: 'advertisers',
    title: '3. Advertiser Rules',
    sortOrder: 3,
    subsections: [
      {
        subsectionKey: 'adv_wallet_balance',
        title: 'Wallet Balance',
        sortOrder: 1,
        contentType: 'MARKDOWN',
        content: 'Advertisers must top up and fund their wallet before posting any boost order.',
      },
      {
        subsectionKey: 'adv_order_cancellation',
        title: 'Order Cancellation',
        sortOrder: 2,
        contentType: 'MARKDOWN',
        content: 'Posted boosts can only be canceled at the discretion and approval of the G4X Team.',
      },
      {
        subsectionKey: 'adv_currency_topups',
        title: 'Game Currency Top-Ups',
        sortOrder: 3,
        contentType: 'MARKDOWN',
        content:
          'When funding via in-game currency, the Advertiser must follow the Exchanger’s exact instructions. If video recording is requested as proof of delivery, it must be recorded completely and clearly.',
      },
      {
        subsectionKey: 'adv_respectful_conduct',
        title: 'Respectful Conduct',
        sortOrder: 4,
        contentType: 'MARKDOWN',
        content:
          'Advertisers must treat Boosters with respect and politeness. Insulting or harassing a Booster is strictly prohibited and carries penalties.',
      },
      {
        subsectionKey: 'adv_no_unauthorized_replacements',
        title: 'No Unauthorized Replacements',
        sortOrder: 5,
        contentType: 'MARKDOWN',
        content:
          'Replacing a Booster during a boost is forbidden. Advertisers must contact the G4X Team to request a replacement.',
      },
      {
        subsectionKey: 'adv_completion_12h',
        title: 'Order Completion & 12-Hour Auto-Completion',
        sortOrder: 6,
        contentType: 'MARKDOWN',
        content:
          'Advertisers are obligated to mark the boost as "Completed" once the Booster announces its completion. Orders that are not reviewed or confirmed by the Advertiser within 12 hours of the Booster\'s completion notice will be reviewed by the G4X Team and marked as Completed if verified.',
      },
    ],
  },
  {
    sectionNumber: 4,
    sectionKey: 'exchangers',
    title: '4. Exchanger Rules',
    sortOrder: 4,
    subsections: [
      {
        subsectionKey: 'exc_professionalism',
        title: 'Professionalism & Clarity',
        sortOrder: 1,
        contentType: 'MARKDOWN',
        content:
          'Exchangers must treat all users politely. The currency transfer method and any required proof must be explained clearly and transparently (and taught to the seller if necessary).',
      },
      {
        subsectionKey: 'exc_1h_settlement',
        title: '1-Hour Settlement Limit',
        sortOrder: 2,
        contentType: 'MARKDOWN',
        content:
          'After receiving the currency, the Exchanger must settle the payment within 1 hour. Failure to settle within 1 hour will result in order cancellation and escalation to the G4X Team, which may lead to fines or account suspension. (This timeframe can only be extended by the G4X Team).',
      },
      {
        subsectionKey: 'exc_4h_expiration',
        title: '4-Hour Order Expiration',
        sortOrder: 3,
        contentType: 'MARKDOWN',
        content:
          'Currency orders not completed within 4 hours are automatically sent to the G4X Team for review.',
      },
      {
        subsectionKey: 'exc_approved_methods',
        title: 'Approved Settlement Methods',
        sortOrder: 4,
        contentType: 'MARKDOWN',
        content: `Settlements must only be processed via official G4X methods:
- Toman Card-to-Card transfer to G4X
- Cryptocurrency via the NOWPayments gateway
- Direct deduction from the Exchanger's G4X Wallet balance.`,
      },
    ],
  },
  {
    sectionNumber: 5,
    sectionKey: 'financials',
    title: '5. Financials, Commissions & Fees',
    sortOrder: 5,
    subsections: [
      {
        subsectionKey: 'booster_payout_schedule',
        title: 'A) Booster Payout Schedule',
        sortOrder: 1,
        contentType: 'MARKDOWN',
        content: `- **G4X Official Orders:** Funds undergo a 3-day customer confirmation hold, then move to "Pending Payout," and become available for withdrawal once approved by the G4X Team.
- **Advertiser Orders:** Only require the Advertiser's confirmation (or G4X verification after the 12-hour timeout) to become immediately available for withdrawal.
- **Minimum Withdrawal:** Users must have a minimum balance of $6 to request a withdrawal.`,
      },
      {
        subsectionKey: 'advertiser_commissions_table',
        title: 'B) Advertiser Order Commissions (By Rank)',
        sortOrder: 2,
        contentType: 'TABLE',
        tableDataJson: JSON.stringify({
          headers: ['Advertiser Rank', 'Commission Rate'],
          rows: [
            ['Bronze', '14.99%'],
            ['Silver', '12.99%'],
            ['Gold', '10.99%'],
            ['Diamond', '8.99%'],
            ['Founding Partner', '8.99%'],
            ['Official Partner', '6.99%'],
          ],
        }),
        content: `| Advertiser Rank | Commission Rate |
|---|---|
| Bronze | 14.99% |
| Silver | 12.99% |
| Gold | 10.99% |
| Diamond | 8.99% |
| Founding Partner | 8.99% |
| Official Partner | 6.99% |`,
      },
      {
        subsectionKey: 'deposit_withdrawal_fees',
        title: 'C) Deposit & Withdrawal Fees and Timelines',
        sortOrder: 3,
        contentType: 'MARKDOWN',
        content: `**Deposit Fees:**
- **Toman (IRR):** $0.5 flat fee.
- **Crypto:** Network Gas Fees and NOWPayments processing fees are covered by the user.

**Withdrawal Fees & Processing Times:**
- **Toman (IRR):** 3% + $0.5 fee | Processing time: Up to 5 business days.
- **USDT (BNB Chain / BEP20):** 3% fee | Processing time: 1 to 48 hours.

**Exchange Rates:**
All Toman, Gold, and USDT conversions are calculated using G4X's internal platform rates to protect the community against market volatility and banking/network costs.`,
      },
    ],
  },
  {
    sectionNumber: 6,
    sectionKey: 'kyc',
    title: '6. KYC (Know Your Customer) & Data Privacy',
    sortOrder: 6,
    subsections: [
      {
        subsectionKey: 'mandatory_kyc',
        title: 'Mandatory KYC',
        sortOrder: 1,
        contentType: 'MARKDOWN',
        content:
          'Completing KYC verification is mandatory for all Pilot Boosters, Advertisers, and Exchangers.',
      },
      {
        subsectionKey: 'kyc_requirements',
        title: 'KYC Requirements',
        sortOrder: 2,
        contentType: 'MARKDOWN',
        content: `- Clear front and back photos of a valid Government ID, Passport, or Driver's License.
- A clear selfie holding the ID document in your hand, with the G4X website homepage clearly visible in the background (e.g., on a monitor screen).`,
      },
      {
        subsectionKey: 'data_security',
        title: 'Data Security',
        sortOrder: 3,
        contentType: 'MARKDOWN',
        content:
          'All KYC documents are stored securely and encrypted by G4X and are strictly confidential.',
      },
    ],
  },
];

/**
 * Builds the canonical unified markdown text from sections seed.
 */
export function buildMarkdownFromSections(
  title: string,
  sections: PolicySectionSeed[]
): string {
  const parts: string[] = [`# ${title}\n`];

  for (const s of sections) {
    parts.push(`## ${s.title}\n`);
    if (s.content) {
      parts.push(`${s.content}\n`);
    }
    for (const sub of s.subsections) {
      parts.push(`### ${sub.title}\n`);
      parts.push(`${sub.content}\n`);
    }
  }

  return parts.join('\n').trim();
}
