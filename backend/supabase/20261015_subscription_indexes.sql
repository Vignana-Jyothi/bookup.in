-- Cover subscription foreign keys used by lifecycle, history, and reconciliation queries.
create index if not exists access_code_redemptions_provider_id_idx
  on app.access_code_redemptions (provider_id);

create index if not exists access_codes_bound_provider_id_idx
  on app.access_codes (bound_provider_id)
  where bound_provider_id is not null;

create index if not exists merchant_entitlements_last_subscription_order_id_idx
  on app.merchant_entitlements (last_subscription_order_id)
  where last_subscription_order_id is not null;

create index if not exists merchant_entitlements_plan_id_idx
  on app.merchant_entitlements (plan_id);

create index if not exists service_credits_provider_id_idx
  on app.service_credits (provider_id);

create index if not exists subscription_credit_notes_invoice_id_idx
  on finance.subscription_credit_notes (invoice_id);

create index if not exists subscription_credit_notes_provider_id_idx
  on finance.subscription_credit_notes (provider_id);

create index if not exists subscription_invoices_provider_id_idx
  on finance.subscription_invoices (provider_id);

create index if not exists subscription_orders_plan_id_idx
  on finance.subscription_orders (plan_id);

create index if not exists subscription_payment_reviews_provider_id_idx
  on finance.subscription_payment_reviews (provider_id);
