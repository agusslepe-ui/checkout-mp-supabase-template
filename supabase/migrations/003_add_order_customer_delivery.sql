-- Migration: add customer and delivery snapshot to existing orders.
-- Additive and nullable so historical orders remain unchanged.
-- Apply manually only after explicit authorization.

alter table public.orders
  add column if not exists customer_first_name text,
  add column if not exists customer_last_name text,
  add column if not exists customer_email text,
  add column if not exists customer_phone text,
  add column if not exists shipping_country_code text,
  add column if not exists shipping_province text,
  add column if not exists shipping_locality text,
  add column if not exists shipping_postal_code text,
  add column if not exists shipping_street text,
  add column if not exists shipping_street_number text,
  add column if not exists shipping_apartment text,
  add column if not exists shipping_notes text;

comment on column public.orders.customer_first_name is
  'Customer first name captured for order fulfillment. Historical rows may be null.';
comment on column public.orders.customer_last_name is
  'Customer last name captured for order fulfillment. Historical rows may be null.';
comment on column public.orders.customer_email is
  'Customer email captured for order fulfillment. Historical rows may be null.';
comment on column public.orders.customer_phone is
  'Normalized customer phone captured for order fulfillment. Historical rows may be null.';
comment on column public.orders.shipping_country_code is
  'Delivery country code assigned by the backend. Historical rows may be null.';
comment on column public.orders.shipping_province is
  'Delivery province code. Historical rows may be null.';
comment on column public.orders.shipping_locality is
  'Delivery locality. Historical rows may be null.';
comment on column public.orders.shipping_postal_code is
  'Delivery postal code. Historical rows may be null.';
comment on column public.orders.shipping_street is
  'Delivery street. Historical rows may be null.';
comment on column public.orders.shipping_street_number is
  'Delivery street number. Historical rows may be null.';
comment on column public.orders.shipping_apartment is
  'Optional delivery floor or apartment. Historical rows may be null.';
comment on column public.orders.shipping_notes is
  'Optional delivery reference. Historical rows may be null.';
