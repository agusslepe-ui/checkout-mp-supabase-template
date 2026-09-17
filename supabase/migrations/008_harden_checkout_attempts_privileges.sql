-- T-017.4: reproduce the least-privilege grants verified in production.
-- Review and apply manually only after explicit authorization.

begin;

revoke all privileges
on table public.checkout_attempts
from service_role;

grant select, insert
on table public.checkout_attempts
to service_role;

grant update (
  state,
  mercadopago_preference_id,
  checkout_url,
  lease_token,
  lease_expires_at,
  updated_at
)
on table public.checkout_attempts
to service_role;

revoke all privileges
on sequence public.checkout_attempts_id_seq
from service_role;

grant usage
on sequence public.checkout_attempts_id_seq
to service_role;

commit;
