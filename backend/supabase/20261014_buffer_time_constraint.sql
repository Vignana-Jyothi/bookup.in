-- Bound merchant buffer input used by every generated-slot calculation.

alter table public.providers
  drop constraint if exists providers_buffer_time_range;

alter table public.providers
  add constraint providers_buffer_time_range
  check (buffer_time is null or buffer_time between 0 and 240);
