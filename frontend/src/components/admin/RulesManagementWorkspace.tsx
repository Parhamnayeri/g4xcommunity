import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/Card';
import { LoadingState } from '../ui/LoadingState';
import {
  fetchAdminPolicyOverview,
  saveDraftPolicyApi,
  publishPolicyVersionApi,
  restorePolicyVersionApi,
  fetchPolicyVersions,
  retryDiscordSyncApi,
} from '../../services/policy';
import {
  PolicyVersion,
  PolicySection,
  PolicySubsection,
  PolicyDiscrepancyWarning,
  PolicyVersionItem,
} from '../../types/policy';

export const RulesManagementWorkspace: React.FC = () => {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Policy Data State
  const [draft, setDraft] = useState<PolicyVersion | null>(null);
  const [published, setPublished] = useState<PolicyVersion | null>(null);
  const [discrepancies, setDiscrepancies] = useState<PolicyDiscrepancyWarning[]>([]);
  const [versions, setVersions] = useState<PolicyVersionItem[]>([]);

  // Sub-tab Navigation: 'editor' | 'preview' | 'diff' | 'history'
  const [activeSubTab, setActiveSubTab] = useState<'editor' | 'preview' | 'diff' | 'history'>('editor');

  // Form Editing State
  const [editTitle, setEditTitle] = useState<string>('');
  const [editEffectiveDate, setEditEffectiveDate] = useState<string>('');
  const [editChangelog, setEditChangelog] = useState<string>('');
  const [sections, setSections] = useState<PolicySection[]>([]);
  const [savingDraft, setSavingDraft] = useState<boolean>(false);

  // Publish Modal State
  const [showPublishModal, setShowPublishModal] = useState<boolean>(false);
  const [publishChangelog, setPublishChangelog] = useState<string>('');
  const [acknowledgedWarnings, setAcknowledgedWarnings] = useState<Record<string, boolean>>({});
  const [publishing, setPublishing] = useState<boolean>(false);

  // Sync Retry State
  const [retryingSync, setRetryingSync] = useState<boolean>(false);

  // Load Policy Data
  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAdminPolicyOverview();
      if (res.success) {
        setDraft(res.draftVersion);
        setPublished(res.publishedVersion);
        setDiscrepancies(res.discrepancies || []);

        setEditTitle(res.draftVersion.title);
        setEditEffectiveDate(
          res.draftVersion.effectiveDate ? res.draftVersion.effectiveDate.split('T')[0] : ''
        );
        setEditChangelog(res.draftVersion.changelog || '');
        setSections(JSON.parse(JSON.stringify(res.draftVersion.sections || [])));
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load policy management data.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadVersions = useCallback(async () => {
    try {
      const res = await fetchPolicyVersions();
      if (res.success) {
        setVersions(res.versions);
      }
    } catch (err: any) {
      console.error('Failed to load version history:', err);
    }
  }, []);

  useEffect(() => {
    loadOverview();
    loadVersions();
  }, [loadOverview, loadVersions]);

  // Section Manipulation
  const handleAddSection = () => {
    const nextNumber = sections.length + 1;
    const newSection: PolicySection = {
      id: Date.now(),
      sectionNumber: nextNumber,
      sectionKey: `section_${nextNumber}`,
      title: `${nextNumber}. New Policy Section`,
      sortOrder: nextNumber,
      isActive: true,
      content: '',
      subsections: [],
    };
    setSections([...sections, newSection]);
  };

  const handleRemoveSection = (index: number) => {
    if (!window.confirm('Are you sure you want to remove this section?')) return;
    const updated = [...sections];
    updated.splice(index, 1);
    setSections(updated);
  };

  const handleMoveSection = (index: number, direction: 'up' | 'down') => {
    if (
      (direction === 'up' && index === 0) ||
      (direction === 'down' && index === sections.length - 1)
    ) {
      return;
    }
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const updated = [...sections];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;

    // Reassign sortOrder
    updated.forEach((s, idx) => {
      s.sortOrder = idx + 1;
    });
    setSections(updated);
  };

  const handleAddSubsection = (sectionIndex: number) => {
    const updated = [...sections];
    const sec = updated[sectionIndex];
    const nextSubNum = (sec.subsections || []).length + 1;
    const newSub: PolicySubsection = {
      id: Date.now(),
      subsectionKey: `${sec.sectionKey}_sub_${nextSubNum}`,
      title: `Subsection ${nextSubNum}`,
      sortOrder: nextSubNum,
      content: '',
      contentType: 'MARKDOWN',
      tableDataJson: null,
      isActive: true,
    };
    sec.subsections = [...(sec.subsections || []), newSub];
    setSections(updated);
  };

  const handleRemoveSubsection = (sectionIndex: number, subIndex: number) => {
    const updated = [...sections];
    updated[sectionIndex].subsections.splice(subIndex, 1);
    setSections(updated);
  };

  // Commission Table Editing Helper
  const handleCommissionCellChange = (
    sectionIndex: number,
    subIndex: number,
    rowIndex: number,
    cellIndex: number,
    value: string
  ) => {
    const updated = [...sections];
    const sub = updated[sectionIndex].subsections[subIndex];
    try {
      const table = JSON.parse(sub.tableDataJson || '{"headers":[],"rows":[]}');
      table.rows[rowIndex][cellIndex] = value;
      sub.tableDataJson = JSON.stringify(table);

      // Also update markdown content representation
      let md = `| ${table.headers.join(' | ')} |\n| ${table.headers.map(() => '---').join(' | ')} |\n`;
      table.rows.forEach((r: string[]) => {
        md += `| ${r.join(' | ')} |\n`;
      });
      sub.content = md.trim();
      setSections(updated);
    } catch {
      // Fallback
    }
  };

  // Save Draft Handler
  const handleSaveDraft = async () => {
    if (!draft) return;
    setSavingDraft(true);
    setFeedback(null);
    try {
      const res = await saveDraftPolicyApi({
        versionId: draft.id,
        title: editTitle.trim(),
        effectiveDate: editEffectiveDate || null,
        changelog: editChangelog.trim() || undefined,
        sections,
      });
      if (res.success) {
        setFeedback({ text: 'Draft policy saved successfully with audit log.', type: 'success' });
        setDraft(res.draftVersion);
      }
    } catch (err: any) {
      setFeedback({ text: err.message || 'Failed to save draft policy.', type: 'error' });
    } finally {
      setSavingDraft(false);
    }
  };

  // Publish Handler
  const handlePublish = async () => {
    if (!draft) return;

    // Check all warnings acknowledged
    const allAcknowledged = discrepancies.every((d) => acknowledgedWarnings[d.id]);
    if (!allAcknowledged) {
      alert('Please review and check all operational discrepancy warnings before publishing.');
      return;
    }

    setPublishing(true);
    setFeedback(null);
    try {
      const res = await publishPolicyVersionApi({
        versionId: draft.id,
        changelog: publishChangelog.trim() || undefined,
        acknowledgedDiscrepancies: Object.keys(acknowledgedWarnings).filter(
          (k) => acknowledgedWarnings[k]
        ),
      });

      if (res.success) {
        setShowPublishModal(false);
        setFeedback({
          text: `Policy Version ${res.publishedVersion.versionNumber} published and queued for Discord synchronization!`,
          type: 'success',
        });
        await loadOverview();
        await loadVersions();
      }
    } catch (err: any) {
      alert(err.message || 'Failed to publish policy version.');
    } finally {
      setPublishing(false);
    }
  };

  // Restore Version Handler
  const handleRestoreVersion = async (sourceVersionId: number) => {
    if (
      !window.confirm(
        'Are you sure you want to restore this version as a NEW draft? Existing unpublished changes will remain intact as a separate draft.'
      )
    ) {
      return;
    }

    setLoading(true);
    setFeedback(null);
    try {
      const res = await restorePolicyVersionApi({ sourceVersionId });
      if (res.success) {
        setFeedback({
          text: `Version restored as new Draft v${res.newDraftVersion.versionNumber}.`,
          type: 'success',
        });
        await loadOverview();
        await loadVersions();
        setActiveSubTab('editor');
      }
    } catch (err: any) {
      setFeedback({ text: err.message || 'Failed to restore version.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // Retry Discord Sync Handler
  const handleRetryDiscordSync = async (versionId: number) => {
    setRetryingSync(true);
    setFeedback(null);
    try {
      const res = await retryDiscordSyncApi({ versionId });
      if (res.success) {
        setFeedback({ text: 'Discord synchronization completed successfully!', type: 'success' });
        await loadOverview();
      } else {
        setFeedback({
          text: `Discord sync result: ${res.syncResult?.error || 'Failed'}`,
          type: 'error',
        });
      }
    } catch (err: any) {
      setFeedback({ text: err.message || 'Failed to retry Discord sync.', type: 'error' });
    } finally {
      setRetryingSync(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem' }}>
        <LoadingState message="Loading policy document and version history..." />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header & Status Banner */}
      <div
        className="card-surface"
        style={{
          padding: '1.5rem',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
              📜 Dynamic Rules &amp; Policies CMS
            </h2>
            <span className="badge badge-purple" style={{ fontSize: '0.72rem' }}>
              Authoritative
            </span>
            {published ? (
              <span className="badge badge-success" style={{ fontSize: '0.72rem' }}>
                Active Published: v{published.versionNumber}.0
              </span>
            ) : (
              <span className="badge badge-warning" style={{ fontSize: '0.72rem' }}>
                No Published Version
              </span>
            )}
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
            Website and Discord share one authoritative rules document with immutable version snapshots.
          </p>
        </div>

        {/* Discord Sync Status & Quick Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {published && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.82rem',
                padding: '0.4rem 0.75rem',
                backgroundColor: 'rgba(0, 0, 0, 0.25)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <span>Discord:</span>
              <span
                style={{
                  fontWeight: 700,
                  color:
                    published.discordSyncStatus === 'SYNCED'
                      ? 'var(--accent-lime)'
                      : published.discordSyncStatus === 'FAILED'
                      ? '#ef4444'
                      : '#f59e0b',
                }}
              >
                {published.discordSyncStatus === 'SYNCED'
                  ? '🟢 Synced'
                  : published.discordSyncStatus === 'FAILED'
                  ? '🔴 Sync Failed'
                  : '🟡 Pending'}
              </span>
              {published.discordSyncStatus === 'FAILED' && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
                  onClick={() => handleRetryDiscordSync(published.id)}
                  disabled={retryingSync}
                >
                  {retryingSync ? 'Syncing...' : '↻ Retry Sync'}
                </button>
              )}
            </div>
          )}

          <a
            href="/rules"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary btn-sm"
          >
            ↗ Public /rules
          </a>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleSaveDraft}
            disabled={savingDraft}
          >
            {savingDraft ? 'Saving Draft...' : '💾 Save Draft'}
          </button>

          <button
            type="button"
            className="btn btn-cta btn-sm"
            onClick={() => setShowPublishModal(true)}
            disabled={!draft}
          >
            🚀 Publish Version {draft?.versionNumber}.0
          </button>
        </div>
      </div>

      {feedback && (
        <div
          style={{
            padding: '0.85rem 1.25rem',
            borderRadius: 'var(--radius-sm)',
            backgroundColor:
              feedback.type === 'success' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            color: feedback.type === 'success' ? '#4ade80' : '#ef4444',
            border: `1px solid ${feedback.type === 'success' ? '#22c55e' : '#ef4444'}`,
            fontSize: '0.88rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '1rem',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            color: '#ef4444',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          {error}
        </div>
      )}

      {/* Sub-Tabs Navigation */}
      <nav className="tabs-nav-bar" aria-label="Policy Workspace Tabs">
        <button
          type="button"
          onClick={() => setActiveSubTab('editor')}
          className={`tab-btn ${activeSubTab === 'editor' ? 'tab-btn-active active' : ''}`}
        >
          <span>✏️</span> Draft Editor (v{draft?.versionNumber})
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('preview')}
          className={`tab-btn ${activeSubTab === 'preview' ? 'tab-btn-active active' : ''}`}
        >
          <span>👁️</span> Live Preview
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('diff')}
          className={`tab-btn ${activeSubTab === 'diff' ? 'tab-btn-active active' : ''}`}
        >
          <span>⚖️</span> Compare with Published
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('history')}
          className={`tab-btn ${activeSubTab === 'history' ? 'tab-btn-active active' : ''}`}
        >
          <span>📜</span> Version History ({versions.length})
        </button>
      </nav>

      {/* ─── TAB 1: DRAFT EDITOR ────────────────────────────────────────── */}
      {activeSubTab === 'editor' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Metadata Card */}
          <Card style={{ padding: '1.5rem', backgroundColor: 'var(--bg-surface)' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 1rem', color: 'var(--text-primary)' }}>
              Document Information
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                  Policy Document Title
                </label>
                <input
                  type="text"
                  className="input"
                  style={{ width: '100%', fontSize: '0.88rem' }}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                  Effective Date
                </label>
                <input
                  type="date"
                  className="input"
                  style={{ width: '100%', fontSize: '0.88rem' }}
                  value={editEffectiveDate}
                  onChange={(e) => setEditEffectiveDate(e.target.value)}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                  Draft Notes / Changelog
                </label>
                <input
                  type="text"
                  className="input"
                  style={{ width: '100%', fontSize: '0.88rem' }}
                  placeholder="e.g. Updated commission rates and Discord rules"
                  value={editChangelog}
                  onChange={(e) => setEditChangelog(e.target.value)}
                />
              </div>
            </div>
          </Card>

          {/* Sections List */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
              Policy Sections ({sections.length})
            </h3>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleAddSection}
            >
              ➕ Add Section
            </button>
          </div>

          {sections.map((sec, secIdx) => (
            <Card
              key={sec.id || secIdx}
              style={{
                padding: '1.5rem',
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {/* Section Header Controls */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderBottom: '1px solid var(--border-subtle)',
                  paddingBottom: '0.75rem',
                  marginBottom: '1rem',
                  gap: '0.75rem',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: '220px' }}>
                  <span style={{ fontWeight: 800, color: 'var(--accent-lime)' }}>
                    #{sec.sectionNumber}
                  </span>
                  <input
                    type="text"
                    className="input"
                    style={{ fontWeight: 700, fontSize: '1rem', width: '100%' }}
                    value={sec.title}
                    onChange={(e) => {
                      const updated = [...sections];
                      updated[secIdx].title = e.target.value;
                      setSections(updated);
                    }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={secIdx === 0}
                    onClick={() => handleMoveSection(secIdx, 'up')}
                    title="Move section up"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={secIdx === sections.length - 1}
                    onClick={() => handleMoveSection(secIdx, 'down')}
                    title="Move section down"
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleAddSubsection(secIdx)}
                  >
                    ➕ Subsection
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ color: '#ef4444' }}
                    onClick={() => handleRemoveSection(secIdx)}
                    title="Remove section"
                  >
                    🗑️
                  </button>
                </div>
              </div>

              {/* Section Lead / Intro Content */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                  Section Introduction (Optional)
                </label>
                <textarea
                  className="input"
                  style={{ width: '100%', minHeight: '60px', fontSize: '0.85rem' }}
                  value={sec.content || ''}
                  onChange={(e) => {
                    const updated = [...sections];
                    updated[secIdx].content = e.target.value;
                    setSections(updated);
                  }}
                  placeholder="Introductory text before subsections..."
                />
              </div>

              {/* Subsections List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', paddingLeft: '0.75rem', borderLeft: '2px solid rgba(204, 255, 0, 0.2)' }}>
                {sec.subsections.map((sub, subIdx) => (
                  <div
                    key={sub.id || subIdx}
                    style={{
                      padding: '1rem',
                      backgroundColor: 'rgba(0, 0, 0, 0.25)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem', gap: '0.5rem' }}>
                      <input
                        type="text"
                        className="input"
                        style={{ fontWeight: 600, fontSize: '0.92rem', width: '100%' }}
                        value={sub.title}
                        onChange={(e) => {
                          const updated = [...sections];
                          updated[secIdx].subsections[subIdx].title = e.target.value;
                          setSections(updated);
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ color: '#ef4444', padding: '0.2rem 0.5rem' }}
                        onClick={() => handleRemoveSubsection(secIdx, subIdx)}
                        title="Remove subsection"
                      >
                        ✕
                      </button>
                    </div>

                    {/* Table-specific interactive editor if table data is present */}
                    {sub.contentType === 'TABLE' && sub.tableDataJson ? (
                      (() => {
                        try {
                          const tbl = JSON.parse(sub.tableDataJson);
                          return (
                            <div style={{ marginBottom: '0.75rem' }}>
                              <span style={{ fontSize: '0.75rem', color: 'var(--accent-lime)', fontWeight: 600 }}>
                                📊 Editable Commission Table:
                              </span>
                              <div className="table-responsive-container" style={{ margin: '0.5rem 0' }}>
                                <table className="data-table" style={{ width: '100%', fontSize: '0.82rem' }}>
                                  <thead>
                                    <tr>
                                      {tbl.headers.map((h: string, idx: number) => (
                                        <th key={idx}>{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {tbl.rows.map((row: string[], rIdx: number) => (
                                      <tr key={rIdx}>
                                        {row.map((cell: string, cIdx: number) => (
                                          <td key={cIdx} style={{ padding: '0.35rem' }}>
                                            <input
                                              type="text"
                                              className="input input-sm"
                                              style={{ width: '100%', fontSize: '0.82rem' }}
                                              value={cell}
                                              onChange={(e) =>
                                                handleCommissionCellChange(
                                                  secIdx,
                                                  subIdx,
                                                  rIdx,
                                                  cIdx,
                                                  e.target.value
                                                )
                                              }
                                            />
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        } catch {
                          return null;
                        }
                      })()
                    ) : null}

                    {/* Content Markdown Textarea */}
                    <div>
                      <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>
                        Content (Markdown supported)
                      </label>
                      <textarea
                        className="input"
                        style={{ width: '100%', minHeight: '90px', fontSize: '0.85rem', fontFamily: 'monospace' }}
                        value={sub.content}
                        onChange={(e) => {
                          const updated = [...sections];
                          updated[secIdx].subsections[subIdx].content = e.target.value;
                          setSections(updated);
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ─── TAB 2: LIVE PREVIEW ────────────────────────────────────────── */}
      {activeSubTab === 'preview' && (
        <Card style={{ padding: '2rem', backgroundColor: 'var(--bg-surface)' }}>
          <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
            <span className="badge badge-purple" style={{ marginBottom: '0.5rem' }}>
              Preview Mode · Draft v{draft?.versionNumber}
            </span>
            <h1 style={{ fontSize: '2.2rem', fontWeight: 800, margin: '0 0 0.5rem', color: 'var(--text-primary)' }}>
              {editTitle || 'G4X Community Official Policy & Rules'}
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
              Effective Date: {editEffectiveDate || 'Immediate on publication'}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {sections
              .filter((s) => s.isActive !== false)
              .map((sec) => (
                <div key={sec.id} style={{ borderBottom: '1px solid rgba(45, 38, 69, 0.4)', paddingBottom: '1.5rem' }}>
                  <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--accent-lime)', marginBottom: '0.75rem' }}>
                    {sec.title}
                  </h2>
                  {sec.content && (
                    <p style={{ fontSize: '0.92rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '1rem' }}>
                      {sec.content}
                    </p>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', paddingLeft: '0.5rem' }}>
                    {sec.subsections
                      .filter((sub) => sub.isActive !== false)
                      .map((sub) => (
                        <div key={sub.id}>
                          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.4rem', color: 'var(--text-primary)' }}>
                            {sub.title}
                          </h3>
                          <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
                            {sub.content}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
          </div>
        </Card>
      )}

      {/* ─── TAB 3: DIFF WITH PUBLISHED ─────────────────────────────────── */}
      {activeSubTab === 'diff' && (
        <Card style={{ padding: '2rem', backgroundColor: 'var(--bg-surface)' }}>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: '0 0 1rem', color: 'var(--text-primary)' }}>
            Diff: Draft v{draft?.versionNumber} vs Active Published {published ? `v${published.versionNumber}` : '(None)'}
          </h3>

          {!published ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              No active version has been published yet. Publishing this draft will establish Version 1.0.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              <div>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--accent-lime)', margin: '0 0 0.5rem' }}>
                  Current Published (v{published.versionNumber})
                </h4>
                <div
                  style={{
                    backgroundColor: '#12101d',
                    padding: '1rem',
                    borderRadius: 'var(--radius-sm)',
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    maxHeight: '500px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    color: 'var(--text-muted)',
                  }}
                >
                  {published.rawContentMarkdown}
                </div>
              </div>

              <div>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--accent-lime)', margin: '0 0 0.5rem' }}>
                  New Draft (v{draft?.versionNumber})
                </h4>
                <div
                  style={{
                    backgroundColor: '#12101d',
                    padding: '1rem',
                    borderRadius: 'var(--radius-sm)',
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    maxHeight: '500px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    color: '#e2e8f0',
                  }}
                >
                  {draft?.rawContentMarkdown}
                </div>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ─── TAB 4: VERSION HISTORY ─────────────────────────────────────── */}
      {activeSubTab === 'history' && (
        <div className="card-surface" style={{ padding: '1.5rem', backgroundColor: 'var(--bg-surface)' }}>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: '0 0 1.25rem', color: 'var(--text-primary)' }}>
            Policy Publication Snapshots &amp; History
          </h3>

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Effective Date</th>
                  <th>Published Date</th>
                  <th>Publisher</th>
                  <th>Changelog</th>
                  <th>Discord Sync</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((ver) => (
                  <tr key={ver.id}>
                    <td>
                      <strong>v{ver.versionNumber}.0</strong>
                      {ver.isCurrentPublished && (
                        <span className="badge badge-green" style={{ marginLeft: '0.4rem', fontSize: '0.68rem' }}>
                          Current
                        </span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          ver.status === 'PUBLISHED'
                            ? 'badge-green'
                            : ver.status === 'ARCHIVED'
                            ? 'badge-purple'
                            : 'badge-amber'
                        }`}
                        style={{ fontSize: '0.72rem' }}
                      >
                        {ver.status}
                      </span>
                    </td>
                    <td>
                      {ver.effectiveDate ? new Date(ver.effectiveDate).toLocaleDateString() : '—'}
                    </td>
                    <td>
                      {ver.publishedAt ? new Date(ver.publishedAt).toLocaleString() : '—'}
                    </td>
                    <td className="font-mono-code" style={{ color: 'var(--text-muted)' }}>
                      {ver.publisherDiscordId || ver.authorDiscordId || 'System'}
                    </td>
                    <td style={{ maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ver.changelog || '—'}
                    </td>
                    <td>
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: '0.75rem',
                          color:
                            ver.discordSyncStatus === 'SYNCED'
                              ? 'var(--accent-yellow)'
                              : ver.discordSyncStatus === 'FAILED'
                              ? '#ef4444'
                              : '#94a3b8',
                        }}
                      >
                        {ver.discordSyncStatus}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                        {ver.status === 'PUBLISHED' && ver.discordSyncStatus !== 'SYNCED' && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={() => handleRetryDiscordSync(ver.id)}
                            disabled={retryingSync}
                          >
                            ↻ Sync
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-secondary btn-xs"
                          onClick={() => handleRestoreVersion(ver.id)}
                          title="Restore this version into a new draft"
                        >
                          ↺ Restore
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── PUBLISH CONFIRMATION MODAL WITH DISCREPANCY ACKNOWLEDGMENTS ─ */}
      {showPublishModal && (
        <div className="studio-modal-backdrop" onClick={() => setShowPublishModal(false)}>
          <div
            className="studio-modal-card studio-modal-card-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="studio-modal-header">
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                🚀 Confirm Policy Publication (Version {draft?.versionNumber}.0)
              </h3>
              <button
                type="button"
                className="studio-modal-close"
                onClick={() => setShowPublishModal(false)}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              Publishing will make this version immediately authoritative on <strong>https://g4x.online/rules</strong> and initiate automatic message updates on the official Discord channel <strong>#rules-and-policies</strong>.
            </p>

            {/* Mandatory Discrepancy Warnings Checklist */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f59e0b', margin: '0 0 0.5rem' }}>
                ⚠️ Operational Discrepancy Acknowledgment ({discrepancies.length} items)
              </h4>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Please review and acknowledge that the following policy clauses represent operational/legal guidelines requiring human team discretion, rather than automated financial engine triggers:
              </p>

              <div
                style={{
                  maxHeight: '260px',
                  overflowY: 'auto',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.75rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  backgroundColor: '#12101d',
                }}
              >
                {discrepancies.map((w) => (
                  <label
                    key={w.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.6rem',
                      cursor: 'pointer',
                      fontSize: '0.82rem',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(acknowledgedWarnings[w.id])}
                      onChange={(e) =>
                        setAcknowledgedWarnings({
                          ...acknowledgedWarnings,
                          [w.id]: e.target.checked,
                        })
                      }
                      style={{ marginTop: '0.2rem' }}
                    />
                    <div>
                      <strong style={{ color: w.severity === 'WARNING' ? '#f59e0b' : 'var(--accent-lime)' }}>
                        {w.section}:
                      </strong>{' '}
                      <span style={{ color: 'var(--text-muted)' }}>{w.operationalReality}</span>
                    </div>
                  </label>
                ))}
              </div>

              <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: '0.75rem' }}
                  onClick={() => {
                    const all: Record<string, boolean> = {};
                    discrepancies.forEach((d) => (all[d.id] = true));
                    setAcknowledgedWarnings(all);
                  }}
                >
                  ✓ Acknowledge All ({discrepancies.length})
                </button>
              </div>
            </div>

            {/* Publication Changelog */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                Publication Changelog Note
              </label>
              <input
                type="text"
                className="input"
                style={{ width: '100%', fontSize: '0.85rem' }}
                placeholder="e.g. Official community launch policy release"
                value={publishChangelog}
                onChange={(e) => setPublishChangelog(e.target.value)}
              />
            </div>

            {/* Modal Actions */}
            <div className="studio-modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowPublishModal(false)}
                disabled={publishing}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-cta"
                onClick={handlePublish}
                disabled={
                  publishing ||
                  !discrepancies.every((d) => acknowledgedWarnings[d.id])
                }
              >
                {publishing ? 'Publishing & Syncing...' : 'Confirm & Publish'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
