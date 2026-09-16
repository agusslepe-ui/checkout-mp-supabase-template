-- T-017.1: durable checkout idempotency infrastructure.
-- Review and apply manually only during the coordinated T-017.2 cutover.

begin;

create table public.checkout_attempts (
  id bigint generated always as identity primary key,
  checkout_attempt_id uuid not null unique,
  order_id bigint not null unique
    references public.orders(id) on delete cascade,
  state text not null default 'reserved'
    constraint checkout_attempts_state_check
      check (state in ('reserved', 'creating_preference', 'ready', 'unknown')),
  mercadopago_preference_id text,
  checkout_url text,
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checkout_attempts_state_coherence_check
    check (
      (mercadopago_preference_id is null) = (checkout_url is null)
      and case state
        when 'reserved' then
          mercadopago_preference_id is null
          and lease_token is null
          and lease_expires_at is null
        when 'creating_preference' then
          mercadopago_preference_id is null
          and lease_token is not null
          and lease_expires_at is not null
        when 'ready' then
          mercadopago_preference_id is not null
          and btrim(mercadopago_preference_id) <> ''
          and checkout_url is not null
          and btrim(checkout_url) <> ''
          and lease_token is null
          and lease_expires_at is null
        when 'unknown' then
          lease_token is null
          and lease_expires_at is null
        else false
      end
    )
);

create unique index checkout_attempts_mercadopago_preference_id_uidx
  on public.checkout_attempts (mercadopago_preference_id)
  where mercadopago_preference_id is not null;

create index checkout_attempts_state_idx
  on public.checkout_attempts (state);

create index checkout_attempts_lease_expires_at_idx
  on public.checkout_attempts (lease_expires_at)
  where lease_expires_at is not null;

alter table public.checkout_attempts enable row level security;

revoke all on table public.checkout_attempts from public, anon, authenticated;
grant select, insert on table public.checkout_attempts to service_role;
grant update (
  state,
  mercadopago_preference_id,
  checkout_url,
  lease_token,
  lease_expires_at,
  updated_at
) on table public.checkout_attempts to service_role;

revoke all on sequence public.checkout_attempts_id_seq from public, anon, authenticated;
grant usage on sequence public.checkout_attempts_id_seq to service_role;

-- Remove only the 26-parameter T-021 signature. Keeping it would create an
-- ambiguous and unsafe PostgREST overload after the new function is created.
drop function public.create_pending_order_with_items(
  numeric, numeric, numeric, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, jsonb
);

create function public.create_pending_order_with_items(
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
  p_items jsonb
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
  created_order public.orders%rowtype;
  raw_item jsonb;
  first_item jsonb;
  calculated_products_subtotal numeric;
  calculated_amount numeric;
  generated_external_reference text;
  quantity_numeric numeric;
  unit_price_numeric numeric;
begin
  if p_checkout_attempt_id is null then
    raise exception using errcode = '22023', message = 'invalid checkout attempt id';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception using errcode = '22023', message = 'invalid items';
  end if;

  if p_currency is null or btrim(p_currency) <> 'ARS' then
    raise exception using errcode = '22023', message = 'invalid currency';
  end if;

  if p_products_subtotal is null
     or p_products_subtotal <= 0
     or round(p_products_subtotal, 2) <> p_products_subtotal
     or p_products_subtotal > 9999999999.99
     or p_shipping_amount is null
     or p_shipping_amount < 0
     or round(p_shipping_amount, 2) <> p_shipping_amount
     or p_shipping_amount > 9999999999.99
     or p_expected_amount is null
     or p_expected_amount <= 0
     or round(p_expected_amount, 2) <> p_expected_amount
     or p_expected_amount > 9999999999.99
     or p_products_subtotal + p_shipping_amount <> p_expected_amount then
    raise exception using errcode = '22023', message = 'invalid order amounts';
  end if;

  if p_shipping_provider is distinct from 'micorreo'
     or p_shipping_delivery_type is null
     or p_shipping_delivery_type not in ('home', 'agency')
     or p_shipping_service is null
     or p_shipping_service not in ('classic', 'express')
     or p_shipping_option_id is null
     or p_shipping_option_id not in (
       'micorreo:home:classic',
       'micorreo:home:express',
       'micorreo:agency:classic',
       'micorreo:agency:express'
     )
     or p_shipping_option_id is distinct from
       'micorreo:' || p_shipping_delivery_type || ':' || p_shipping_service then
    raise exception using errcode = '22023', message = 'invalid shipping snapshot';
  end if;

  if (p_shipping_delivery_type = 'home' and num_nonnulls(
        p_shipping_agency_code,
        p_shipping_agency_name,
        p_shipping_agency_street_name,
        p_shipping_agency_street_number,
        p_shipping_agency_locality,
        p_shipping_agency_postal_code
      ) <> 0)
     or
     (p_shipping_delivery_type = 'agency' and (
       num_nonnulls(
         p_shipping_agency_code,
         p_shipping_agency_name,
         p_shipping_agency_street_name,
         p_shipping_agency_street_number,
         p_shipping_agency_locality,
         p_shipping_agency_postal_code
       ) <> 6
       or btrim(p_shipping_agency_code) = ''
       or btrim(p_shipping_agency_name) = ''
       or btrim(p_shipping_agency_street_name) = ''
       or btrim(p_shipping_agency_street_number) = ''
       or btrim(p_shipping_agency_locality) = ''
       or btrim(p_shipping_agency_postal_code) = ''
     )) then
    raise exception using errcode = '22023', message = 'invalid agency snapshot';
  end if;

  if p_customer_first_name is null
     or char_length(btrim(p_customer_first_name)) not between 2 and 60
     or btrim(p_customer_first_name) !~ '^[[:alpha:]][[:alpha:] ''-]*$'
     or p_customer_last_name is null
     or char_length(btrim(p_customer_last_name)) not between 2 and 60
     or btrim(p_customer_last_name) !~ '^[[:alpha:]][[:alpha:] ''-]*$'
     or p_customer_email is null
     or char_length(btrim(p_customer_email)) not between 5 and 254
     or btrim(p_customer_email) !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
     or p_customer_phone is null
     or p_customer_phone !~ '^[0-9]{10,15}$' then
    raise exception using errcode = '22023', message = 'invalid customer data';
  end if;

  if p_shipping_province is null
     or upper(btrim(p_shipping_province)) not in (
       'AR-A', 'AR-B', 'AR-C', 'AR-D', 'AR-E', 'AR-F',
       'AR-G', 'AR-H', 'AR-J', 'AR-K', 'AR-L', 'AR-M',
       'AR-N', 'AR-P', 'AR-Q', 'AR-R', 'AR-S', 'AR-T',
       'AR-U', 'AR-V', 'AR-W', 'AR-X', 'AR-Y', 'AR-Z'
     )
     or p_shipping_locality is null
     or char_length(btrim(p_shipping_locality)) not between 2 and 80
     or p_shipping_postal_code is null
     or upper(btrim(p_shipping_postal_code)) !~ '^([0-9]{4}|[A-Z][0-9]{4}[A-Z]{3})$'
     or p_shipping_street is null
     or char_length(btrim(p_shipping_street)) not between 2 and 100
     or p_shipping_street_number is null
     or char_length(btrim(p_shipping_street_number)) not between 1 and 12
     or (p_shipping_apartment is not null and char_length(btrim(p_shipping_apartment)) > 30)
     or (p_shipping_notes is not null and char_length(btrim(p_shipping_notes)) > 250) then
    raise exception using errcode = '22023', message = 'invalid delivery data';
  end if;

  for raw_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(raw_item) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(raw_item) as item_key
         where item_key not in (
           'product_sku', 'product_name', 'product_size', 'quantity', 'unit_price'
         )
       )
       or not (raw_item ?& array[
         'product_sku', 'product_name', 'quantity', 'unit_price'
       ])
       or jsonb_typeof(raw_item->'product_sku') <> 'string'
       or jsonb_typeof(raw_item->'product_name') <> 'string'
       or jsonb_typeof(raw_item->'quantity') <> 'number'
       or jsonb_typeof(raw_item->'unit_price') <> 'number'
       or (raw_item ? 'product_size'
         and jsonb_typeof(raw_item->'product_size') not in ('string', 'null')) then
      raise exception using errcode = '22023', message = 'invalid item shape';
    end if;

    if char_length(btrim(raw_item->>'product_sku')) not between 2 and 64
       or btrim(raw_item->>'product_sku') !~ '^[A-Z0-9][A-Z0-9-]*$'
       or char_length(btrim(raw_item->>'product_name')) not between 1 and 120
       or (raw_item ? 'product_size'
         and jsonb_typeof(raw_item->'product_size') = 'string'
         and char_length(btrim(raw_item->>'product_size')) not between 1 and 20) then
      raise exception using errcode = '22023', message = 'invalid item data';
    end if;

    quantity_numeric := (raw_item->>'quantity')::numeric;
    unit_price_numeric := (raw_item->>'unit_price')::numeric;
    if quantity_numeric <> trunc(quantity_numeric)
       or quantity_numeric <= 0
       or quantity_numeric > 2147483647
       or unit_price_numeric <= 0
       or round(unit_price_numeric, 2) <> unit_price_numeric
       or unit_price_numeric > 9999999999.99 then
      raise exception using errcode = '22023', message = 'invalid item amounts';
    end if;
  end loop;

  select sum(typed_item.quantity::numeric * typed_item.unit_price)
  into calculated_products_subtotal
  from jsonb_to_recordset(p_items) as typed_item (
    product_sku text,
    product_name text,
    product_size text,
    quantity integer,
    unit_price numeric
  );

  calculated_amount := calculated_products_subtotal + p_shipping_amount;
  if calculated_products_subtotal is null
     or calculated_products_subtotal <= 0
     or calculated_products_subtotal > 9999999999.99
     or calculated_products_subtotal <> p_products_subtotal
     or calculated_amount <> p_expected_amount then
    raise exception using errcode = '22023', message = 'order amount does not match items and shipping';
  end if;

  first_item := p_items->0;
  generated_external_reference := 'LEMONT-ORDER-' || gen_random_uuid()::text;

  insert into public.orders (
    external_reference,
    product_name,
    product_sku,
    product_size,
    quantity,
    products_subtotal,
    shipping_amount,
    shipping_provider,
    shipping_option_id,
    shipping_delivery_type,
    shipping_service,
    shipping_agency_code,
    shipping_agency_name,
    shipping_agency_street_name,
    shipping_agency_street_number,
    shipping_agency_locality,
    shipping_agency_postal_code,
    amount,
    currency,
    status,
    customer_first_name,
    customer_last_name,
    customer_email,
    customer_phone,
    shipping_country_code,
    shipping_province,
    shipping_locality,
    shipping_postal_code,
    shipping_street,
    shipping_street_number,
    shipping_apartment,
    shipping_notes
  )
  values (
    generated_external_reference,
    btrim(first_item->>'product_name'),
    btrim(first_item->>'product_sku'),
    case when jsonb_typeof(first_item->'product_size') = 'string'
      then btrim(first_item->>'product_size') else null end,
    (first_item->>'quantity')::integer,
    calculated_products_subtotal,
    p_shipping_amount,
    'micorreo',
    p_shipping_option_id,
    p_shipping_delivery_type,
    p_shipping_service,
    nullif(btrim(p_shipping_agency_code), ''),
    nullif(btrim(p_shipping_agency_name), ''),
    nullif(btrim(p_shipping_agency_street_name), ''),
    nullif(btrim(p_shipping_agency_street_number), ''),
    nullif(btrim(p_shipping_agency_locality), ''),
    nullif(btrim(p_shipping_agency_postal_code), ''),
    calculated_amount,
    'ARS',
    'pending',
    btrim(p_customer_first_name),
    btrim(p_customer_last_name),
    lower(btrim(p_customer_email)),
    p_customer_phone,
    'AR',
    upper(btrim(p_shipping_province)),
    btrim(p_shipping_locality),
    upper(btrim(p_shipping_postal_code)),
    btrim(p_shipping_street),
    btrim(p_shipping_street_number),
    nullif(btrim(p_shipping_apartment), ''),
    nullif(btrim(p_shipping_notes), '')
  )
  returning * into created_order;

  insert into public.order_items (
    order_id, product_sku, product_name, product_size, quantity, unit_price
  )
  select
    created_order.id,
    btrim(typed_item.product_sku),
    btrim(typed_item.product_name),
    nullif(btrim(typed_item.product_size), ''),
    typed_item.quantity,
    typed_item.unit_price
  from jsonb_to_recordset(p_items) as typed_item (
    product_sku text,
    product_name text,
    product_size text,
    quantity integer,
    unit_price numeric
  );

  insert into public.checkout_attempts (
    checkout_attempt_id,
    order_id,
    state
  )
  values (
    p_checkout_attempt_id,
    created_order.id,
    'reserved'
  );

  return query
  select
    created_order.id,
    created_order.external_reference,
    created_order.amount,
    created_order.currency,
    created_order.status;
end;
$function$;

comment on function public.create_pending_order_with_items(
  uuid, numeric, numeric, numeric, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, jsonb
) is
  'Atomically reserves a durable checkout attempt and creates one pending order with validated items and shipping snapshot. Backend only.';

revoke execute on function public.create_pending_order_with_items(
  uuid, numeric, numeric, numeric, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.create_pending_order_with_items(
  uuid, numeric, numeric, numeric, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, jsonb
) to service_role;

create function public.claim_checkout_attempt(
  p_checkout_attempt_id uuid,
  p_lease_token uuid,
  p_lease_expires_at timestamptz
)
returns setof public.checkout_attempts
language sql
security invoker
set search_path = pg_catalog, public
as $function$
  update public.checkout_attempts as attempt
  set
    state = 'creating_preference',
    mercadopago_preference_id = null,
    checkout_url = null,
    lease_token = p_lease_token,
    lease_expires_at = p_lease_expires_at,
    updated_at = now()
  where attempt.checkout_attempt_id = p_checkout_attempt_id
    and p_checkout_attempt_id is not null
    and p_lease_token is not null
    and p_lease_expires_at > now()
    and (
      attempt.state in ('reserved', 'unknown')
      or (
        attempt.state = 'creating_preference'
        and attempt.lease_expires_at <= now()
      )
    )
  returning attempt.*;
$function$;

comment on function public.claim_checkout_attempt(uuid, uuid, timestamptz) is
  'Atomically claims an eligible checkout attempt for preference creation or recovery. Backend only.';

revoke execute on function public.claim_checkout_attempt(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_checkout_attempt(uuid, uuid, timestamptz)
  to service_role;

notify pgrst, 'reload schema';

commit;
