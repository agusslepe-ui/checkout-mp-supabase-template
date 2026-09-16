const {
  CHECKOUT_ATTEMPT_STATES,
  CheckoutAttemptIdError,
  normalizeCheckoutAttemptId,
} = require("../src/checkoutAttempt");
const fs = require("fs");
const path = require("path");

describe("normalizeCheckoutAttemptId", () => {
  test("acepta un UUID canónico válido", () => {
    expect(normalizeCheckoutAttemptId("550e8400-e29b-41d4-a716-446655440000"))
      .toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  test("normaliza un UUID uppercase a lowercase", () => {
    expect(normalizeCheckoutAttemptId("550E8400-E29B-41D4-A716-446655440000"))
      .toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  test.each(["", "   "])("rechaza string vacío %j", (value) => {
    expect(() => normalizeCheckoutAttemptId(value)).toThrow(CheckoutAttemptIdError);
  });

  test("rechaza null", () => {
    expect(() => normalizeCheckoutAttemptId(null)).toThrow(CheckoutAttemptIdError);
  });

  test("rechaza números", () => {
    expect(() => normalizeCheckoutAttemptId(123)).toThrow(CheckoutAttemptIdError);
  });

  test.each([{}, []])("rechaza objetos y arrays", (value) => {
    expect(() => normalizeCheckoutAttemptId(value)).toThrow(CheckoutAttemptIdError);
  });

  test.each([
    "550e8400e29b41d4a716446655440000",
    "{550e8400-e29b-41d4-a716-446655440000}",
    "550e8400-e29b-01d4-a716-446655440000",
    "550e8400-e29b-41d4-7716-446655440000",
    "not-a-uuid",
  ])("rechaza UUID malformado %s", (value) => {
    expect(() => normalizeCheckoutAttemptId(value)).toThrow(CheckoutAttemptIdError);
  });
});

test("expone únicamente los estados aprobados para checkout_attempts", () => {
  expect(Object.values(CHECKOUT_ATTEMPT_STATES)).toEqual([
    "reserved",
    "creating_preference",
    "ready",
    "unknown",
  ]);
  expect(Object.isFrozen(CHECKOUT_ATTEMPT_STATES)).toBe(true);
});

describe("migración 007", () => {
  const sql = fs.readFileSync(path.join(
    __dirname,
    "../supabase/migrations/007_create_checkout_attempts.sql"
  ), "utf8");

  test("crea checkout_attempts con unicidad y FK uno a uno", () => {
    expect(sql).toMatch(/create table public\.checkout_attempts/i);
    expect(sql).toMatch(/checkout_attempt_id uuid not null unique/i);
    expect(sql).toMatch(/order_id bigint not null unique[\s\S]*references public\.orders\(id\) on delete cascade/i);
    expect(sql).toMatch(/state in \('reserved', 'creating_preference', 'ready', 'unknown'\)/i);
    expect(sql).toMatch(/unique index checkout_attempts_mercadopago_preference_id_uidx[\s\S]*where mercadopago_preference_id is not null/i);
  });

  test("protege leases, RLS y privilegios mínimos", () => {
    expect(sql).toMatch(/check \(\(lease_token is null\) = \(lease_expires_at is null\)\)/i);
    expect(sql).toMatch(/alter table public\.checkout_attempts enable row level security/i);
    expect(sql).toMatch(/revoke all on table public\.checkout_attempts from public, anon, authenticated/i);
    expect(sql).toMatch(/grant select, insert, update on table public\.checkout_attempts to service_role/i);
    expect(sql).not.toMatch(/grant delete on table public\.checkout_attempts/i);
    expect(sql).toMatch(/grant usage on sequence public\.checkout_attempts_id_seq to service_role/i);
  });

  test("reemplaza la RPC de 26 por una única firma de 27 parámetros", () => {
    const createSignature = sql.match(
      /create function public\.create_pending_order_with_items\(([\s\S]*?)\)\s*returns table/i
    )?.[1];
    expect(createSignature).toBeDefined();
    expect(createSignature.match(/^\s*p_/gm)).toHaveLength(27);
    expect(createSignature).toMatch(/p_checkout_attempt_id uuid/);
    expect(sql).toMatch(/drop function public\.create_pending_order_with_items\([\s\S]*?jsonb\s*\);/i);
    expect(sql).toMatch(/security invoker\s+set search_path = pg_catalog, public/i);
  });

  test("inserta intento después de order e items sin ocultar conflictos", () => {
    const orderPosition = sql.indexOf("insert into public.orders");
    const itemsPosition = sql.indexOf("insert into public.order_items");
    const attemptPosition = sql.indexOf("insert into public.checkout_attempts");
    expect(orderPosition).toBeGreaterThan(-1);
    expect(itemsPosition).toBeGreaterThan(orderPosition);
    expect(attemptPosition).toBeGreaterThan(itemsPosition);
    expect(sql).toMatch(/if p_checkout_attempt_id is null then/i);
    expect(sql).toMatch(/p_checkout_attempt_id,[\s\S]*created_order\.id,[\s\S]*'reserved'/i);
    expect(sql).not.toMatch(/on conflict/i);
  });
});
