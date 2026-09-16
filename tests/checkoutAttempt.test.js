const {
  CHECKOUT_ATTEMPT_STATES,
  CheckoutAttemptIdError,
  buildCheckoutRequestIdentity,
  checkoutRequestMatchesSnapshot,
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

describe("identidad lógica de retries", () => {
  const checkoutInput = {
    customer_first_name: "Ana María",
    customer_last_name: "O'Connor",
    customer_email: "ana@example.test",
    customer_phone: "541123456789",
    shipping_province: "AR-B",
    shipping_locality: "La Plata",
    shipping_postal_code: "B1900ABC",
    shipping_street: "Calle 12",
    shipping_street_number: "345",
    shipping_apartment: null,
    shipping_notes: "Portón negro",
  };
  const persisted = {
    order: {
      ...checkoutInput,
      shipping_option_id: "micorreo:home:classic",
      shipping_delivery_type: "home",
      shipping_agency_code: null,
      items: [
        { product_sku: "SKU-B", quantity: 1, product_name: "Viejo", unit_price: 1 },
        { product_sku: "SKU-A", quantity: 1, product_name: "Viejo", unit_price: 9999 },
        { product_sku: "SKU-A", quantity: 2, product_name: "Otro", unit_price: 5 },
      ],
    },
  };

  function identity(overrides = {}) {
    return buildCheckoutRequestIdentity({
      body: { items: [{ sku: "SKU-A", quantity: 3 }, { sku: "SKU-B", quantity: 1 }] },
      checkoutInput,
      shippingOptionId: "micorreo:home:classic",
      shippingAgencyCode: "EXTRA-HOME-IGNORADO",
      ...overrides,
    });
  }

  test("agrupa y ordena SKU/quantity sin comparar nombres ni precios", () => {
    expect(checkoutRequestMatchesSnapshot(identity(), persisted)).toBe(true);
    expect(identity().products).toEqual([
      { sku: "SKU-A", quantity: 3 },
      { sku: "SKU-B", quantity: 1 },
    ]);
  });

  test.each([
    ["carrito", { body: { items: [{ sku: "SKU-A", quantity: 2 }, { sku: "SKU-B", quantity: 1 }] } }],
    ["customer", { checkoutInput: { ...checkoutInput, customer_email: "otra@example.test" } }],
    ["delivery", { checkoutInput: { ...checkoutInput, shipping_street_number: "346" } }],
    ["shipping", { shippingOptionId: "micorreo:home:express" }],
  ])("detecta cambio de %s", (_label, override) => {
    expect(checkoutRequestMatchesSnapshot(identity(override), persisted)).toBe(false);
  });

  test("HOME ignora agency code extra", () => {
    expect(identity().shippingAgencyCode).toBeNull();
    expect(checkoutRequestMatchesSnapshot(identity(), persisted)).toBe(true);
  });

  test("AGENCY exige el mismo agency code", () => {
    const agencySnapshot = {
      order: {
        ...persisted.order,
        shipping_option_id: "micorreo:agency:classic",
        shipping_delivery_type: "agency",
        shipping_agency_code: "AG-001",
      },
    };
    const same = identity({
      shippingOptionId: "micorreo:agency:classic",
      shippingAgencyCode: "AG-001",
    });
    const changed = identity({
      shippingOptionId: "micorreo:agency:classic",
      shippingAgencyCode: "AG-002",
    });
    expect(checkoutRequestMatchesSnapshot(same, agencySnapshot)).toBe(true);
    expect(checkoutRequestMatchesSnapshot(changed, agencySnapshot)).toBe(false);
  });
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
    expect(sql).toMatch(/constraint checkout_attempts_state_coherence_check[\s\S]*when 'creating_preference'[\s\S]*lease_token is not null[\s\S]*lease_expires_at is not null/i);
    expect(sql).toMatch(/when 'ready'[\s\S]*mercadopago_preference_id is not null[\s\S]*lease_token is null[\s\S]*lease_expires_at is null/i);
    expect(sql).toMatch(/alter table public\.checkout_attempts enable row level security/i);
    expect(sql).toMatch(/revoke all on table public\.checkout_attempts from public, anon, authenticated/i);
    expect(sql).toMatch(/grant select, insert on table public\.checkout_attempts to service_role/i);
    expect(sql).toMatch(/grant update \([\s\S]*state,[\s\S]*updated_at[\s\S]*\) on table public\.checkout_attempts to service_role/i);
    const updateColumns = sql.match(
      /grant update \(([\s\S]*?)\) on table public\.checkout_attempts to service_role/i
    )?.[1];
    expect(updateColumns).toBeDefined();
    expect(updateColumns).not.toMatch(/checkout_attempt_id|order_id|created_at/i);
    expect(sql).not.toMatch(/grant delete on table public\.checkout_attempts/i);
    expect(sql).toMatch(/grant usage on sequence public\.checkout_attempts_id_seq to service_role/i);
  });

  test("define un claim atómico restringido a intentos elegibles", () => {
    expect(sql).toMatch(/create function public\.claim_checkout_attempt\([\s\S]*returns setof public\.checkout_attempts[\s\S]*language sql[\s\S]*security invoker/i);
    expect(sql).toMatch(/state = 'creating_preference'[\s\S]*mercadopago_preference_id = null[\s\S]*checkout_url = null[\s\S]*lease_token = p_lease_token[\s\S]*lease_expires_at = p_lease_expires_at[\s\S]*updated_at = now\(\)/i);
    expect(sql).toMatch(/attempt\.state in \('reserved', 'unknown'\)[\s\S]*attempt\.state = 'creating_preference'[\s\S]*attempt\.lease_expires_at <= now\(\)/i);
    expect(sql).toMatch(/revoke execute on function public\.claim_checkout_attempt\(uuid, uuid, timestamptz\)[\s\S]*from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.claim_checkout_attempt\(uuid, uuid, timestamptz\)[\s\S]*to service_role/i);
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
