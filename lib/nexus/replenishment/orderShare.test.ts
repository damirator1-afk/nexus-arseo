import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSupplierOrderMessage, groupConfirmedOrders, SHARE_MESSAGE_LINE_LIMIT,
  supplierOrderCsv, telegramShareUrl, whatsappShareUrl,
  type ConfirmedOrderLine,
} from "./orderShare.ts";

const line = (overrides: Partial<ConfirmedOrderLine> = {}): ConfirmedOrderLine => ({
  supplier: "IEK", sku: "SKU-1", productName: "Автомат", recommendedOrder: 100,
  quantity: 100, urgency: "high", ...overrides,
});

test("confirmed orders are grouped by supplier and zero quantities are excluded", () => {
  const groups = groupConfirmedOrders([
    line(), line({ supplier: "Systeme Electric", sku: "SE-1", quantity: 20 }),
    line({ sku: "ZERO", quantity: 0 }),
  ]);
  assert.deepEqual(groups.map((group) => [group.supplier, group.lines.length, group.totalUnits]), [
    ["IEK", 1, 100], ["Systeme Electric", 1, 20],
  ]);
});

test("supplier message contains only supplied deterministic order values", () => {
  const message = buildSupplierOrderMessage("IEK", [line()], "2026-09");
  assert.match(message, /Заказ поставщику IEK/);
  assert.match(message, /SKU-1 — 100 шт\. · Автомат/);
  assert.match(message, /Итого: 1 поз\., 100 шт\./);
  assert.match(message, /Количество подтверждено менеджером/);
});

test("long messenger preview is bounded and points to the complete CSV", () => {
  const lines = Array.from({ length: SHARE_MESSAGE_LINE_LIMIT + 3 }, (_, index) => line({ sku: `SKU-${index + 1}` }));
  const message = buildSupplierOrderMessage("IEK", lines, "2026-09");
  assert.match(message, /…ещё 3 поз\. — полный перечень в приложенном CSV\./);
  assert.doesNotMatch(message, new RegExp(`SKU-${SHARE_MESSAGE_LINE_LIMIT + 3} —`));
  assert.match(message, new RegExp(`Итого: ${SHARE_MESSAGE_LINE_LIMIT + 3} поз\.`));
});

test("messenger links encode the message without changing it", () => {
  const message = "Заказ IEK\nSKU-1 — 10 шт.";
  const whatsApp = new URL(whatsappShareUrl(message));
  assert.equal(whatsApp.hostname, "wa.me");
  assert.equal(whatsApp.searchParams.get("text"), message);
  const telegram = new URL(telegramShareUrl(message, "https://nexus.example/replenishment"));
  assert.equal(telegram.hostname, "t.me");
  assert.equal(telegram.searchParams.get("text"), message);
  assert.equal(telegram.searchParams.get("url"), "https://nexus.example/replenishment");
});

test("supplier CSV is Excel-friendly and escapes product names", () => {
  const csv = supplierOrderCsv([line({ productName: 'Автомат "Pro"' })], "2026-09");
  assert.ok(csv.startsWith("﻿"));
  assert.match(csv, /"Автомат ""Pro"""/);
  assert.match(csv, /"100";"100";"high";"2026-09"/);
});

test("supplier CSV neutralizes formula-like partner text", () => {
  const csv = supplierOrderCsv([line({ sku: "=CMD()", productName: "+опасная формула" })], "2026-09");
  assert.match(csv, /"'=CMD\(\)"/);
  assert.match(csv, /"'\+опасная формула"/);
});
