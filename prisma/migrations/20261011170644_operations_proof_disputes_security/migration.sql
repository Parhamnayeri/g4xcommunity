-- CreateTable
CREATE TABLE "service_settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "service_id" INTEGER NOT NULL,
    "claim_window_seconds" INTEGER NOT NULL DEFAULT 600,
    "proof_required" BOOLEAN NOT NULL DEFAULT true,
    "allow_pause" BOOLEAN NOT NULL DEFAULT true,
    "allow_replacement" BOOLEAN NOT NULL DEFAULT true,
    "accepts_squads" BOOLEAN NOT NULL DEFAULT false,
    "requires_roles" BOOLEAN NOT NULL DEFAULT false,
    "requires_key" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "service_settings_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "game_services" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "channel_routes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "discord_guild_id" TEXT NOT NULL,
    "game_slug" TEXT NOT NULL,
    "service_id" INTEGER,
    "service_mode" TEXT NOT NULL,
    "discord_channel_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "channel_routes_game_slug_fkey" FOREIGN KEY ("game_slug") REFERENCES "games" ("slug") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "channel_routes_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "game_services" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "order_channels" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "order_id" INTEGER NOT NULL,
    "discord_guild_id" TEXT NOT NULL,
    "discord_channel_id" TEXT NOT NULL,
    "channel_type" TEXT NOT NULL DEFAULT 'execution',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" DATETIME,
    CONSTRAINT "order_channels_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "run_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "run_id" INTEGER NOT NULL,
    "actor_id" TEXT,
    "event_type" TEXT NOT NULL,
    "previous_status" TEXT,
    "new_status" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "run_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "order_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "run_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "run_proofs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "run_id" INTEGER NOT NULL,
    "submitted_by_id" TEXT NOT NULL,
    "proof_type" TEXT NOT NULL DEFAULT 'screenshot',
    "evidence_url" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewed_by_id" TEXT,
    "review_notes" TEXT,
    "submitted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" DATETIME,
    CONSTRAINT "run_proofs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "order_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "run_proofs_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "run_proofs_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "order_disputes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "order_id" INTEGER NOT NULL,
    "run_id" INTEGER,
    "opened_by_id" TEXT NOT NULL,
    "dispute_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "assigned_reviewer_id" TEXT,
    "resolution_notes" TEXT,
    "resolved_by_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" DATETIME,
    CONSTRAINT "order_disputes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "order_disputes_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "order_runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "order_disputes_opened_by_id_fkey" FOREIGN KEY ("opened_by_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "order_disputes_assigned_reviewer_id_fkey" FOREIGN KEY ("assigned_reviewer_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "order_disputes_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "escrow_holds" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dispute_id" INTEGER,
    "order_id" INTEGER NOT NULL,
    "ledger_transaction_id" INTEGER,
    "currency" TEXT NOT NULL,
    "amount_minor" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_by_id" TEXT NOT NULL,
    "released_by_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" DATETIME,
    "reason" TEXT NOT NULL,
    CONSTRAINT "escrow_holds_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "order_disputes" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "escrow_holds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "escrow_holds_ledger_transaction_id_fkey" FOREIGN KEY ("ledger_transaction_id") REFERENCES "ledger_transactions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "escrow_holds_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "escrow_holds_released_by_id_fkey" FOREIGN KEY ("released_by_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "previous_values" TEXT,
    "new_values" TEXT,
    "reason" TEXT,
    "is_success" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "event_key" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "notification_type" TEXT NOT NULL,
    "delivery_channel" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" DATETIME,
    "sent_at" DATETIME,
    "error_details" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_outbox_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "service_settings_service_id_key" ON "service_settings"("service_id");

-- CreateIndex
CREATE INDEX "channel_routes_discord_guild_id_game_slug_service_mode_is_active_idx" ON "channel_routes"("discord_guild_id", "game_slug", "service_mode", "is_active");

-- CreateIndex
CREATE INDEX "channel_routes_service_id_idx" ON "channel_routes"("service_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_channels_discord_channel_id_key" ON "order_channels"("discord_channel_id");

-- CreateIndex
CREATE INDEX "order_channels_order_id_status_idx" ON "order_channels"("order_id", "status");

-- CreateIndex
CREATE INDEX "run_events_run_id_created_at_idx" ON "run_events"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "run_events_actor_id_idx" ON "run_events"("actor_id");

-- CreateIndex
CREATE INDEX "run_proofs_run_id_status_idx" ON "run_proofs"("run_id", "status");

-- CreateIndex
CREATE INDEX "run_proofs_submitted_by_id_idx" ON "run_proofs"("submitted_by_id");

-- CreateIndex
CREATE INDEX "order_disputes_order_id_status_idx" ON "order_disputes"("order_id", "status");

-- CreateIndex
CREATE INDEX "order_disputes_opened_by_id_idx" ON "order_disputes"("opened_by_id");

-- CreateIndex
CREATE INDEX "order_disputes_assigned_reviewer_id_idx" ON "order_disputes"("assigned_reviewer_id");

-- CreateIndex
CREATE INDEX "escrow_holds_order_id_status_idx" ON "escrow_holds"("order_id", "status");

-- CreateIndex
CREATE INDEX "escrow_holds_dispute_id_idx" ON "escrow_holds"("dispute_id");

-- CreateIndex
CREATE INDEX "escrow_holds_ledger_transaction_id_idx" ON "escrow_holds"("ledger_transaction_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_outbox_event_key_key" ON "notification_outbox"("event_key");

-- CreateIndex
CREATE INDEX "notification_outbox_status_next_attempt_at_idx" ON "notification_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "notification_outbox_recipient_id_idx" ON "notification_outbox"("recipient_id");

-- Partial Unique Index: Prevent duplicate active execution channels for an order
CREATE UNIQUE INDEX "order_channels_active_execution_unique" ON "order_channels"("order_id") WHERE "channel_type" = 'execution' AND "status" = 'active';

-- Partial Unique Index: Prevent duplicate active channel routes for service-specific routes
CREATE UNIQUE INDEX "channel_routes_guild_game_service_mode_active_unique" ON "channel_routes"("discord_guild_id", "game_slug", "service_id", "service_mode") WHERE "is_active" = 1 AND "service_id" IS NOT NULL;

-- Partial Unique Index: Prevent duplicate active channel routes for game-level fallback routes
CREATE UNIQUE INDEX "channel_routes_guild_game_fallback_mode_active_unique" ON "channel_routes"("discord_guild_id", "game_slug", "service_mode") WHERE "is_active" = 1 AND "service_id" IS NULL;
