import React from 'react';

export type BadgeVariant = 'lime' | 'purple' | 'green' | 'blue' | 'amber' | 'danger' | 'muted';

export interface SimplifiedStatusLike {
  label: string;
  colorClass?: string;
  rawStatus?: string;
}

export interface StatusBadgeProps {
  status?: string | null;
  simplifiedStatus?: SimplifiedStatusLike | string | null;
  label?: string;
  variant?: BadgeVariant;
  dot?: boolean;
  className?: string;
}

// Maps real G4X backend status strings to visual badge variants and human-readable labels
const STATUS_REGISTRY: Record<string, { label: string; variant: BadgeVariant }> = {
  // Order statuses
  open_presign: { label: 'Open Pre-sign', variant: 'green' },
  created: { label: 'Created', variant: 'blue' },
  published: { label: 'Published', variant: 'lime' },
  claimed: { label: 'Claimed', variant: 'purple' },
  assigned: { label: 'Assigned', variant: 'purple' },
  in_progress: { label: 'In Progress', variant: 'blue' },
  pending_review: { label: 'Pending Review', variant: 'amber' },
  staff_review: { label: 'Staff Review', variant: 'amber' },
  completed: { label: 'Completed', variant: 'green' },
  cancelled: { label: 'Cancelled', variant: 'danger' },
  disputed: { label: 'Disputed', variant: 'danger' },
  hold: { label: 'On Hold', variant: 'amber' },

  // Payment statuses
  verified: { label: 'Verified', variant: 'green' },
  pending: { label: 'Pending', variant: 'amber' },
  unpaid: { label: 'Unpaid', variant: 'amber' },
  failed: { label: 'Failed', variant: 'danger' },
  rejected: { label: 'Rejected', variant: 'danger' },
  refunded: { label: 'Refunded', variant: 'muted' },

  // Withdrawal statuses
  processing: { label: 'Processing', variant: 'blue' },
  approved: { label: 'Approved', variant: 'green' },

  // Dispute statuses
  open: { label: 'Open', variant: 'danger' },
  under_review: { label: 'Under Review', variant: 'amber' },
  waiting_for_evidence: { label: 'Waiting Evidence', variant: 'amber' },
  resolved: { label: 'Resolved', variant: 'green' },

  // User / Account statuses
  active: { label: 'Active', variant: 'green' },
  suspended: { label: 'Suspended', variant: 'danger' },
  banned: { label: 'Banned', variant: 'danger' },
  inactive: { label: 'Inactive', variant: 'muted' },

  // KYC & Application statuses
  none: { label: 'None', variant: 'muted' },
  info_requested: { label: 'Info Requested', variant: 'amber' },
};

function resolveVariantFromColorClass(colorClass?: string): BadgeVariant {
  if (!colorClass) return 'muted';
  if (colorClass.includes('lime')) return 'lime';
  if (colorClass.includes('green') || colorClass.includes('success')) return 'green';
  if (colorClass.includes('blue') || colorClass.includes('info')) return 'blue';
  if (colorClass.includes('amber') || colorClass.includes('warning')) return 'amber';
  if (colorClass.includes('danger') || colorClass.includes('red')) return 'danger';
  if (colorClass.includes('purple')) return 'purple';
  return 'muted';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  simplifiedStatus,
  label,
  variant,
  dot = true,
  className = '',
}) => {
  // If backend provided a pre-formatted simplifiedStatus object or string, honor it
  if (simplifiedStatus) {
    if (typeof simplifiedStatus === 'string') {
      const normalized = simplifiedStatus.toLowerCase().trim();
      const registered = STATUS_REGISTRY[normalized];
      const computedVariant = variant || (registered ? registered.variant : 'muted');
      const displayLabel = label || (registered ? registered.label : simplifiedStatus);
      return (
        <span className={`badge badge-${computedVariant} ${className}`.trim()}>
          {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'currentColor' }} />}
          {displayLabel}
        </span>
      );
    }
    const computedVariant = variant || resolveVariantFromColorClass(simplifiedStatus.colorClass);
    const displayLabel = label || simplifiedStatus.label || simplifiedStatus.rawStatus || 'Unknown';
    return (
      <span className={`badge badge-${computedVariant} ${className}`.trim()}>
        {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'currentColor' }} />}
        {displayLabel}
      </span>
    );
  }

  const normalizedStatus = (status || '').toLowerCase().trim();
  const registered = STATUS_REGISTRY[normalizedStatus];

  const computedVariant: BadgeVariant = variant || (registered ? registered.variant : 'muted');
  const displayLabel = label || (registered ? registered.label : (status ? status.replace(/_/g, ' ') : '—'));

  return (
    <span className={`badge badge-${computedVariant} ${className}`.trim()}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'currentColor' }} />}
      {displayLabel}
    </span>
  );
};
