# Database initialization

Normal `npm start` validates connectivity only. It does not seed or synchronize the game registry.
Deployments must apply reviewed migrations separately; startup never repairs production data.

For a **new installation**, after configuring the intended SQLite database and applying reviewed
migrations, explicitly run `npm run db:seed` before starting the application. This creates missing
roles, games and services. It never updates, deletes or disables existing records, including
administrator-edited canonical defaults. Repeating it on a complete installation performs no DML.
Do not use seeding to reconcile production configuration; use authorized administration services.

Existing installations require no seed and no new migration for this change. Keep persistent
SQLite and private storage paths unchanged. Do not run database resets or `db push` on production.

Regression: `npm run test:startup-persistence` creates its own disposable migrated database,
checks fresh initialization, customized canonical/custom records and dependent order/application/
Discord/service-setting references, 28 synthetic historical records and zero repeated-startup writes.
