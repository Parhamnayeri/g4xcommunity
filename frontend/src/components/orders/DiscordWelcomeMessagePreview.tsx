import React, { useState, useMemo } from 'react';

interface DiscordWelcomeMessagePreviewProps {
  orderTitle: string;
  orderIdPlaceholder?: string | number;
  boostModel: string;
  vpnRequirement: string;
  specs: Record<string, any>;
  notes: string;
  grossAmount?: string | number;
  boosterPool?: string | number;
  serviceTemplate?: string | null;
  globalRules?: string | null;
}

export const DiscordWelcomeMessagePreview: React.FC<DiscordWelcomeMessagePreviewProps> = ({
  orderTitle,
  orderIdPlaceholder = 'PREVIEW',
  boostModel,
  vpnRequirement,
  specs,
  notes,
  grossAmount = '0.00',
  boosterPool = '0.00',
  serviceTemplate,
  globalRules,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const defaultGlobalRules = `🛡️ **G4X Operational Guidelines & Safety Rules**
1. **Communication:** Keep all order discussion strictly inside this temporary Discord channel.
2. **Account Security:** Never ask for or share credentials outside verified automated forms.
3. **Completion Proof:** Booster must upload victory scorecards or boss kill screenshots before payout.
4. **Disputes:** Tag @Admin or @Manager immediately if any issues arise.`;

  const effectiveGlobalRules = globalRules?.trim() || defaultGlobalRules;

  // Format specifications into a readable string
  const formattedSpecs = useMemo(() => {
    const entries = Object.entries(specs).filter(([_, val]) => val !== undefined && val !== '' && val !== false);
    if (entries.length === 0) return 'Standard Run Specifications';
    return entries
      .map(([k, v]) => {
        const formattedKey = k
          .replace(/([A-Z])/g, ' $1')
          .replace(/^./, (str) => str.toUpperCase())
          .trim();
        const formattedVal = typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
        return `${formattedKey}: ${formattedVal}`;
      })
      .join(' | ');
  }, [specs]);

  // Replace placeholders in real time
  const renderedMessage = useMemo(() => {
    const rawTemplate =
      serviceTemplate?.trim() ||
      `Hello {booster_mention}! You are assigned to **{order_title}** (Order #{order_id}).
**Boost Model:** {boost_type}
**Security:** {vpn_requirement}
**Specifications:** {specs}
**Payout Pool:** ${boosterPool} USD
**Notes:** {notes}

Please coordinate with the customer, confirm party readiness, and complete the service cleanly.`;

    let msg = rawTemplate
      .replace(/{order_id}/gi, String(orderIdPlaceholder))
      .replace(/{order_title}/gi, orderTitle || 'New Order')
      .replace(/{title}/gi, orderTitle || 'New Order')
      .replace(/{boost_type}/gi, boostModel || 'Standard')
      .replace(/{vpn_requirement}/gi, vpnRequirement || 'No VPN Required')
      .replace(/{specs}/gi, formattedSpecs)
      .replace(/{notes}/gi, notes?.trim() || 'No special instructions')
      .replace(/{booster_mention}/gi, '@AssignedBooster')
      .replace(/{gross_amount}/gi, `$${grossAmount}`)
      .replace(/{booster_pool}/gi, `$${boosterPool}`);

    return msg;
  }, [serviceTemplate, orderIdPlaceholder, orderTitle, boostModel, vpnRequirement, formattedSpecs, notes, grossAmount, boosterPool]);

  return (
    <div
      style={{
        borderRadius: '10px',
        border: '1px solid rgba(88, 101, 242, 0.35)',
        backgroundColor: '#1e1f22',
        overflow: 'hidden',
        boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
      }}
    >
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0.65rem 0.9rem',
          backgroundColor: '#2b2d31',
          cursor: 'pointer',
          borderBottom: isExpanded ? '1px solid rgba(255,255,255,0.06)' : 'none',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.1rem' }}>💬</span>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f2f3f5' }}>
            Discord Temporary Channel Live Preview
          </span>
          <span
            style={{
              fontSize: '0.68rem',
              backgroundColor: '#5865f2',
              color: '#fff',
              padding: '1px 6px',
              borderRadius: '4px',
              fontWeight: 700,
            }}
          >
            DISCORD SYNC
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#949ba4', fontSize: '0.75rem' }}>
          <span>{isExpanded ? 'Collapse' : 'Expand Preview'}</span>
          <span>{isExpanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {isExpanded && (
        <div style={{ padding: '0.9rem 1rem' }}>
          {/* Discord Message Style UI */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '50%',
                backgroundColor: '#5865f2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1rem',
                color: '#fff',
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              G4X
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.25rem' }}>
                <span style={{ fontSize: '0.86rem', fontWeight: 700, color: '#f2f3f5' }}>G4X Dispatch Bot</span>
                <span
                  style={{
                    fontSize: '0.62rem',
                    backgroundColor: '#5865f2',
                    color: '#fff',
                    padding: '1px 4px',
                    borderRadius: '3px',
                    fontWeight: 700,
                  }}
                >
                  APP
                </span>
                <span style={{ fontSize: '0.7rem', color: '#949ba4' }}>Today at {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>

              {/* Discord Embed Container */}
              <div
                style={{
                  backgroundColor: '#2b2d31',
                  borderLeft: '4px solid #5865f2',
                  borderRadius: '4px',
                  padding: '0.75rem 0.85rem',
                  marginTop: '0.35rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.65rem',
                }}
              >
                {/* Global Rules Section */}
                <div
                  style={{
                    fontSize: '0.78rem',
                    color: '#dbdee1',
                    lineHeight: '1.45',
                    whiteSpace: 'pre-line',
                    borderBottom: '1px solid rgba(255,255,255,0.08)',
                    paddingBottom: '0.55rem',
                  }}
                >
                  {effectiveGlobalRules}
                </div>

                {/* Service Specific Message Section */}
                <div
                  style={{
                    fontSize: '0.8rem',
                    color: '#f2f3f5',
                    lineHeight: '1.5',
                    whiteSpace: 'pre-line',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                  }}
                >
                  {renderedMessage}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
