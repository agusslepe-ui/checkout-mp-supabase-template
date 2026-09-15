-- Migration: add the authoritative shipping snapshot and total to orders.
-- Review and apply manually only after explicit authorization.
-- Historical orders remain unchanged: all six new columns stay null.

begin;

alter table public.orders
  add column products_subtotal numeric(12, 2),
  add column shipping_amount numeric(12, 2),
  add column shipping_provider text,
  add column shipping_option_id text,
  add column shipping_delivery_type text,
  add column shipping_service text,

  add constraint orders_products_subtotal_positive
    check (products_subtotal is null or products_subtotal > 0),

  add constraint orders_shipping_amount_nonnegative
    check (shipping_amount is null or shipping_amount >= 0),

  add constraint orders_shipping_provider_check
    check (shipping_provider is null or shipping_provider = 'micorreo'),

  add constraint orders_shipping_option_id_check
    check (
      shipping_option_id is null
      or shipping_option_id in (
        'micorreo:home:classic',
        'micorreo:home:express'
      )
    ),

  add constraint orders_shipping_delivery_type_check
    check (shipping_delivery_type is null or shipping_delivery_type = 'home'),

  add constraint orders_shipping_service_check
    check (shipping_service is null or shipping_service in ('classic', 'express')),

  add constraint orders_shipping_snapshot_cohesion_check
    check (
      num_nonnulls(
        products_subtotal,
        shipping_amount,
        shipping_provider,
        shipping_option_id,
        shipping_delivery_type,
        shipping_service
      ) in (0, 6)
    ),

  add constraint orders_shipping_option_coherence_check
    check (
      shipping_option_id is null
      or shipping_option_id =
        'micorreo:' || shipping_delivery_type || ':' || shipping_service
    ),

  add constraint orders_shipping_total_check
    check (
      products_subtotal is null
      or amount = products_subtotal + shipping_amount
    );

comment on column public.orders.products_subtotal is
  'Authoritative product subtotal. Equals the sum of order_items.line_total for shipping-aware orders.';
comment on column public.orders.shipping_amount is
  'Authoritative MiCorreo shipping amount captured when checkout is created.';
comment on column public.orders.shipping_provider is
  'Carrier provider snapshot. T-020 allows only micorreo.';
comment on column public.orders.shipping_option_id is
  'Normalized payable shipping option selected by the customer and revalidated by the backend.';
comment on column public.orders.shipping_delivery_type is
  'Carrier delivery type snapshot. T-020 allows only home.';
comment on column public.orders.shipping_service is
  'Carrier service snapshot. T-020 allows classic or express.';
comment on column public.orders.shipping_province is
  'Customer delivery-address province; not a carrier service field.';
comment on column public.orders.shipping_postal_code is
  'Customer delivery-address postal code; not the carrier origin or a carrier service field.';
comment on column public.orders.amount is
  'Final charged total. For shipping-aware orders it equals products_subtotal plus shipping_amount.';

-- Remove the previous signature before creating the shipping-aware RPC so
-- PostgREST never sees an accidental overload.
drop function if exists public.create_pending_order_with_items(
  numeric,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
);

create function public.create_pending_order_with_items(
  p_expected_amount numeric,
  p_products_subtotal numeric,
  p_shipping_amount numeric,
  p_shipping_provider text,
  p_shipping_option_id text,
  p_shipping_delivery_type text,
  p_shipping_service text,
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
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'items must be a JSON array';
  end if;

  if jsonb_array_length(p_items) < 1 then
    raise exception using errcode = '22023', message = 'order requires at least one item';
  end if;

  if jsonb_array_length(p_items) > 50 then
    raise exception using errcode = '22023', message = 'order has too many items';
  end if;

  if p_currency is null or btrim(p_currency) <> 'ARS' then
    raise exception using errcode = '22023', message = 'invalid currency';
  end if;

  if p_products_subtotal is null
     or p_products_subtotal <= 0
     or round(p_products_subtotal, 2) <> p_products_subtotal
     or p_products_subtotal > 9999999999.99 then
    raise exception using errcode = '22023', message = 'invalid products subtotal';
  end if;

  if p_shipping_amount is null
     or p_shipping_amount < 0
     or round(p_shipping_amount, 2) <> p_shipping_amount
     or p_shipping_amount > 9999999999.99 then
    raise exception using errcode = '22023', message = 'invalid shipping amount';
  end if;

  if p_expected_amount is null
     or p_expected_amount <= 0
     or round(p_expected_amount, 2) <> p_expected_amount
     or p_expected_amount > 9999999999.99 then
    raise exception using errcode = '22023', message = 'invalid expected amount';
  end if;

  if p_shipping_provider is distinct from 'micorreo'
     or p_shipping_delivery_type is distinct from 'home'
     or p_shipping_service is null
     or p_shipping_service not in ('classic', 'express')
     or p_shipping_option_id is null
     or p_shipping_option_id not in (
       'micorreo:home:classic',
       'micorreo:home:express'
     )
     or p_shipping_option_id is distinct from
       'micorreo:' || p_shipping_delivery_type || ':' || p_shipping_service then
    raise exception using errcode = '22023', message = 'invalid shipping snapshot';
  end if;

  if p_products_subtotal + p_shipping_amount <> p_expected_amount then
    raise exception using errcode = '22023', message = 'invalid order total';
  end if;

  if p_customer_first_name is null
     or char_length(btrim(p_customer_first_name)) not between 2 and 60
     or btrim(p_customer_first_name) !~ '^[[:alpha:]][[:alpha:] ''-]*$' then
    raise exception using errcode = '22023', message = 'invalid customer data';
  end if;

  if p_customer_last_name is null
     or char_length(btrim(p_customer_last_name)) not between 2 and 60
     or btrim(p_customer_last_name) !~ '^[[:alpha:]][[:alpha:] ''-]*$' then
    raise exception using errcode = '22023', message = 'invalid customer data';
  end if;

  if p_customer_email is null
     or char_length(btrim(p_customer_email)) not between 5 and 254
     or btrim(p_customer_email) !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'invalid customer data';
  end if;

  if p_customer_phone is null or p_customer_phone !~ '^[0-9]{10,15}$' then
    raise exception using errcode = '22023', message = 'invalid customer data';
  end if;

  if p_shipping_province is null
     or upper(btrim(p_shipping_province)) not in (
       'AR-A', 'AR-B', 'AR-C', 'AR-D', 'AR-E', 'AR-F',
       'AR-G', 'AR-H', 'AR-J', 'AR-K', 'AR-L', 'AR-M',
       'AR-N', 'AR-P', 'AR-Q', 'AR-R', 'AR-S', 'AR-T',
       'AR-U', 'AR-V', 'AR-W', 'AR-X', 'AR-Y', 'AR-Z'
     ) then
    raise exception using errcode = '22023', message = 'invalid delivery data';
  end if;

  if p_shipping_locality is null
     or char_length(btrim(p_shipping_locality)) not between 2 and 80 then
    raise exception using errcode = '22023', message = 'invalid delivery data';
  end if;

  if p_shipping_postal_code is null
     or upper(btrim(p_shipping_postal_code))
        !~ '^([0-9]{4}|[A-Z][0-9]{4}[A-Z]{3})$' then
    raise exception using errcode = '22023', message = 'invalid delivery data';
  end if;

  if p_shipping_street is null
     or char_length(btrim(p_shipping_street)) not between 2 and 100 then
    raise exception using errcode = '22023', message = 'invalid delivery data';
  end if;

  if p_shipping_street_number is null
     or char_length(btrim(p_shipping_street_number)) not between 1 and 12 then
    raise exception using errcode = '22023', message = 'invalid delivery data';
  end if;

  if p_shipping_apartment is not null
     and char_length(btrim(p_shipping_apartment)) > 30 then
    raise exception using errcode = '22023', message = 'invalid delivery data';
  end if;

  if p_shipping_notes is not null
     and char_length(btrim(p_shipping_notes)) > 250 then
    raise exception using errcode = '22023', message = 'invalid delivery data';
  end if;

  for raw_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(raw_item) <> 'object' then
      raise exception using errcode = '22023', message = 'each item must be an object';
    end if;

    if exists (
      select 1
      from jsonb_object_keys(raw_item) as item_key
      where item_key not in (
        'product_sku', 'product_name', 'product_size', 'quantity', 'unit_price'
      )
    ) then
      raise exception using errcode = '22023', message = 'item contains unknown properties';
    end if;

    if not (raw_item ?& array[
      'product_sku', 'product_name', 'quantity', 'unit_price'
    ]) then
      raise exception using errcode = '22023', message = 'item is missing required properties';
    end if;

    if jsonb_typeof(raw_item->'product_sku') <> 'string'
       or jsonb_typeof(raw_item->'product_name') <> 'string'
       or jsonb_typeof(raw_item->'quantity') <> 'number'
       or jsonb_typeof(raw_item->'unit_price') <> 'number' then
      raise exception using errcode = '22023', message = 'item has invalid property types';
    end if;

    if raw_item ? 'product_size'
       and jsonb_typeof(raw_item->'product_size') not in ('string', 'null') then
      raise exception using errcode = '22023', message = 'item has invalid size type';
    end if;

    if char_length(btrim(raw_item->>'product_sku')) not between 2 and 64
       or btrim(raw_item->>'product_sku') !~ '^[A-Z0-9][A-Z0-9-]*$' then
      raise exception using errcode = '22023', message = 'invalid item SKU';
    end if;

    if char_length(btrim(raw_item->>'product_name')) not between 1 and 120 then
      raise exception using errcode = '22023', message = 'invalid item name';
    end if;

    if raw_item ? 'product_size'
       and jsonb_typeof(raw_item->'product_size') = 'string'
       and char_length(btrim(raw_item->>'product_size')) not between 1 and 20 then
      raise exception using errcode = '22023', message = 'invalid item size';
    end if;

    quantity_numeric := (raw_item->>'quantity')::numeric;
    if quantity_numeric <> trunc(quantity_numeric)
       or quantity_numeric <= 0
       or quantity_numeric > 2147483647 then
      raise exception using errcode = '22023', message = 'invalid item quantity';
    end if;

    unit_price_numeric := (raw_item->>'unit_price')::numeric;
    if unit_price_numeric <= 0
       or round(unit_price_numeric, 2) <> unit_price_numeric
       or unit_price_numeric > 9999999999.99 then
      raise exception using errcode = '22023', message = 'invalid item unit price';
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

  if calculated_products_subtotal is null
     or calculated_products_subtotal <= 0
     or calculated_products_subtotal > 9999999999.99 then
    raise exception using errcode = '22023', message = 'invalid calculated subtotal';
  end if;

  if calculated_products_subtotal <> p_products_subtotal then
    raise exception using errcode = '22023', message = 'products subtotal does not match items';
  end if;

  calculated_amount := calculated_products_subtotal + p_shipping_amount;
  if calculated_amount <> p_expected_amount then
    raise exception using errcode = '22023', message = 'order amount does not match subtotal and shipping';
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
    'home',
    p_shipping_service,
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
  numeric, numeric, numeric, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, jsonb
) is
  'Atomically creates one pending order, validated product items, and an authoritative MiCorreo home-delivery snapshot. Backend only.';

revoke execute on function public.create_pending_order_with_items(
  numeric, numeric, numeric, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.create_pending_order_with_items(
  numeric, numeric, numeric, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, jsonb
) to service_role;

notify pgrst, 'reload schema';

commit;
