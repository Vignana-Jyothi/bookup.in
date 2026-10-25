begin;
do $$
declare owner1 uuid; owner2 uuid; product uuid:=gen_random_uuid(); plan uuid:=gen_random_uuid(); result jsonb;
begin
  select id into owner1 from public.providers order by created_at limit 1;
  select id into owner2 from public.providers where id<>owner1 order by created_at limit 1;
  if owner2 is null then raise exception 'Needs two staging merchants'; end if;
  assert not has_table_privilege('anon','public.merchant_commerce_vaults','select');
  assert not has_table_privilege('authenticated','public.merchant_commerce_assets','select');
  assert not has_function_privilege('authenticated','public.save_merchant_commerce_item_v1(uuid,uuid,text,integer,text,text,bigint,integer,integer,text,text)','execute');
  assert (select not public and file_size_limit=10485800 from storage.buckets where id='calup-private-products');
  result:=public.save_merchant_commerce_item_v1(owner1,product,'product',0,'Free test product','',0,1,null,'file','draft');
  assert (result->>'price_paise')::bigint=0 and not(result ? 'provider_id');
  begin
    perform public.save_merchant_commerce_item_v1(owner1,gen_random_uuid(),'product',0,'Below gateway minimum','',50,1,null,'file','draft');
    raise exception 'Expected paid minimum denial';
  exception when check_violation then null; end;
  begin
    perform public.save_merchant_commerce_item_v1(owner2,product,'product',1,'Wrong owner','',100,1,null,'file','draft');
    raise exception 'Expected owner denial';
  exception when others then assert sqlerrm='NOT_FOUND',sqlerrm; end;
  result:=public.save_merchant_commerce_item_v1(owner1,product,'product',1,'Paid test product','',49900,2,null,'file','draft');
  assert (result->>'version')::integer=2;
  begin
    perform public.save_merchant_commerce_item_v1(owner1,product,'product',1,'Stale edit','',100,1,null,'file','draft');
    raise exception 'Expected stale version denial';
  exception when others then assert sqlerrm='VERSION_CONFLICT',sqlerrm; end;
  begin
    insert into public.merchant_commerce_catalog(id,provider_id,kind,title,price_paise,purchase_limit,content_type)
      values(gen_random_uuid(),owner1,'product','Missing purchase limit',0,null,'file');
    raise exception 'Expected missing limit denial';
  exception when check_violation then null; end;
  begin
    perform public.save_merchant_commerce_item_v1(owner1,plan,'membership',0,'Invalid free membership','',0,null,7,null,'draft');
    raise exception 'Expected membership payment validation';
  exception when check_violation then null; end;
  result:=public.save_merchant_commerce_item_v1(owner1,plan,'membership',0,'Seven day plan','',9900,null,7,null,'draft');
  assert (result->>'duration_days')::integer=7;
  begin
    perform public.save_merchant_commerce_item_v1(owner1,plan,'membership',1,'Cannot publish yet','',9900,null,7,null,'published');
    raise exception 'Expected publication gate';
  exception when others then assert sqlerrm='VALIDATION_FAILED',sqlerrm; end;
end $$;
rollback;
