-- Repair deployments of the initial refund functions to use the constrained admin author role.
do $repair$
declare signature text; definition text;
begin
  foreach signature in array array['public.approve_booking_refund_v1(uuid,uuid,uuid,integer,text,text)','public.finish_booking_refund_v1(uuid,uuid,bigint,text,text)'] loop
    definition:=pg_catalog.pg_get_functiondef(signature::regprocedure);
    execute replace(definition,'values(r.ticket_id,''calup'',','values(r.ticket_id,''admin'',');
  end loop;
end $repair$;
