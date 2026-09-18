-- T-022.2: durable infrastructure for a future MiCorreo shipping import worker.
-- Review and apply manually only during an explicitly authorized cutover.
-- This migration does not call MiCorreo, backfill historical orders, or start a worker.

begin;

create table public.order_shipping_imports (
  order_id bigint primary key
    references public.orders(id) on delete cascade,
  ext_order_id text not null unique,
  state text not null default 'not_requested'
    constraint order_shipping_imports_state_check
      check (state in (
        'not_requested', 'queued', 'processing', 'created',
        'retryable', 'unknown', 'failed'
      )),
  weight_grams integer not null,
  height_cm integer not null,
  width_cm integer not null,
  length_cm integer not null,
  declared_value numeric(12,2) not null,
  attempt_count integer not null default 0,
  lease_token uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz,
  provider_created_at timestamptz,
  imported_at timestamptz,
  last_error_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_shipping_imports_ext_order_id_check
    check (btrim(ext_order_id) <> ''),
  constraint order_shipping_imports_package_check
    check (
      weight_grams between 1 and 25000
      and height_cm between 1 and 150
      and width_cm between 1 and 150
      and length_cm between 1 and 150
      and declared_value >= 0
      and round(declared_value, 2) = declared_value
    ),
  constraint order_shipping_imports_attempt_count_check
    check (attempt_count >= 0),
  constraint order_shipping_imports_state_coherence_check
    check (
      case state
        when 'not_requested' then
          lease_token is null
          and lease_expires_at is null
          and next_attempt_at is null
          and provider_created_at is null
          and imported_at is null
          and last_error_type is null
        when 'queued' then
          lease_token is null
          and lease_expires_at is null
          and next_attempt_at is null
          and provider_created_at is null
          and imported_at is null
          and last_error_type is null
        when 'processing' then
          lease_token is not null
          and lease_expires_at is not null
          and next_attempt_at is null
          and provider_created_at is null
          and imported_at is null
          and last_error_type is null
        when 'created' then
          lease_token is null
          and lease_expires_at is null
          and next_attempt_at is null
          and imported_at is not null
          and last_error_type is null
        when 'retryable' then
          lease_token is null
          and lease_expires_at is null
          and next_attempt_at is not null
          and provider_created_at is null
          and imported_at is null
          and last_error_type is not null
          and btrim(last_error_type) <> ''
        when 'unknown' then
          lease_token is null
          and lease_expires_at is null
          and next_attempt_at is null
          and provider_created_at is null
          and imported_at is null
          and last_error_type is not null
          and btrim(last_error_type) <> ''
        when 'failed' then
          lease_token is null
          and lease_expires_at is null
          and next_attempt_at is null
          and provider_created_at is null
          and imported_at is null
          and last_error_type is not null
          and btrim(last_error_type) <> ''
        else false
      end
    )
);

comment on table public.order_shipping_imports is
  'One durable, non-authoritative shipping-import job per order. No historical backfill.';
comment on column public.order_shipping_imports.ext_order_id is
  'Immutable provider correlation key copied from orders.external_reference.';
comment on column public.order_shipping_imports.declared_value is
  'Product subtotal captured at checkout; shipping is deliberately excluded.';
comment on column public.order_shipping_imports.weight_grams is
  'Checkout package snapshot. Current values remain TEMPORARY/QA until replaced.';

create index order_shipping_imports_claim_idx
  on public.order_shipping_imports (state, next_attempt_at, created_at)
  where state in ('queued', 'retryable');

create index order_shipping_imports_expired_lease_idx
  on public.order_shipping_imports (lease_expires_at)
  where state = 'processing';

alter table public.order_shipping_imports enable row level security;

revoke all privileges
on table public.order_shipping_imports
from public, anon, authenticated, service_role;

grant select, insert
on table public.order_shipping_imports
to service_role;

grant update (
  state,
  attempt_count,
  lease_token,
  lease_expires_at,
  next_attempt_at,
  provider_created_at,
  imported_at,
  last_error_type,
  updated_at
)
on table public.order_shipping_imports
to service_role;

-- Keep both existing order-creation contracts intact. The v3 wrapper adds the
-- physical snapshot after v2 has created order, items and checkout_attempt.
-- A failure in either function rolls the entire PostgreSQL transaction back.
create function public.create_pending_order_with_items_v3(
  p_checkout_attempt_id uuid,
  p_expected_amount numeric,
  p_products_subtotal numeric,
  p_shipping_amount numeric,
  p_shipping_provider text,
  p_shipping_option_id text,
  p_shipping_delivery_type text,
  p_shipping_service text,
  p_shipping_agency_code text,
  p_shipping_agency_name text,
  p_shipping_agency_street_name text,
  p_shipping_agency_street_number text,
  p_shipping_agency_locality text,
  p_shipping_agency_postal_code text,
  p_currency text,
  p_customer_first_name text,
  p_customer_last_name text,
  p_customer_email text,
  p_customer_phone text,
  p_shipping_province text,
  p_shipping_locality text,
  p_shipping_postal_code text,
  p_shipping_street text,
  p_shipping_street_number text,
  p_shipping_apartment text,
  p_shipping_notes text,
  p_items jsonb,
  p_package_weight_grams integer,
  p_package_height_cm integer,
  p_package_width_cm integer,
  p_package_length_cm integer
)
returns table (
  order_id bigint,
  external_reference text,
  amount numeric,
  currency text,
  status text
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  created_order record;
begin
  if p_package_weight_grams not between 1 and 25000
     or p_package_height_cm not between 1 and 150
     or p_package_width_cm not between 1 and 150
     or p_package_length_cm not between 1 and 150 then
    raise exception using errcode = '22023', message = 'invalid package snapshot';
  end if;

  select *
  into strict created_order
  from public.create_pending_order_with_items_v2(
    p_checkout_attempt_id,
    p_expected_amount,
    p_products_subtotal,
    p_shipping_amount,
    p_shipping_provider,
    p_shipping_option_id,
    p_shipping_delivery_type,
    p_shipping_service,
    p_shipping_agency_code,
    p_shipping_agency_name,
    p_shipping_agency_street_name,
    p_shipping_agency_street_number,
    p_shipping_agency_locality,
    p_shipping_agency_postal_code,
    p_currency,
    p_customer_first_name,
    p_customer_last_name,
    p_customer_email,
    p_customer_phone,
    p_shipping_province,
    p_shipping_locality,
    p_shipping_postal_code,
    p_shipping_street,
    p_shipping_street_number,
    p_shipping_apartment,
    p_shipping_notes,
    p_items
  );

  insert into public.order_shipping_imports (
    order_id,
    ext_order_id,
    state,
    weight_grams,
    height_cm,
    width_cm,
    length_cm,
    declared_value
  )
  values (
    created_order.order_id,
    created_order.external_reference,
    'not_requested',
    p_package_weight_grams,
    p_package_height_cm,
    p_package_width_cm,
    p_package_length_cm,
    p_products_subtotal
  );

  return query
  select
    created_order.order_id,
    created_order.external_reference,
    created_order.amount,
    created_order.currency,
    created_order.status;
end;
$function$;

comment on function public.create_pending_order_with_items_v3(
  uuid, numeric, numeric, numeric, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, jsonb, integer, integer, integer, integer
) is
  'Atomically creates v2 checkout data plus one immutable physical shipping-import snapshot. Backend only.';

revoke all privileges on function public.create_pending_order_with_items_v3(
  uuid, numeric, numeric, numeric, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, jsonb, integer, integer, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.create_pending_order_with_items_v3(
  uuid, numeric, numeric, numeric, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, jsonb, integer, integer, integer, integer
) to service_role;

-- Prepared for T-022.5. It is intentionally not called by the current webhook.
create function public.mark_order_paid_and_queue_shipping_import(
  p_external_reference text,
  p_mercadopago_payment_id text,
  p_mercadopago_status text,
  p_transaction_amount numeric,
  p_currency text,
  p_updated_at timestamptz
)
returns setof public.orders
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  target_order public.orders%rowtype;
  updated_order public.orders%rowtype;
  locked_import_order_id bigint;
  queued_count integer;
begin
  if p_external_reference is null or btrim(p_external_reference) = ''
     or p_mercadopago_payment_id is null or btrim(p_mercadopago_payment_id) = ''
     or p_mercadopago_status is distinct from 'approved'
     or p_transaction_amount is null
     or p_currency is null
     or p_updated_at is null then
    return;
  end if;

  select * into target_order
  from public.orders
  where external_reference = p_external_reference
  for update;

  if not found
     or target_order.status <> 'pending'
     or target_order.currency <> p_currency
     or round(target_order.amount, 2) <> round(p_transaction_amount, 2) then
    return;
  end if;

  select order_id into locked_import_order_id
  from public.order_shipping_imports
  where order_id = target_order.id
    and state = 'not_requested'
  for update;

  if not found then
    raise exception using errcode = 'P0001',
      message = 'shipping import snapshot missing or not eligible';
  end if;

  update public.orders
  set
    status = 'paid',
    mercadopago_payment_id = p_mercadopago_payment_id,
    mercadopago_status = p_mercadopago_status,
    updated_at = p_updated_at
  where id = target_order.id
    and status = 'pending'
  returning * into updated_order;

  if not found then
    return;
  end if;

  update public.order_shipping_imports
  set
    state = 'queued',
    updated_at = p_updated_at
  where order_id = locked_import_order_id
    and state = 'not_requested';

  get diagnostics queued_count = row_count;
  if queued_count <> 1 then
    raise exception using errcode = 'P0001', message = 'shipping import queue failed';
  end if;

  return next updated_order;
end;
$function$;

comment on function public.mark_order_paid_and_queue_shipping_import(
  text, text, text, numeric, text, timestamptz
) is
  'Prepared atomic pending-to-paid and not_requested-to-queued transition. Not wired into runtime yet.';

revoke all privileges on function public.mark_order_paid_and_queue_shipping_import(
  text, text, text, numeric, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.mark_order_paid_and_queue_shipping_import(
  text, text, text, numeric, text, timestamptz
) to service_role;

create function public.claim_order_shipping_import(
  p_lease_token uuid,
  p_lease_expires_at timestamptz
)
returns table (
  order_id bigint,
  ext_order_id text,
  state text,
  attempt_count integer,
  lease_token uuid,
  lease_expires_at timestamptz,
  weight_grams integer,
  height_cm integer,
  width_cm integer,
  length_cm integer,
  declared_value numeric,
  customer_first_name text,
  customer_last_name text,
  customer_email text,
  customer_phone text,
  shipping_country_code text,
  shipping_province text,
  shipping_locality text,
  shipping_postal_code text,
  shipping_street text,
  shipping_street_number text,
  shipping_apartment text,
  shipping_notes text,
  shipping_delivery_type text,
  shipping_service text,
  shipping_agency_code text
)
language sql
security invoker
set search_path = pg_catalog, public
as $function$
  with candidate as (
    select shipping_import.order_id
    from public.order_shipping_imports as shipping_import
    join public.orders as candidate_order
      on candidate_order.id = shipping_import.order_id
    where p_lease_token is not null
      and p_lease_expires_at > now()
      and candidate_order.status = 'paid'
      and (
        shipping_import.state = 'queued'
        or (
          shipping_import.state = 'retryable'
          and shipping_import.next_attempt_at <= now()
        )
      )
    order by shipping_import.created_at, shipping_import.order_id
    for update of shipping_import skip locked
    limit 1
  ), claimed as (
    update public.order_shipping_imports as shipping_import
    set
      state = 'processing',
      attempt_count = shipping_import.attempt_count + 1,
      lease_token = p_lease_token,
      lease_expires_at = p_lease_expires_at,
      next_attempt_at = null,
      last_error_type = null,
      updated_at = now()
    from candidate
    where shipping_import.order_id = candidate.order_id
    returning shipping_import.*
  )
  select
    claimed.order_id,
    claimed.ext_order_id,
    claimed.state,
    claimed.attempt_count,
    claimed.lease_token,
    claimed.lease_expires_at,
    claimed.weight_grams,
    claimed.height_cm,
    claimed.width_cm,
    claimed.length_cm,
    claimed.declared_value,
    claimed_order.customer_first_name,
    claimed_order.customer_last_name,
    claimed_order.customer_email,
    claimed_order.customer_phone,
    claimed_order.shipping_country_code,
    claimed_order.shipping_province,
    claimed_order.shipping_locality,
    claimed_order.shipping_postal_code,
    claimed_order.shipping_street,
    claimed_order.shipping_street_number,
    claimed_order.shipping_apartment,
    claimed_order.shipping_notes,
    claimed_order.shipping_delivery_type,
    claimed_order.shipping_service,
    claimed_order.shipping_agency_code
  from claimed
  join public.orders as claimed_order on claimed_order.id = claimed.order_id;
$function$;

comment on function public.claim_order_shipping_import(uuid, timestamptz) is
  'Claims one due paid-order import with SKIP LOCKED. Never retries unknown work. Backend only.';

revoke all privileges on function public.claim_order_shipping_import(uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_order_shipping_import(uuid, timestamptz)
  to service_role;

create function public.complete_order_shipping_import(
  p_order_id bigint,
  p_lease_token uuid,
  p_provider_created_at timestamptz default null,
  p_imported_at timestamptz default now()
)
returns setof public.order_shipping_imports
language sql
security invoker
set search_path = pg_catalog, public
as $function$
  update public.order_shipping_imports as shipping_import
  set
    state = 'created',
    lease_token = null,
    lease_expires_at = null,
    provider_created_at = p_provider_created_at,
    imported_at = p_imported_at,
    last_error_type = null,
    updated_at = now()
  where shipping_import.order_id = p_order_id
    and shipping_import.state = 'processing'
    and shipping_import.lease_token = p_lease_token
    and shipping_import.lease_expires_at > now()
    and p_imported_at is not null
  returning shipping_import.*;
$function$;

create function public.retry_order_shipping_import(
  p_order_id bigint,
  p_lease_token uuid,
  p_next_attempt_at timestamptz,
  p_error_type text
)
returns setof public.order_shipping_imports
language sql
security invoker
set search_path = pg_catalog, public
as $function$
  update public.order_shipping_imports as shipping_import
  set
    state = 'retryable',
    lease_token = null,
    lease_expires_at = null,
    next_attempt_at = p_next_attempt_at,
    last_error_type = btrim(p_error_type),
    updated_at = now()
  where shipping_import.order_id = p_order_id
    and shipping_import.state = 'processing'
    and shipping_import.lease_token = p_lease_token
    and shipping_import.lease_expires_at > now()
    and p_next_attempt_at > now()
    and p_error_type is not null
    and btrim(p_error_type) <> ''
  returning shipping_import.*;
$function$;

create function public.mark_order_shipping_import_unknown(
  p_order_id bigint,
  p_lease_token uuid,
  p_error_type text
)
returns setof public.order_shipping_imports
language sql
security invoker
set search_path = pg_catalog, public
as $function$
  update public.order_shipping_imports as shipping_import
  set
    state = 'unknown',
    lease_token = null,
    lease_expires_at = null,
    next_attempt_at = null,
    last_error_type = btrim(p_error_type),
    updated_at = now()
  where shipping_import.order_id = p_order_id
    and shipping_import.state = 'processing'
    and shipping_import.lease_token = p_lease_token
    and shipping_import.lease_expires_at > now()
    and p_error_type is not null
    and btrim(p_error_type) <> ''
  returning shipping_import.*;
$function$;

create function public.fail_order_shipping_import(
  p_order_id bigint,
  p_lease_token uuid,
  p_error_type text
)
returns setof public.order_shipping_imports
language sql
security invoker
set search_path = pg_catalog, public
as $function$
  update public.order_shipping_imports as shipping_import
  set
    state = 'failed',
    lease_token = null,
    lease_expires_at = null,
    next_attempt_at = null,
    last_error_type = btrim(p_error_type),
    updated_at = now()
  where shipping_import.order_id = p_order_id
    and shipping_import.state = 'processing'
    and shipping_import.lease_token = p_lease_token
    and shipping_import.lease_expires_at > now()
    and p_error_type is not null
    and btrim(p_error_type) <> ''
  returning shipping_import.*;
$function$;

create function public.expire_order_shipping_import_leases()
returns setof public.order_shipping_imports
language sql
security invoker
set search_path = pg_catalog, public
as $function$
  update public.order_shipping_imports as shipping_import
  set
    state = 'unknown',
    lease_token = null,
    lease_expires_at = null,
    next_attempt_at = null,
    last_error_type = 'lease_expired',
    updated_at = now()
  where shipping_import.state = 'processing'
    and shipping_import.lease_expires_at <= now()
  returning shipping_import.*;
$function$;

revoke all privileges on function public.complete_order_shipping_import(
  bigint, uuid, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.complete_order_shipping_import(
  bigint, uuid, timestamptz, timestamptz
) to service_role;

revoke all privileges on function public.retry_order_shipping_import(
  bigint, uuid, timestamptz, text
) from public, anon, authenticated, service_role;
grant execute on function public.retry_order_shipping_import(
  bigint, uuid, timestamptz, text
) to service_role;

revoke all privileges on function public.mark_order_shipping_import_unknown(
  bigint, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.mark_order_shipping_import_unknown(
  bigint, uuid, text
) to service_role;

revoke all privileges on function public.fail_order_shipping_import(
  bigint, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.fail_order_shipping_import(
  bigint, uuid, text
) to service_role;

revoke all privileges on function public.expire_order_shipping_import_leases()
  from public, anon, authenticated, service_role;
grant execute on function public.expire_order_shipping_import_leases()
  to service_role;

notify pgrst, 'reload schema';

commit;
