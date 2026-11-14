import React, { useEffect, useState, useMemo } from 'react';
import { Card } from '../components/ui/Card';
import { LoadingState } from '../components/ui/LoadingState';
import { fetchPublicPolicy } from '../services/policy';
import { PolicyVersion } from '../types/policy';

export const RulesPage: React.FC = () => {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [policy, setPolicy] = useState<PolicyVersion | null>(null);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    fetchPublicPolicy()
      .then((res) => {
        if (isMounted) {
          if (res.success && res.policy) {
            setPolicy(res.policy);
          } else {
            setPolicy(null);
          }
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err.message || 'Failed to load community rules and policies.');
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleCopyLink = (sectionKey: string) => {
    const url = `${window.location.origin}/rules#${sectionKey}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedSection(sectionKey);
      setTimeout(() => setCopiedSection(null), 2500);
    });
  };

  const formattedEffectiveDate = useMemo(() => {
    if (!policy?.effectiveDate) return null;
    try {
      return new Date(policy.effectiveDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return policy.effectiveDate;
    }
  }, [policy?.effectiveDate]);

  const activeSections = useMemo(() => {
    return (policy?.sections || []).filter((s) => s.isActive);
  }, [policy]);

  if (loading) {
    return (
      <div className="container" style={{ padding: '4rem 1.5rem', maxWidth: '950px' }}>
        <LoadingState message="Loading official community rules &amp; policies..." />
      </div>
    );
  }

  if (error || (!policy && !loading)) {
    return (
      <div className="container" style={{ padding: '4rem 1.5rem', maxWidth: '950px' }}>
        <div style={{ marginBottom: '2rem' }}>
          <span className="badge badge-purple" style={{ marginBottom: '0.75rem' }}>
            Official Policy
          </span>
          <h1 style={{ fontSize: '2.4rem', fontWeight: 800, marginBottom: '0.75rem' }}>
            G4X Community Official Policy &amp; Rules
          </h1>
        </div>

        <Card style={{ padding: '2.5rem', textAlign: 'center', backgroundColor: 'var(--bg-surface)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>📜</div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
            Official Policies Currently Being Updated
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', maxWidth: '550px', margin: '0 auto 1.5rem' }}>
            The official community rules document is currently undergoing versioned administrative review. Please check back shortly or consult the official G4X Discord server for guidance.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <a href="https://discord.gg/g4x" target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">
              Visit Official Discord
            </a>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.location.reload()}>
              ↻ Refresh Page
            </button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="container print-policy" style={{ padding: '3.5rem 1.5rem', maxWidth: '950px' }}>
      {/* Header & Version Metadata */}
      <div style={{ marginBottom: '2.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '1.75rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.65rem', marginBottom: '0.75rem' }}>
          <span className="badge badge-purple" style={{ fontSize: '0.75rem' }}>
            Official Document
          </span>
          <span className="badge badge-success" style={{ fontSize: '0.75rem' }}>
            Version {policy?.versionNumber}.0
          </span>
          {formattedEffectiveDate && (
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Effective Date: <strong style={{ color: 'var(--text-primary)' }}>{formattedEffectiveDate}</strong>
            </span>
          )}
        </div>

        <h1 style={{ fontSize: '2.4rem', fontWeight: 800, margin: '0 0 0.75rem', color: 'var(--text-primary)' }}>
          {policy?.title || 'G4X Community Official Policy & Rules'}
        </h1>

        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.6, margin: 0 }}>
          This authoritative policy document governs all activities, services, orders, communications, and financial operations within the G4X Community platform and official Discord server.
        </p>

        {/* Action Bar (Print / Share) */}
        <div className="no-print" style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => window.print()}
            title="Print or save as PDF"
          >
            🖨️ Print / Save PDF
          </button>
        </div>
      </div>

      {/* Table of Contents */}
      {activeSections.length > 0 && (
        <Card className="no-print" style={{ padding: '1.5rem', marginBottom: '2.5rem', backgroundColor: 'var(--bg-surface)' }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 1rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>📑</span> Table of Contents
          </h2>
          <nav aria-label="Policy Sections Navigation">
            <ol style={{ margin: 0, paddingLeft: '1.25rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.6rem' }}>
              {activeSections.map((sec) => (
                <li key={sec.id} style={{ fontSize: '0.88rem' }}>
                  <a
                    href={`#${sec.sectionKey}`}
                    style={{ color: 'var(--accent-lime)', textDecoration: 'none', fontWeight: 600 }}
                  >
                    {sec.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </Card>
      )}

      {/* Policy Sections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        {activeSections.map((sec) => (
          <section key={sec.id} id={sec.sectionKey} style={{ scrollMarginTop: '5rem' }}>
            <Card style={{ padding: '2rem', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
              {/* Section Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.85rem', marginBottom: '1.25rem' }}>
                <h2 style={{ fontSize: '1.35rem', fontWeight: 800, margin: 0, color: 'var(--accent-lime)' }}>
                  {sec.title}
                </h2>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm no-print"
                  onClick={() => handleCopyLink(sec.sectionKey)}
                  title="Copy link to this section"
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                >
                  {copiedSection === sec.sectionKey ? '✓ Copied' : '🔗 Link'}
                </button>
              </div>

              {sec.content && (
                <p style={{ fontSize: '0.92rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '1.25rem' }}>
                  {sec.content}
                </p>
              )}

              {/* Subsections */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {sec.subsections
                  .filter((sub) => sub.isActive)
                  .map((sub) => {
                    return (
                      <div key={sub.id} style={{ paddingLeft: '0.25rem' }}>
                        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.5rem', color: 'var(--text-primary)' }}>
                          {sub.title}
                        </h3>

                        {/* Render table if contentType is TABLE or JSON data present */}
                        {sub.contentType === 'TABLE' && sub.tableDataJson ? (
                          (() => {
                            try {
                              const tbl = JSON.parse(sub.tableDataJson);
                              return (
                                <div className="table-scroll" style={{ margin: '1rem 0' }}>
                                  <table className="data-table">
                                    <thead>
                                      <tr>
                                        {tbl.headers.map((h: string, idx: number) => (
                                          <th key={idx}>
                                            {h}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {tbl.rows.map((row: string[], rIdx: number) => (
                                        <tr key={rIdx}>
                                          {row.map((cell: string, cIdx: number) => (
                                            <td key={cIdx} style={{ fontWeight: cIdx === 0 ? 600 : 400, color: cIdx === 1 ? 'var(--accent-yellow)' : 'inherit' }}>
                                              {cell}
                                            </td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              );
                            } catch {
                              return (
                                <div style={{ fontSize: '0.92rem', color: 'var(--text-muted)', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
                                  {sub.content}
                                </div>
                              );
                            }
                          })()
                        ) : (
                          <div
                            style={{
                              fontSize: '0.92rem',
                              color: 'var(--text-muted)',
                              lineHeight: 1.7,
                              whiteSpace: 'pre-line',
                            }}
                          >
                            {sub.content}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </Card>
          </section>
        ))}
      </div>

      {/* Footer Acknowledgement Notice */}
      <div className="no-print" style={{ marginTop: '3.5rem', textAlign: 'center', padding: '1.5rem', borderTop: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        <p style={{ margin: 0 }}>
          G4X Community · Version {policy?.versionNumber}.0 · Questions or disputes? Open a ticket via the official G4X Discord server.
        </p>
      </div>
    </div>
  );
};
