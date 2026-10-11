-- CreateTable
CREATE TABLE "registration_applications" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "game_slug" TEXT,
    "service_id" INTEGER,
    "preferred_language" TEXT NOT NULL DEFAULT 'en',
    "qualifications" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "rejection_reason" TEXT,
    "review_notes" TEXT,
    "reviewed_by_id" TEXT,
    "submitted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" DATETIME,
    CONSTRAINT "registration_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "registration_applications_game_slug_fkey" FOREIGN KEY ("game_slug") REFERENCES "games" ("slug") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "registration_applications_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "game_services" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "registration_applications_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "registration_applications_user_id_status_idx" ON "registration_applications"("user_id", "status");

-- CreateIndex
CREATE INDEX "registration_applications_category_status_idx" ON "registration_applications"("category", "status");

-- CreateIndex
CREATE INDEX "registration_applications_status_submitted_at_idx" ON "registration_applications"("status", "submitted_at");
