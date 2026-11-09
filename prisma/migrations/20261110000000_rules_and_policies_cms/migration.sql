-- CreateTable
CREATE TABLE "policy_documents" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL DEFAULT 'community-rules',
    "title" TEXT NOT NULL DEFAULT 'G4X Community Official Policy & Rules',
    "description" TEXT,
    "current_published_version_id" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "policy_versions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "document_id" INTEGER NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL DEFAULT 'G4X Community Official Policy & Rules',
    "effective_date" DATETIME,
    "published_at" DATETIME,
    "author_discord_id" TEXT NOT NULL,
    "publisher_discord_id" TEXT,
    "last_editor_discord_id" TEXT,
    "changelog" TEXT,
    "discord_sync_status" TEXT NOT NULL DEFAULT 'PENDING',
    "discord_sync_result" TEXT,
    "discord_synced_at" DATETIME,
    "raw_content_markdown" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "policy_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "policy_documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "policy_sections" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "version_id" INTEGER NOT NULL,
    "section_number" INTEGER NOT NULL,
    "section_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "content" TEXT,
    CONSTRAINT "policy_sections_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "policy_versions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "policy_subsections" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "section_id" INTEGER NOT NULL,
    "subsection_key" TEXT,
    "title" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL,
    "content_type" TEXT NOT NULL DEFAULT 'MARKDOWN',
    "table_data_json" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "policy_subsections_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "policy_sections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "policy_discord_messages" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "version_id" INTEGER NOT NULL,
    "channel_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "message_index" INTEGER NOT NULL DEFAULT 0,
    "section_key" TEXT,
    "checksum" TEXT,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "policy_discord_messages_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "policy_versions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_policy_acceptances" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" TEXT NOT NULL,
    "version_id" INTEGER NOT NULL,
    "accepted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "user_agent" TEXT,
    CONSTRAINT "user_policy_acceptances_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "policy_versions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "policy_documents_slug_key" ON "policy_documents"("slug");

-- CreateIndex
CREATE INDEX "policy_versions_document_id_idx" ON "policy_versions"("document_id");

-- CreateIndex
CREATE INDEX "policy_versions_status_idx" ON "policy_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "policy_versions_document_id_version_number_key" ON "policy_versions"("document_id", "version_number");

-- CreateIndex
CREATE INDEX "policy_sections_version_id_sort_order_idx" ON "policy_sections"("version_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "policy_sections_version_id_section_key_key" ON "policy_sections"("version_id", "section_key");

-- CreateIndex
CREATE INDEX "policy_subsections_section_id_sort_order_idx" ON "policy_subsections"("section_id", "sort_order");

-- CreateIndex
CREATE INDEX "policy_discord_messages_version_id_idx" ON "policy_discord_messages"("version_id");

-- CreateIndex
CREATE INDEX "policy_discord_messages_channel_id_idx" ON "policy_discord_messages"("channel_id");

-- CreateIndex
CREATE INDEX "user_policy_acceptances_user_id_idx" ON "user_policy_acceptances"("user_id");

-- CreateIndex
CREATE INDEX "user_policy_acceptances_version_id_idx" ON "user_policy_acceptances"("version_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_policy_acceptances_user_id_version_id_key" ON "user_policy_acceptances"("user_id", "version_id");
