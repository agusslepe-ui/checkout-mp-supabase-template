-- Migration: add product variant identity to existing orders.
-- Additive and nullable by design so historical rows remain untouched.
-- Apply manually only after explicit authorization.

alter table public.orders
  add column if not exists product_sku text,
  add column if not exists product_size text;

comment on column public.orders.product_sku is
  'Authoritative catalog SKU captured when a new order is created. Historical rows may be null.';

comment on column public.orders.product_size is
  'Product size captured from the authoritative catalog. Historical rows may be null.';
