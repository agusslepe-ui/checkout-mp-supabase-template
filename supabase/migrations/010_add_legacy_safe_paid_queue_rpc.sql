-- T-022.5: legacy-safe financial confirmation plus optional shipping queue.
-- Review and apply manually only during an explicitly authorized cutover.

begin;

create function public.mark_order_paid_and_queue_shipping_import_v2(
  p_external_reference text,
  p_mercadopago_payment_id text,
  p_mercadopago_status text,
  p_transaction_amount numeric,
  p_currency text,
  p_updated_at timestamptz
)
returns table (
  order_id bigint,
  status text,
  shipping_queued boolean
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  target_order public.orders%rowtype;
  queued_count integer := 0;
begin
  if p_external_reference is null or btrim(p_external_reference) = ''
     or p_mercadopago_payment_id is null or btrim(p_mercadopago_payment_id) = ''
     or p_mercadopago_status is distinct from 'approved'
     or p_transaction_amount is null
     or p_currency is null
     or p_updated_at is null then
    return;
  end if;

  select candidate.* into target_order
  from public.orders as candidate
  where candidate.external_reference = p_external_reference
  for update;

  if not found or target_order.status <> 'pending' then
    return;
  end if;

  if target_order.currency <> p_currency
     or round(target_order.amount, 2) <> round(p_transaction_amount, 2) then
    return;
  end if;

  update public.orders as paid_order
  set
    status = 'paid',
    mercadopago_payment_id = p_mercadopago_payment_id,
    mercadopago_status = p_mercadopago_status,
    updated_at = p_updated_at
  where paid_order.id = target_order.id
    and paid_order.status = 'pending';

  if not found then
    return;
  end if;

  -- Queue only an existing eligible snapshot. The exception block is a
  -- subtransaction: a logistics failure rolls back this update, not payment.
  begin
    update public.order_shipping_imports
    set
      state = 'queued',
      updated_at = p_updated_at
    where order_shipping_imports.order_id = target_order.id
      and order_shipping_imports.state = 'not_requested';

    get diagnostics queued_count = row_count;
  exception when others then
    queued_count := 0;
  end;

  return query
  select target_order.id, 'paid'::text, queued_count = 1;
end;
$function$;

comment on function public.mark_order_paid_and_queue_shipping_import_v2(
  text, text, text, numeric, text, timestamptz
) is
  'Legacy-safe pending-to-paid transition. Queues an existing not_requested shipping snapshot when possible without making logistics authoritative over payment.';

revoke all privileges on function public.mark_order_paid_and_queue_shipping_import_v2(
  text, text, text, numeric, text, timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.mark_order_paid_and_queue_shipping_import_v2(
  text, text, text, numeric, text, timestamptz
) to service_role;

commit;
