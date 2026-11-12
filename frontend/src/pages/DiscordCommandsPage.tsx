/**
 * frontend/src/pages/DiscordCommandsPage.tsx — Private Role-Based Discord Commands Guide
 *
 * G4X Community — Task 7: Private Role-Based Discord Commands Guide
 *
 * Security:
 *  - Only accessible to authenticated users with approved operational/admin roles.
 *  - Server-authoritative: only displays commands returned by the server for this user's roles.
 *  - Booster-only accounts receive a clean 403 Forbidden notice.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { fetchDiscordCommands } from '../services/discordCommands';
import {
  DiscordCommandsResponse,
  CommandType,
  CommandParameter,
} from '../types/discordCommands';
import { LoadingState } from '../components/ui/LoadingState';
import { DataTable, Column, EmptyState } from '../components/ui';

export const DiscordCommandsPage: React.FC = () => {
  const { status } = useAuth();
  const [data, setData] = useState<DiscordCommandsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  // Filters
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedErrors, setExpandedErrors] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let isMounted = true;

    async function loadCommands() {
      setLoading(true);
      setError(null);
      setForbidden(false);

      try {
        const response = await fetchDiscordCommands();
        if (isMounted) {
          setData(response);
          setLoading(false);
        }
      } catch (err: any) {
        if (!isMounted) return;
        setLoading(false);
        const errMsg = err?.message || String(err);
        if (errMsg.includes('403') || errMsg.includes('BOOSTER_RESTRICTED') || errMsg.includes('restricted')) {
          setForbidden(true);
        } else if (errMsg.includes('401') || errMsg.includes('UNAUTHORIZED')) {
          setError('Authentication required. Please sign in with Discord.');
        } else {
          setError(errMsg || 'Failed to load Discord bot commands catalog.');
        }
      }
    }

    if (status !== 'loading') {
      loadCommands();
    }

    return () => {
      isMounted = false;
    };
  }, [status]);

  const copyToClipboard = (text: string, id: string) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const toggleErrors = (cmdId: string) => {
    setExpandedErrors((prev) => ({ ...prev, [cmdId]: !prev[cmdId] }));
  };

  // Client-side quick filter within the server-permitted baseline
  const filteredCommands = useMemo(() => {
    if (!data?.commands) return [];

    return data.commands.filter((cmd) => {
      // Category filter
      if (selectedCategory !== 'all' && cmd.category !== selectedCategory) {
        return false;
      }
      // Type filter
      if (selectedType !== 'all' && cmd.type !== selectedType) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = cmd.name.toLowerCase().includes(q);
        const matchSyntax = cmd.syntax.toLowerCase().includes(q);
        const matchSummary = cmd.summary.toLowerCase().includes(q);
        const matchDesc = cmd.description.toLowerCase().includes(q);
        const matchParam = cmd.parameters.some(
          (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
        );
        const matchEx = cmd.examples.some(
          (ex) => ex.command.toLowerCase().includes(q) || ex.description.toLowerCase().includes(q)
        );
        return matchName || matchSyntax || matchSummary || matchDesc || matchParam || matchEx;
      }
      return true;
    });
  }, [data, selectedCategory, selectedType, searchQuery]);

  const paramColumns: Column<CommandParameter>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Parameter',
        render: (p) => (
          <span style={{ fontFamily: 'monospace', color: 'var(--accent-lime)', fontWeight: 600 }}>
            {p.name}
          </span>
        ),
      },
      {
        key: 'type',
        header: 'Type',
        render: (p) => <span style={{ color: 'var(--text-secondary)' }}>{p.type}</span>,
      },
      {
        key: 'required',
        header: 'Requirement',
        render: (p) =>
          p.required ? (
            <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase' }}>
              Required
            </span>
          ) : (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase' }}>
              Optional
            </span>
          ),
      },
      {
        key: 'allowedValues',
        header: 'Allowed Values / Default',
        render: (p) => (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
            {p.allowedValues ? p.allowedValues.map((v) => `\`${v}\``).join(', ') : p.defaultValue ? `default: \`${p.defaultValue}\`` : '—'}
          </span>
        ),
      },
      {
        key: 'description',
        header: 'Description',
        render: (p) => <span style={{ color: 'var(--text-secondary)' }}>{p.description}</span>,
      },
    ],
    []
  );

  if (loading) {
    return (
      <div style={{ padding: '3rem 0', textAlign: 'center' }}>
        <LoadingState message="Loading authorized Discord bot commands catalog..." />
      </div>
    );
  }

  // 403 Forbidden for Booster-only accounts
  if (forbidden) {
    return (
      <div style={{ maxWidth: '700px', margin: '2rem auto', padding: '0 1rem' }}>
        <div
          className="card-surface"
          style={{
            padding: '2.5rem',
            textAlign: 'center',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            background: 'linear-gradient(180deg, rgba(239, 68, 68, 0.05) 0%, rgba(17, 23, 34, 0.95) 100%)',
          }}
        >
          <div
            style={{
              width: '60px',
              height: '60px',
              borderRadius: '50%',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              color: '#ef4444',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1.5rem',
              fontSize: '1.8rem',
            }}
          >
            🛡️
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff', marginBottom: '0.75rem' }}>
            Operational Role Required
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.6, marginBottom: '1.5rem' }}>
            The <strong>Discord Bot Commands Guide</strong> is a private manual reserved exclusively for operational,
            commercial, and administrative roles (<strong>Advertiser, Exchanger, Staff, Management, Admin, and Owner</strong>).
          </p>
          <div
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              borderRadius: '8px',
              padding: '1rem 1.25rem',
              textAlign: 'left',
              fontSize: '0.85rem',
              color: 'var(--text-secondary)',
              marginBottom: '2rem',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ color: 'var(--accent-lime)', fontWeight: 700, marginBottom: '0.4rem' }}>
              ℹ️ Booster Guidelines:
            </div>
            • Booster pre-signing, squad claims, and character operations are performed directly inside authorized Discord channels.
            <br />
            • Boosters submit completion proofs inside their assigned private execution channels using <code>G4!proof</code> or the <strong>Submit Proof</strong> button.
            <br />
            • If you need an operational role or advertiser account, apply in the registration channels.
          </div>
          <a href="/dashboard" className="btn btn-secondary">
            &larr; Return to Dashboard
          </a>
        </div>
      </div>
    );
  }

  // 401 or Other Error
  if (error || !data) {
    return (
      <div style={{ maxWidth: '600px', margin: '3rem auto', textAlign: 'center' }}>
        <div className="card-surface" style={{ padding: '2rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⚠️</div>
          <h2 style={{ fontSize: '1.3rem', marginBottom: '0.5rem' }}>Unable to Access Commands Guide</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>{error || 'An unexpected error occurred.'}</p>
          <a href="/auth/discord" className="btn btn-cta">
            Sign In with Discord
          </a>
        </div>
      </div>
    );
  }

  const getTypeBadge = (type: CommandType) => {
    switch (type) {
      case 'text_command':
        return <span className="badge badge-purple" style={{ fontSize: '0.75rem', fontWeight: 700 }}>Prefix Command (G4!)</span>;
      case 'button_interaction':
        return <span className="badge badge-cyan" style={{ fontSize: '0.75rem', fontWeight: 700 }}>Interactive Button</span>;
      case 'modal_form':
        return <span className="badge badge-yellow" style={{ fontSize: '0.75rem', fontWeight: 700 }}>Modal Form</span>;
      case 'select_menu_wizard':
        return <span className="badge badge-green" style={{ fontSize: '0.75rem', fontWeight: 700 }}>Select Menu Wizard</span>;
      default:
        return null;
    }
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', paddingBottom: '3rem' }}>
      {/* Page Header */}
      <div
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: '1.75rem',
          marginBottom: '2rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '1.5rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '1.8rem' }}>🤖</span>
            <h1 style={{ fontSize: '1.8rem', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
              Discord Bot Commands Guide
            </h1>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem', maxWidth: '680px', margin: 0, lineHeight: 1.5 }}>
            Private reference manual for G4X Discord bot commands, subcommands, interactive wizards, and execution channel workflows.
            Showing <strong>{filteredCommands.length}</strong> permitted interactions based on your current active permissions.
          </p>
        </div>

        {/* User Role Indicator */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '0.75rem 1.25rem',
            textAlign: 'right',
          }}
        >
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
            Your Active Role Permissions:
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {data.userRoles.map((r) => (
              <span
                key={r}
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '0.2rem 0.55rem',
                  borderRadius: '4px',
                  backgroundColor: r === 'owner' ? '#ef4444' : r === 'admin' ? '#f59e0b' : r === 'manager' ? '#3b82f6' : 'var(--accent-lime)',
                  color: '#000',
                }}
              >
                {r}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Search & Category Filter Bar */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          marginBottom: '2rem',
        }}
      >
        {/* Search input */}
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search commands by name, syntax, parameters, or examples (e.g. create, verify-payment, M+)..."
            style={{
              width: '100%',
              padding: '0.85rem 1rem 0.85rem 2.85rem',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-primary)',
              fontSize: '0.95rem',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <span
            style={{
              position: 'absolute',
              left: '1rem',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
              fontSize: '1.1rem',
              pointerEvents: 'none',
            }}
          >
            🔍
          </span>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute',
                right: '1rem',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '0.9rem',
              }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
          }}
        >
          {/* Categories */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {data.categories.map((cat) => {
              const active = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  style={{
                    padding: '0.45rem 0.9rem',
                    fontSize: '0.82rem',
                    fontWeight: active ? 700 : 500,
                    borderRadius: '20px',
                    border: active ? '1px solid var(--accent-lime)' : '1px solid var(--border-subtle)',
                    backgroundColor: active ? 'rgba(0, 255, 136, 0.12)' : 'var(--bg-surface)',
                    color: active ? 'var(--accent-lime)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <span>{cat.label}</span>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      padding: '0.1rem 0.4rem',
                      borderRadius: '10px',
                      backgroundColor: active ? 'var(--accent-lime)' : 'rgba(255, 255, 255, 0.08)',
                      color: active ? '#000' : 'var(--text-muted)',
                      fontWeight: 700,
                    }}
                  >
                    {cat.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Type dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Type:</label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                fontSize: '0.82rem',
                borderRadius: '6px',
                padding: '0.35rem 0.75rem',
                outline: 'none',
              }}
            >
              <option value="all">All Types</option>
              <option value="text_command">Prefix Commands (G4!)</option>
              <option value="button_interaction">Buttons</option>
              <option value="modal_form">Modals / Forms</option>
              <option value="select_menu_wizard">Wizards</option>
            </select>
          </div>
        </div>
      </div>

      {/* Command Cards List */}
      {filteredCommands.length === 0 ? (
        <EmptyState
          icon="🔎"
          title="No commands found"
          message="No Discord bot commands matched your search or category filter."
          actionLabel="Reset Filters"
          onAction={() => {
            setSearchQuery('');
            setSelectedCategory('all');
            setSelectedType('all');
          }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {filteredCommands.map((cmd) => {
            const isCopied = copiedId === cmd.id;
            const hasErrors = cmd.commonErrors && cmd.commonErrors.length > 0;
            const isErrorExpanded = expandedErrors[cmd.id] ?? false;

            return (
              <div
                key={cmd.id}
                className="card-surface"
                style={{
                  padding: '1.5rem',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  transition: 'border-color 0.2s ease',
                }}
              >
                {/* Header row */}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    marginBottom: '1rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: '#fff' }}>
                      {cmd.name}
                    </h3>
                    {getTypeBadge(cmd.type)}
                    <span
                      style={{
                        fontSize: '0.72rem',
                        padding: '0.2rem 0.5rem',
                        borderRadius: '4px',
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        color: 'var(--text-muted)',
                        border: '1px solid var(--border-subtle)',
                        textTransform: 'uppercase',
                        fontWeight: 600,
                      }}
                    >
                      {cmd.category}
                    </span>
                  </div>

                  {/* Channel context */}
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                    }}
                  >
                    <span>📍</span>
                    <span>{cmd.channelContext}</span>
                  </div>
                </div>

                {/* Summary / description */}
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.5, marginBottom: '1rem' }}>
                  {cmd.description}
                </p>

                {/* Execution Context & Runtime Authorization Scope */}
                {cmd.executionContext && (
                  <div
                    style={{
                      marginBottom: '1.25rem',
                      padding: '0.5rem 0.85rem',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(168, 85, 247, 0.08)',
                      border: '1px solid rgba(168, 85, 247, 0.25)',
                      fontSize: '0.78rem',
                      color: '#d8b4fe',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.6rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        fontSize: '0.68rem',
                        letterSpacing: '0.04em',
                        padding: '0.15rem 0.45rem',
                        borderRadius: '3px',
                        backgroundColor: 'rgba(168, 85, 247, 0.2)',
                        color: '#e9d5ff',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Execution Scope
                    </span>
                    <span style={{ lineHeight: 1.4 }}>{cmd.executionContext}</span>
                  </div>
                )}

                {/* Syntax block with Copy Button */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: '#0a0d14',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '6px',
                    padding: '0.65rem 1rem',
                    marginBottom: '1.25rem',
                    fontFamily: 'Consolas, Monaco, monospace',
                    fontSize: '0.88rem',
                    overflowX: 'auto',
                    gap: '1rem',
                  }}
                >
                  <span style={{ color: 'var(--accent-lime)', wordBreak: 'break-all' }}>{cmd.syntax}</span>
                  <button
                    onClick={() => copyToClipboard(cmd.syntax, cmd.id)}
                    style={{
                      backgroundColor: isCopied ? 'var(--accent-lime)' : 'rgba(255, 255, 255, 0.1)',
                      color: isCopied ? '#000' : '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '0.3rem 0.65rem',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      transition: 'all 0.15s ease',
                    }}
                    title="Copy command syntax"
                  >
                    {isCopied ? '✓ Copied!' : 'Copy'}
                  </button>
                </div>

                {/* Parameters table */}
                {cmd.parameters && cmd.parameters.length > 0 && (
                  <div style={{ marginBottom: '1.25rem' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem', letterSpacing: '0.04em' }}>
                      Parameters &amp; Arguments
                    </div>
                    <DataTable<CommandParameter>
                      columns={paramColumns}
                      data={cmd.parameters}
                      keyExtractor={(p, idx) => `${p.name}-${idx}`}
                      stackedOnMobile={false}
                    />
                  </div>
                )}

                {/* Practical Examples */}
                {cmd.examples && cmd.examples.length > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.4rem', letterSpacing: '0.04em' }}>
                      Real-World Examples
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {cmd.examples.map((ex, exIdx) => {
                        const exCopied = copiedId === `${cmd.id}-ex-${exIdx}`;
                        return (
                          <div
                            key={exIdx}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              backgroundColor: 'rgba(0, 0, 0, 0.25)',
                              border: '1px solid rgba(255, 255, 255, 0.05)',
                              borderRadius: '4px',
                              padding: '0.45rem 0.75rem',
                              fontSize: '0.82rem',
                              gap: '0.75rem',
                            }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                              <code style={{ color: '#57f287', fontSize: '0.84rem' }}>{ex.command}</code>
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{ex.description}</span>
                            </div>
                            <button
                              onClick={() => copyToClipboard(ex.command, `${cmd.id}-ex-${exIdx}`)}
                              style={{
                                background: 'none',
                                border: '1px solid var(--border-subtle)',
                                color: exCopied ? 'var(--accent-lime)' : 'var(--text-muted)',
                                borderRadius: '4px',
                                padding: '0.2rem 0.5rem',
                                fontSize: '0.7rem',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              {exCopied ? '✓' : 'Copy'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Common Errors (Accordion toggle) */}
                {hasErrors && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <button
                      onClick={() => toggleErrors(cmd.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--accent-yellow, #f59e0b)',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        padding: 0,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                      }}
                    >
                      <span>{isErrorExpanded ? '▼' : '▶'}</span>
                      <span>Common Errors &amp; Resolutions ({cmd.commonErrors.length})</span>
                    </button>

                    {isErrorExpanded && (
                      <div
                        style={{
                          marginTop: '0.5rem',
                          backgroundColor: 'rgba(245, 158, 11, 0.05)',
                          border: '1px solid rgba(245, 158, 11, 0.2)',
                          borderRadius: '6px',
                          padding: '0.75rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.65rem',
                          fontSize: '0.8rem',
                        }}
                      >
                        {cmd.commonErrors.map((errItem, errIdx) => (
                          <div key={errIdx} style={{ borderBottom: errIdx < cmd.commonErrors.length - 1 ? '1px solid rgba(245, 158, 11, 0.1)' : 'none', paddingBottom: '0.4rem' }}>
                            <div style={{ color: '#f59e0b', fontWeight: 700, marginBottom: '0.2rem' }}>
                              ⚠️ &quot;{errItem.error}&quot;
                            </div>
                            <div style={{ color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                              <strong>Cause:</strong> {errItem.cause}
                            </div>
                            <div style={{ color: 'var(--accent-lime)' }}>
                              <strong>Resolution:</strong> {errItem.resolution}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Special Notes banner if present */}
                {cmd.notes && (
                  <div
                    style={{
                      marginTop: '0.75rem',
                      padding: '0.5rem 0.75rem',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(59, 130, 246, 0.08)',
                      border: '1px solid rgba(59, 130, 246, 0.2)',
                      fontSize: '0.78rem',
                      color: '#93c5fd',
                    }}
                  >
                    ℹ️ <strong>Note:</strong> {cmd.notes}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
