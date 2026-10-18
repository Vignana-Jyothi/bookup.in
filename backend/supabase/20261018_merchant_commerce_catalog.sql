begin;
create table public.merchant_commerce_vaults (
  provider_id uuid primary key references public.providers(id) on delete restrict,
  envelope jsonb not null check(jsonb_typeof(envelope)='object'),
  created_at timestamptz not null default now()
);
create table public.merchant_commerce_catalog (
  id uuid primary key,
  provider_id uuid not null references public.providers(id) on delete restrict,
  kind text not null check(kind in ('product','membership')),
  title text not null check(char_length(title) between 2 and 120),
  description text not null default '' check(char_length(description)<=1000),
  price_paise bigint not null check(price_paise between 0 and 100000000),
  currency text not null default 'INR' check(currency='INR'),
  purchase_limit integer,
  duration_days integer,
  content_type text check(content_type in ('file','link')),
  status text not null default 'draft' check(status in ('draft','archived')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((kind='product' and purchase_limit is not null and purchase_limit between 1 and 1000 and duration_days is null and content_type is not null)
    or (kind='membership' and duration_days is not null and duration_days between 1 and 366 and purchase_limit is null and content_type is null and price_paise>0))
);
create index merchant_commerce_catalog_owner on public.merchant_commerce_catalog(provider_id,created_at desc);
create table public.merchant_commerce_assets (
  product_id uuid primary key references public.merchant_commerce_catalog(id) on delete restrict,
  object_path text not null unique,
  envelope jsonb not null check(jsonb_typeof(envelope)='object'),
  status text not null default 'upload_pending' check(status in ('upload_pending','ready')),
  created_at timestamptz not null default now()
);
alter table public.merchant_commerce_vaults enable row level security;
alter table public.merchant_commerce_catalog enable row level security;
alter table public.merchant_commerce_assets enable row level security;
revoke all on public.merchant_commerce_vaults,public.merchant_commerce_catalog,public.merchant_commerce_assets from public,anon,authenticated;
grant all on public.merchant_commerce_vaults,public.merchant_commerce_catalog,public.merchant_commerce_assets to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('calup-private-products','calup-private-products',false,10485800,array['application/octet-stream'])
on conflict(id) do nothing;

-- Browser roles have no storage policies for this bucket. Server-issued, owned, short-lived URLs only.
create function public.save_merchant_commerce_item_v1(p_provider uuid,p_id uuid,p_kind text,p_version integer,p_title text,p_description text,p_price bigint,p_limit integer,p_days integer,p_content_type text,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.merchant_commerce_catalog%rowtype;
begin
  if p_status not in ('draft','archived') or p_kind not in ('product','membership') then raise exception 'VALIDATION_FAILED'; end if;
  select * into item from public.merchant_commerce_catalog where id=p_id for update;
  if found then
    if item.provider_id<>p_provider then raise exception 'NOT_FOUND'; end if;
    if item.version<>p_version or item.kind<>p_kind then raise exception 'VERSION_CONFLICT'; end if;
    if item.content_type is distinct from p_content_type and exists(select 1 from public.merchant_commerce_assets where product_id=p_id) then raise exception 'ASSET_IMMUTABLE'; end if;
    update public.merchant_commerce_catalog set title=p_title,description=p_description,price_paise=p_price,
      purchase_limit=p_limit,duration_days=p_days,status=p_status,content_type=p_content_type,version=version+1,updated_at=now()
      where id=p_id returning * into item;
  else
    if p_version<>0 then raise exception 'VERSION_CONFLICT'; end if;
    insert into public.merchant_commerce_catalog(id,provider_id,kind,title,description,price_paise,purchase_limit,duration_days,content_type,status)
      values(p_id,p_provider,p_kind,p_title,p_description,p_price,p_limit,p_days,p_content_type,p_status) returning * into item;
  end if;
  return to_jsonb(item)-'provider_id';
end $$;
revoke all on function public.save_merchant_commerce_item_v1(uuid,uuid,text,integer,text,text,bigint,integer,integer,text,text) from public,anon,authenticated;
grant execute on function public.save_merchant_commerce_item_v1(uuid,uuid,text,integer,text,text,bigint,integer,integer,text,text) to service_role;
commit;
