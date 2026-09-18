jest.mock("../src/config", () => ({
  supabaseUrl: "https://supabase.test",
  supabaseServiceRoleKey: "not-a-real-key",
}));
jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({})),
}));

const fs = require("fs");
const path = require("path");
const {
  SHIPPING_IMPORT_STATES,
  ShippingImportRepositoryError,
  createShippingImportsRepository,
} = require("../src/shippingImports");

const LEASE_TOKEN = "660e8400-e29b-41d4-a716-446655440000";

function validImport(overrides = {}) {
  return {
    order_id: 42,
    ext_order_id: "LEMONT-ORDER-42",
    state: "processing",
    attempt_count: 1,
    lease_token: LEASE_TOKEN,
    lease_expires_at: "2030-01-01T00:01:00.000Z",
    weight_grams: 300,
    height_cm: 5,
    width_cm: 25,
    length_cm: 35,
    declared_value: 2000,
    customer_first_name: "Ana",
    customer_last_name: "Perez",
    customer_email: "ana@example.test",
    customer_phone: "541123456789",
    shipping_country_code: "AR",
    shipping_province: "AR-B",
    shipping_locality: "La Plata",
    shipping_postal_code: "1900",
    shipping_street: "Calle 12",
    shipping_street_number: "345",
    shipping_apartment: null,
    shipping_notes: null,
    shipping_delivery_type: "home",
    shipping_service: "classic",
    shipping_agency_code: null,
    ...overrides,
  };
}

function fakeClient(results = {}) {
  const rpc = jest.fn((name) => {
    const result = results[name] ?? { data: validImport(), error: null };
    return {
      maybeSingle: jest.fn(async () => result),
      then(resolve, reject) {
        return Promise.resolve(result).then(resolve, reject);
      },
    };
  });
  return { client: { rpc }, rpc };
}

describe("shipping import repository", () => {
  test("expone solamente los siete estados aprobados", () => {
    expect(Object.values(SHIPPING_IMPORT_STATES)).toEqual([
      "not_requested", "queued", "processing", "created",
      "retryable", "unknown", "failed",
    ]);
    expect(Object.isFrozen(SHIPPING_IMPORT_STATES)).toBe(true);
  });

  test("claim usa lease provisto y valida el snapshot necesario", async () => {
    const fake = fakeClient();
    const repository = createShippingImportsRepository(fake.client);
    const result = await repository.claimNextShippingImport({
      leaseToken: LEASE_TOKEN,
      leaseExpiresAt: "2030-01-01T00:01:00.000Z",
    });

    expect(result.ext_order_id).toBe("LEMONT-ORDER-42");
    expect(result.declared_value).toBe(2000);
    expect(fake.rpc).toHaveBeenCalledWith("claim_order_shipping_import", {
      p_lease_token: LEASE_TOKEN,
      p_lease_expires_at: "2030-01-01T00:01:00.000Z",
    });
  });

  test("rechaza un claim perteneciente a otro lease", async () => {
    const fake = fakeClient({
      claim_order_shipping_import: {
        data: validImport({ lease_token: "770e8400-e29b-41d4-a716-446655440000" }),
        error: null,
      },
    });
    const repository = createShippingImportsRepository(fake.client);
    await expect(repository.claimNextShippingImport({
      leaseToken: LEASE_TOKEN,
      leaseExpiresAt: "2030-01-01T00:01:00.000Z",
    })).rejects.toBeInstanceOf(ShippingImportRepositoryError);
  });

  test.each([
    ["completeShippingImport", "complete_order_shipping_import", "created", {
      orderId: 42, leaseToken: LEASE_TOKEN,
      providerCreatedAt: null, importedAt: "2030-01-01T00:00:10.000Z",
    }],
    ["retryShippingImport", "retry_order_shipping_import", "retryable", {
      orderId: 42, leaseToken: LEASE_TOKEN,
      nextAttemptAt: "2030-01-01T00:05:00.000Z", errorType: "provider_unavailable",
    }],
    ["markShippingImportUnknown", "mark_order_shipping_import_unknown", "unknown", {
      orderId: 42, leaseToken: LEASE_TOKEN, errorType: "provider_timeout",
    }],
    ["failShippingImport", "fail_order_shipping_import", "failed", {
      orderId: 42, leaseToken: LEASE_TOKEN, errorType: "invalid_request",
    }],
  ])("%s delega en la transición holder-only", async (method, rpcName, state, args) => {
    const fake = fakeClient({
      [rpcName]: { data: validImport({ state, lease_token: null, lease_expires_at: null }), error: null },
    });
    const repository = createShippingImportsRepository(fake.client);
    await repository[method](args);
    expect(fake.rpc).toHaveBeenCalledWith(rpcName, expect.objectContaining({
      p_order_id: 42,
      p_lease_token: LEASE_TOKEN,
    }));
  });

  test("una transición sin fila representa lease perdido y no inventa éxito", async () => {
    const fake = fakeClient({
      fail_order_shipping_import: { data: null, error: null },
    });
    const repository = createShippingImportsRepository(fake.client);
    await expect(repository.failShippingImport({
      orderId: 42,
      leaseToken: LEASE_TOKEN,
      errorType: "invalid_request",
    })).resolves.toBeNull();
  });

  test("expira leases mediante RPC y exige resultados unknown", async () => {
    const fake = fakeClient({
      expire_order_shipping_import_leases: {
        data: [validImport({ state: "unknown", lease_token: null, lease_expires_at: null })],
        error: null,
      },
    });
    const repository = createShippingImportsRepository(fake.client);
    await expect(repository.expireShippingImportLeases()).resolves.toHaveLength(1);
  });
});

describe("migración 009 de infraestructura durable", () => {
  const migrationPath = path.join(
    __dirname,
    "../supabase/migrations/009_create_order_shipping_imports.sql"
  );
  const sql = fs.readFileSync(migrationPath, "utf8");

  test("crea exactamente una fila por order y ext_order_id estable único", () => {
    expect(sql).toMatch(/^begin;/im);
    expect(sql).toMatch(/commit;\s*$/i);
    expect(sql).toMatch(/create table public\.order_shipping_imports/i);
    expect(sql).toMatch(/order_id bigint primary key[\s\S]*references public\.orders\(id\) on delete cascade/i);
    expect(sql).toMatch(/ext_order_id text not null unique/i);
    expect(sql).toMatch(/created_order\.external_reference,[\s\S]*'not_requested'/i);
  });

  test("limita estados e impone invariantes de snapshot, lease y resultado", () => {
    expect(sql).toMatch(/state in \([\s\S]*'not_requested'[\s\S]*'queued'[\s\S]*'processing'[\s\S]*'created'[\s\S]*'retryable'[\s\S]*'unknown'[\s\S]*'failed'/i);
    expect(sql).toMatch(/weight_grams between 1 and 25000[\s\S]*height_cm between 1 and 150[\s\S]*declared_value >= 0/i);
    expect(sql).toMatch(/attempt_count >= 0/i);
    expect(sql).toMatch(/when 'processing' then[\s\S]*lease_token is not null[\s\S]*lease_expires_at is not null/i);
    expect(sql).toMatch(/when 'created' then[\s\S]*imported_at is not null/i);
    expect(sql).toMatch(/when 'retryable' then[\s\S]*next_attempt_at is not null/i);
  });

  test("v3 congela el perfil y usa subtotal de productos como declared_value", () => {
    const signature = sql.match(
      /create function public\.create_pending_order_with_items_v3\(([\s\S]*?)\)\s*returns table/i
    )?.[1];
    expect(signature).toBeDefined();
    expect(signature.match(/^\s*p_/gm)).toHaveLength(31);
    expect(sql).toMatch(/from public\.create_pending_order_with_items_v2\(/i);
    expect(sql).toMatch(/insert into public\.order_shipping_imports[\s\S]*p_package_weight_grams[\s\S]*p_package_height_cm[\s\S]*p_package_width_cm[\s\S]*p_package_length_cm[\s\S]*p_products_subtotal/i);
    expect(sql).not.toMatch(/declared_value[\s\S]{0,120}p_expected_amount/i);
  });

  test("no reemplaza RPC 26 ni v2 y no hace backfill histórico", () => {
    expect(sql).not.toMatch(/drop\s+function/i);
    expect(sql).not.toMatch(/create\s+function\s+public\.create_pending_order_with_items\s*\(/i);
    expect(sql).not.toMatch(/create\s+function\s+public\.create_pending_order_with_items_v2\s*\(/i);
    expect(sql).not.toMatch(/insert into public\.order_shipping_imports\s*\([^)]*\)\s*select/i);
  });

  test("prepara paid + queued en una sola función transaccional", () => {
    const start = sql.indexOf("create function public.mark_order_paid_and_queue_shipping_import(");
    const end = sql.indexOf("create function public.claim_order_shipping_import(");
    const rpc = sql.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(rpc).toMatch(/target_order\.status <> 'pending'/i);
    expect(rpc).toMatch(/update public\.orders[\s\S]*status = 'paid'/i);
    expect(rpc).toMatch(/update public\.order_shipping_imports[\s\S]*state = 'queued'[\s\S]*state = 'not_requested'/i);
    expect(rpc).toMatch(/raise exception[\s\S]*shipping import queue failed/i);
  });

  test("claim es concurrente-seguro, solo toma paid queued/retryable vencido e incrementa intentos", () => {
    const start = sql.indexOf("create function public.claim_order_shipping_import(");
    const end = sql.indexOf("create function public.complete_order_shipping_import(");
    const claim = sql.slice(start, end);
    expect(claim).toMatch(/candidate_order\.status = 'paid'/i);
    expect(claim).toMatch(/shipping_import\.state = 'queued'[\s\S]*shipping_import\.state = 'retryable'[\s\S]*next_attempt_at <= now\(\)/i);
    expect(claim).toMatch(/for update of shipping_import skip locked[\s\S]*limit 1/i);
    expect(claim).toMatch(/state = 'processing'[\s\S]*attempt_count = shipping_import\.attempt_count \+ 1/i);
    expect(claim).not.toMatch(/state = 'unknown'/i);
  });

  test("todas las salidas de processing requieren el lease vigente", () => {
    for (const functionName of [
      "complete_order_shipping_import",
      "retry_order_shipping_import",
      "mark_order_shipping_import_unknown",
      "fail_order_shipping_import",
    ]) {
      const start = sql.indexOf(`create function public.${functionName}(`);
      const next = sql.indexOf("create function public.", start + 25);
      const body = sql.slice(start, next === -1 ? undefined : next);
      expect(start).toBeGreaterThan(-1);
      expect(body).toMatch(/state = 'processing'/i);
      expect(body).toMatch(/lease_token = p_lease_token/i);
      expect(body).toMatch(/lease_expires_at > now\(\)/i);
    }
  });

  test("un lease expirado termina en unknown y nunca vuelve a queued", () => {
    const start = sql.indexOf("create function public.expire_order_shipping_import_leases(");
    const end = sql.indexOf("revoke all privileges", start);
    const expire = sql.slice(start, end);
    expect(expire).toMatch(/state = 'unknown'/i);
    expect(expire).toMatch(/last_error_type = 'lease_expired'/i);
    expect(expire).toMatch(/lease_expires_at <= now\(\)/i);
    expect(expire).not.toMatch(/state = 'queued'/i);
  });

  test("habilita RLS y restablece grants mínimos sin depender de defaults", () => {
    expect(sql).toMatch(/alter table public\.order_shipping_imports enable row level security/i);
    expect(sql).toMatch(/revoke all privileges[\s\S]*on table public\.order_shipping_imports[\s\S]*from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/grant select, insert[\s\S]*on table public\.order_shipping_imports[\s\S]*to service_role/i);
    const updateColumns = sql.match(
      /grant update \(([\s\S]*?)\)\s*on table public\.order_shipping_imports/i
    )?.[1];
    expect(updateColumns).toBeDefined();
    const grantedColumns = updateColumns.split(",").map((column) => column.trim());
    expect(grantedColumns).not.toEqual(expect.arrayContaining([
      "order_id", "ext_order_id", "weight_grams", "height_cm", "width_cm",
      "length_cm", "declared_value", "created_at",
    ]));
    expect(sql).not.toMatch(/grant\s+(?:delete|truncate|trigger|references)\b/i);
    expect(sql).not.toMatch(/create\s+policy/i);
    expect(sql.match(/security invoker/g)).toHaveLength(8);
    expect(sql.match(/set search_path = pg_catalog, public/g)).toHaveLength(8);
    for (const functionName of [
      "create_pending_order_with_items_v3",
      "mark_order_paid_and_queue_shipping_import",
      "claim_order_shipping_import",
      "complete_order_shipping_import",
      "retry_order_shipping_import",
      "mark_order_shipping_import_unknown",
      "fail_order_shipping_import",
      "expire_order_shipping_import_leases",
    ]) {
      expect(sql).toMatch(new RegExp(
        `revoke all privileges on function public\\.${functionName}\\([\\s\\S]*?` +
        "from public, anon, authenticated, service_role;",
        "i"
      ));
      expect(sql).toMatch(new RegExp(
        `grant execute on function public\\.${functionName}\\([\\s\\S]*?to service_role;`,
        "i"
      ));
    }
  });

  test("no implementa provider, endpoint ni worker activo", () => {
    expect(sql).not.toMatch(/\/shipping\/import/i);
    expect(sql).not.toMatch(/http|fetch|net\./i);
  });
});
