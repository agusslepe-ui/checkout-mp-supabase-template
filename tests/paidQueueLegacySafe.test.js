const fs = require("fs");
const path = require("path");

const migration010 = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/010_add_legacy_safe_paid_queue_rpc.sql"),
  "utf8"
);
const migration009 = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/009_create_order_shipping_imports.sql"),
  "utf8"
);

describe("T-022.5 RPC paid + queue legacy-safe", () => {
  test("agrega una RPC v2 y preserva la RPC anterior", () => {
    expect(migration010).toMatch(
      /create function public\.mark_order_paid_and_queue_shipping_import_v2\s*\(/i
    );
    expect(migration009).toMatch(
      /create function public\.mark_order_paid_and_queue_shipping_import\s*\(/i
    );
    expect(migration010).not.toMatch(/\bdrop\b/i);
  });

  test("retorna solamente metadata financiera/logística mínima", () => {
    expect(migration010).toMatch(
      /returns table\s*\(\s*order_id bigint,\s*status text,\s*shipping_queued boolean\s*\)/i
    );
    expect(migration010).not.toMatch(/customer|address|email|phone/i);
  });

  test("serializa la transición financiera por order", () => {
    expect(migration010).toMatch(
      /from public\.orders as candidate[\s\S]*external_reference = p_external_reference[\s\S]*for update/i
    );
    expect(migration010).toMatch(/target_order\.status <> 'pending'[\s\S]*return;/i);
    expect(migration010).toMatch(
      /update public\.orders[\s\S]*status = 'paid'[\s\S]*status = 'pending'/i
    );
  });

  test("rechaza importe o moneda distintos antes de paid y queue", () => {
    const validation = migration010.indexOf("target_order.currency <> p_currency");
    const paidUpdate = migration010.indexOf("update public.orders");
    const queueUpdate = migration010.indexOf("update public.order_shipping_imports");

    expect(validation).toBeGreaterThan(-1);
    expect(validation).toBeLessThan(paidUpdate);
    expect(validation).toBeLessThan(queueUpdate);
    expect(migration010).toMatch(
      /round\(target_order\.amount, 2\) <> round\(p_transaction_amount, 2\)/i
    );
  });

  test("queuea únicamente snapshot existente not_requested", () => {
    expect(migration010).toMatch(
      /update public\.order_shipping_imports[\s\S]*state = 'queued'[\s\S]*order_shipping_imports\.order_id = target_order\.id[\s\S]*order_shipping_imports\.state = 'not_requested'/i
    );
    expect(migration010).not.toMatch(/insert into public\.order_shipping_imports/i);
  });

  test("sin snapshot o con queued/processing conserva paid y reporta false", () => {
    const paidUpdate = migration010.indexOf("update public.orders");
    const queueUpdate = migration010.indexOf("update public.order_shipping_imports");
    const result = migration010.indexOf("queued_count = 1");

    expect(paidUpdate).toBeLessThan(queueUpdate);
    expect(queueUpdate).toBeLessThan(result);
    expect(migration010).toMatch(/queued_count integer := 0/i);
  });

  test("un error logístico no revierte la confirmación financiera", () => {
    expect(migration010).toMatch(
      /update public\.orders[\s\S]*begin\s+update public\.order_shipping_imports[\s\S]*exception when others then\s+queued_count := 0/i
    );
  });

  test("usa invoker, search_path fijo y EXECUTE exclusivo de service_role", () => {
    expect(migration010).toMatch(/security invoker/i);
    expect(migration010).toMatch(/set search_path = pg_catalog, public/i);
    expect(migration010).toMatch(
      /revoke all privileges[\s\S]*from public, anon, authenticated, service_role/i
    );
    expect(migration010).toMatch(/grant execute[\s\S]*to service_role/i);
    expect(migration010).not.toMatch(/grant execute[\s\S]*to (?:public|anon|authenticated)/i);
  });
});
