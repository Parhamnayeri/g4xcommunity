# Backlog

- Existing disposable databases can lag the Prisma schema (for example, a missing
  `wow_characters.thumbnail_url` column); refresh or migrate test databases before
  running suites against them.
- Some integration suites require seeded defaults after a fresh `prisma db push`;
  the test harness should make that prerequisite explicit.
