-- Read-only installed definition contract; use an isolated migrated database.
do $$
declare body text;
begin
  body := pg_get_functiondef('public.mark_subscription_refund_v1(uuid,text,text,text)'::regprocedure);
  if position('where id = p_refund_id for update' in body) = 0
    or position('if v_current_status = ''succeeded'' then return true; end if;' in body) = 0
    or position('if v_current_status = ''succeeded''' in body) > position('update finance.refunds_v1 set status = p_status' in body) then
    raise exception 'Successful subscription refund must remain terminal under stale observations';
  end if;
end $$;
