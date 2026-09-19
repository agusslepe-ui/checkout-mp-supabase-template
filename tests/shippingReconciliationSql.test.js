const fs = require("fs");
const path = require("path");

const migrationPath = path.join(
  __dirname,
  "../supabase/migrations/011_add_shipping_unknown_reconciliation.sql"
);
const sql = fs.readFileSync(migrationPath, "utf8");

function functionBlock(name, nextName) {
  const start = sql.indexOf(`create function public.${name}(`);
  const end = nextName
    ? sql.indexOf(`create function public.${nextName}(`, start + 1)
    : sql.indexOf("commit;", start + 1);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("migraciÃ³n 011 de reconciliaciÃ³n unknown", () => {
  test("es aditiva y crea auditorÃ­a append-only sin PII", () => {
    expect(sql).toMatch(/^begin;/im);
    expect(sql).toMatch(/commit;\s*$/i);
    expect(sql).toMatch(/create table public\.order_shipping_import_reconciliations/i);
    expect(sql).toMatch(/reconciliation_id uuid primary key/i);
    expect(sql).toMatch(/order_id bigint not null[\s\S]*references public\.order_shipping_imports\(order_id\)/i);
    for (const column of [
      "action", "reason_code", "previous_state", "target_state",
      "attempt_count", "reconciled_at",
    ]) {
      expect(sql).toMatch(new RegExp(`${column}\\s+`, "i"));
    }
    expect(sql).not.toMatch(/alter\s+table\s+public\.order_shipping_imports\s+(?:add|drop)/i);
    expect(sql).not.toMatch(/drop\s+(?:table|function|column)/i);
  });

  test("restringe acciones y motivos a las dos combinaciones aprobadas", () => {
    expect(sql).toMatch(/action = 'mark_created'[\s\S]*reason_code = 'provider_found'[\s\S]*previous_state = 'unknown'[\s\S]*target_state = 'created'/i);
    expect(sql).toMatch(/action = 'requeue'[\s\S]*reason_code = 'provider_absence_confirmed'[\s\S]*previous_state = 'unknown'[\s\S]*target_state = 'queued'/i);
    expect(sql).toMatch(/attempt_count >= 0/i);
  });

  test("unknown a created preserva attempt y snapshot sin inventar fecha provider", () => {
    const block = functionBlock(
      "reconcile_order_shipping_import_created",
      "requeue_order_shipping_import_unknown"
    );
    expect(block).toMatch(/state = 'unknown'[\s\S]*for update/i);
    expect(block).toMatch(/state = 'created'/i);
    expect(block).toMatch(/imported_at = p_reconciled_at/i);
    expect(block).toMatch(/lease_token = null[\s\S]*lease_expires_at = null[\s\S]*next_attempt_at = null[\s\S]*last_error_type = null/i);
    expect(block).not.toMatch(/provider_created_at\s*=/i);
    expect(block).not.toMatch(/(?:attempt_count|ext_order_id|weight_grams|height_cm|width_cm|length_cm|declared_value)\s*=/i);
    expect(block).toMatch(/'mark_created'[\s\S]*'provider_found'[\s\S]*'unknown'[\s\S]*'created'[\s\S]*target_import\.attempt_count/i);
  });

  test("unknown a queued limpia resultado y preserva attempt, correlaciÃ³n y snapshot", () => {
    const block = functionBlock("requeue_order_shipping_import_unknown");
    expect(block).toMatch(/state = 'unknown'[\s\S]*for update/i);
    expect(block).toMatch(/state = 'queued'/i);
    expect(block).toMatch(/provider_created_at = null[\s\S]*imported_at = null/i);
    expect(block).toMatch(/next_attempt_at = null[\s\S]*last_error_type = null/i);
    expect(block).not.toMatch(/(?:attempt_count|ext_order_id|weight_grams|height_cm|width_cm|length_cm|declared_value)\s*=/i);
    expect(block).toMatch(/'requeue'[\s\S]*'provider_absence_confirmed'[\s\S]*'unknown'[\s\S]*'queued'[\s\S]*target_import\.attempt_count/i);
  });

  test("requeue no resetea attempt_count y audita el valor preservado", () => {
    const block = functionBlock("requeue_order_shipping_import_unknown");
    expect(block).not.toMatch(/attempt_count\s*=\s*(?:0|1)/i);
    expect(block).toMatch(/'queued'[\s\S]*target_import\.attempt_count[\s\S]*p_reconciled_at/i);
  });

  test.each([
    "created", "queued", "processing", "retryable", "failed", "not_requested",
  ])("el estado %s queda fuera de ambas transiciones", (state) => {
    for (const block of [
      functionBlock("reconcile_order_shipping_import_created", "requeue_order_shipping_import_unknown"),
      functionBlock("requeue_order_shipping_import_unknown"),
    ]) {
      expect(block).toMatch(/where shipping_import\.order_id = p_order_id[\s\S]*shipping_import\.state = 'unknown'[\s\S]*for update/i);
      expect(block).not.toMatch(new RegExp(`shipping_import\\.state = '${state}'`, "i"));
    }
  });

  test("lock y condiciÃ³n permiten una sola transiciÃ³n y un solo evento", () => {
    for (const block of [
      functionBlock("reconcile_order_shipping_import_created", "requeue_order_shipping_import_unknown"),
      functionBlock("requeue_order_shipping_import_unknown"),
    ]) {
      expect(block).toMatch(/state = 'unknown'[\s\S]*for update/i);
      expect(block).toMatch(/update public\.order_shipping_imports[\s\S]*state = 'unknown'[\s\S]*returning/i);
      expect(block.match(/insert into public\.order_shipping_import_reconciliations/gi)).toHaveLength(1);
      expect(block.indexOf("update public.order_shipping_imports"))
        .toBeLessThan(block.indexOf("insert into public.order_shipping_import_reconciliations"));
    }
  });

  test("RLS y grants mantienen auditorÃ­a append-only y RPC backend-only", () => {
    expect(sql).toMatch(/alter table public\.order_shipping_import_reconciliations enable row level security/i);
    expect(sql).not.toMatch(/create\s+policy/i);
    expect(sql).toMatch(/revoke all privileges[\s\S]*on table public\.order_shipping_import_reconciliations[\s\S]*from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/grant select, insert[\s\S]*on table public\.order_shipping_import_reconciliations[\s\S]*to service_role/i);
    expect(sql).not.toMatch(/grant\s+(?:update|delete|truncate)\b/i);

    for (const name of [
      "reconcile_order_shipping_import_created",
      "requeue_order_shipping_import_unknown",
    ]) {
      expect(sql).toMatch(new RegExp(
        `create function public\\.${name}\\([\\s\\S]*?security invoker[\\s\\S]*?` +
        "set search_path = pg_catalog, public",
        "i"
      ));
      expect(sql).toMatch(new RegExp(
        `revoke all privileges on function public\\.${name}\\([\\s\\S]*?` +
        "from public, anon, authenticated, service_role;",
        "i"
      ));
      expect(sql).toMatch(new RegExp(
        `grant execute on function public\\.${name}\\([\\s\\S]*?to service_role;`,
        "i"
      ));
    }
  });

  test("no contiene transporte, provider ni datos de destinatario", () => {
    expect(sql).not.toMatch(/\/shipping\/import|\bhttp|\bfetch\b|customer_id|jwt|secret/i);
    expect(sql).not.toMatch(/customer_(?:first_name|last_name|email|phone)|shipping_(?:street|locality|postal_code)/i);
  });

  test("solicita reload del schema PostgREST antes del commit", () => {
    const notifyIndex = sql.toLowerCase().lastIndexOf("notify pgrst, 'reload schema';");
    const commitIndex = sql.toLowerCase().lastIndexOf("commit;");
    expect(notifyIndex).toBeGreaterThan(-1);
    expect(notifyIndex).toBeLessThan(commitIndex);
  });
});
