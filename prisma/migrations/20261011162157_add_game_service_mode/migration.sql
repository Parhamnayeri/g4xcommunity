-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_game_services" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "game_slug" TEXT NOT NULL,
    "service_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "service_mode" TEXT NOT NULL DEFAULT 'non_pilot',
    "profile_mode" TEXT NOT NULL,
    "requires_pilot_approval" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "game_services_game_slug_fkey" FOREIGN KEY ("game_slug") REFERENCES "games" ("slug") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_game_services" ("display_name", "game_slug", "id", "is_active", "profile_mode", "requires_pilot_approval", "service_key") SELECT "display_name", "game_slug", "id", "is_active", "profile_mode", "requires_pilot_approval", "service_key" FROM "game_services";
DROP TABLE "game_services";
ALTER TABLE "new_game_services" RENAME TO "game_services";
CREATE UNIQUE INDEX "game_services_game_slug_service_key_key" ON "game_services"("game_slug", "service_key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
