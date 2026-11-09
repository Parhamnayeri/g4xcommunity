export interface PolicySubsection {
  id: number;
  subsectionKey: string | null;
  title: string;
  sortOrder: number;
  content: string;
  contentType: 'MARKDOWN' | 'TABLE' | 'LIST';
  tableDataJson: string | null;
  isActive: boolean;
}

export interface PolicySection {
  id: number;
  sectionNumber: number;
  sectionKey: string;
  title: string;
  sortOrder: number;
  isActive: boolean;
  content: string | null;
  subsections: PolicySubsection[];
}

export interface PolicyVersion {
  id: number;
  documentId: number;
  versionNumber: number;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  title: string;
  effectiveDate: string | null;
  publishedAt: string | null;
  authorDiscordId: string;
  publisherDiscordId: string | null;
  lastEditorDiscordId: string | null;
  changelog: string | null;
  discordSyncStatus: 'PENDING' | 'SYNCED' | 'FAILED' | 'NOT_CONFIGURED';
  discordSyncResult: string | null;
  discordSyncedAt: string | null;
  rawContentMarkdown: string;
  sections: PolicySection[];
}

export interface PolicyDocument {
  id: number;
  slug: string;
  title: string;
  currentPublishedVersionId: number | null;
}

export interface PolicyDiscrepancyWarning {
  id: string;
  section: string;
  severity: 'WARNING' | 'INFO';
  policyStatement: string;
  operationalReality: string;
}

export interface PolicyOverviewResponse {
  success: boolean;
  document: PolicyDocument;
  draftVersion: PolicyVersion;
  publishedVersion: PolicyVersion | null;
  discrepancies: PolicyDiscrepancyWarning[];
}

export interface PublicPolicyResponse {
  success: boolean;
  policy: PolicyVersion | null;
  fallbackAvailable?: boolean;
}

export interface PolicyVersionItem {
  id: number;
  versionNumber: number;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  title: string;
  effectiveDate: string | null;
  publishedAt: string | null;
  authorDiscordId: string;
  publisherDiscordId: string | null;
  lastEditorDiscordId: string | null;
  changelog: string | null;
  discordSyncStatus: 'PENDING' | 'SYNCED' | 'FAILED' | 'NOT_CONFIGURED';
  discordSyncResult: string | null;
  discordSyncedAt: string | null;
  createdAt: string;
  isCurrentPublished: boolean;
}
