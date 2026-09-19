-- T-022 / DEC-027: manual, auditable reconciliation for shipping imports
-- that remain unknown. Review and apply manually in a controlled cutover.
-- This migration does not call MiCorreo, start a worker, or reconcile any row.

begin;

create table public.order_shipping_import_reconciliations (
  reconciliation_id uuid primary key,
  order_id bigint not null
    references public.order_shipping_imports(order_id) on delete restrict,
  action text not null,
  reason_code text not null,
  previous_state text not null,
  target_state text not null,
  attempt_count integer not null,
  reconciled_at timestamptz not null,
  constraint order_shipping_import_reconciliations_action_check
    check (
      (action = 'mark_created'
        and reason_code = 'provider_found'
        and previous_state = 'unknown'
        and target_state = 'created')
      or
      (action = 'requeue'
        and reason_code = 'provider_absence_confirmed'
        and previous_state = 'unknown'
        and target_state = 'queued')
    ),
  constraint order_shipping_import_reconciliations_attempt_count_check
    check (attempt_count >= 0)
);

comment on table public.order_shipping_import_reconciliations is
  'Append-only, non-PII evidence of human reconciliation for unknown shipping imports.';
comment on column public.order_shipping_import_reconciliations.reconciled_at is
  'Local time at which a human-confirmed reconciliation was recorded.';

create index order_shipping_import_reconciliations_order_idx
  on public.order_shipping_import_reconciliations (order_id, reconciled_at);

alter table public.order_shipping_import_reconciliations enable row level security;

revoke all privileges
on table public.order_shipping_import_reconciliations
from public, anon, authenticated, service_role;

grant select, insert
on table public.order_shipping_import_reconciliations
to service_role;

create function public.reconcile_order_shipping_import_created(
  p_order_id bigint,
  p_reconciliation_id uuid,
  p_reconciled_at timestamptz
)
returns table (
  order_id bigint,
  state text,
  attempt_count integer
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  target_import public.order_shipping_imports%rowtype;
begin
  if p_order_id is null or p_order_id <= 0
     or p_reconciliation_id is null
     or p_reconciled_at is null then
    return;
  end if;

  select shipping_import.*
  into target_import
  from public.order_shipping_imports as shipping_import
  where shipping_import.order_id = p_order_id
    and shipping_import.state = 'unknown'
  for update;

  if not found then
    return;
  end if;

  update public.order_shipping_imports as shipping_import
  set
    state = 'created',
    lease_token = null,
    lease_expires_at = null,
    next_attempt_at = null,
    imported_at = p_reconciled_at,
    last_error_type = null,
    updated_at = p_reconciled_at
  where shipping_import.order_id = target_import.order_id
    and shipping_import.state = 'unknown'
  returning shipping_import.* into target_import;

  if not found then
    return;
  end if;

  insert into public.order_shipping_import_reconciliations (
    reconciliation_id,
    order_id,
    action,
    reason_code,
    previous_state,
    target_state,
    attempt_count,
    reconciled_at
  )
  values (
    p_reconciliation_id,
    target_import.order_id,
    'mark_created',
    'provider_found',
    'unknown',
    'created',
    target_import.attempt_count,
    p_reconciled_at
  );

  return query
  select target_import.order_id, target_import.state, target_import.attempt_count;
end;
$function$;

comment on function public.reconcile_order_shipping_import_created(bigint, uuid, timestamptz) is
  'Human-confirmed unknown-to-created transition. imported_at is local reconciliation time, not provider creation time.';

revoke all privileges on function public.reconcile_order_shipping_import_created(
  bigint, uuid, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.reconcile_order_shipping_import_created(
  bigint, uuid, timestamptz
) to service_role;

create function public.requeue_order_shipping_import_unknown(
  p_order_id bigint,
  p_reconciliation_id uuid,
  p_reconciled_at timestamptz
)
returns table (
  order_id bigint,
  state text,
  attempt_count integer
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  target_import public.order_shipping_imports%rowtype;
begin
  if p_order_id is null or p_order_id <= 0
     or p_reconciliation_id is null
     or p_reconciled_at is null then
    return;
  end if;

  select shipping_import.*
  into target_import
  from public.order_shipping_imports as shipping_import
  where shipping_import.order_id = p_order_id
    and shipping_import.state = 'unknown'
  for update;

  if not found then
    return;
  end if;

  update public.order_shipping_imports as shipping_import
  set
    state = 'queued',
    lease_token = null,
    lease_expires_at = null,
    next_attempt_at = null,
    provider_created_at = null,
    imported_at = null,
    last_error_type = null,
    updated_at = p_reconciled_at
  where shipping_import.order_id = target_import.order_id
    and shipping_import.state = 'unknown'
  returning shipping_import.* into target_import;

  if not found then
    return;
  end if;

  insert into public.order_shipping_import_reconciliations (
    reconciliation_id,
    order_id,
    action,
    reason_code,
    previous_state,
    target_state,
    attempt_count,
    reconciled_at
  )
  values (
    p_reconciliation_id,
    target_import.order_id,
    'requeue',
    'provider_absence_confirmed',
    'unknown',
    'queued',
    target_import.attempt_count,
    p_reconciled_at
  );

  return query
  select target_import.order_id, target_import.state, target_import.attempt_count;
end;
$function$;

comment on function public.requeue_order_shipping_import_unknown(bigint, uuid, timestamptz) is
  'Human-authorized unknown-to-queued transition after confirmed provider absence.';

revoke all privileges on function public.requeue_order_shipping_import_unknown(
  bigint, uuid, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.requeue_order_shipping_import_unknown(
  bigint, uuid, timestamptz
) to service_role;

notify pgrst, 'reload schema';

commit;
