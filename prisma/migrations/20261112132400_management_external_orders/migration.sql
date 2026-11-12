CREATE UNIQUE INDEX "orders_platform_account_id_external_order_id_key"
ON "orders"("platform_account_id", "external_order_id");
