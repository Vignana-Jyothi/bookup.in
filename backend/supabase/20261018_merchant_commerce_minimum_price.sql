begin;
alter table public.merchant_commerce_catalog add constraint merchant_commerce_paid_minimum
  check(price_paise=0 or price_paise>=100);
commit;
