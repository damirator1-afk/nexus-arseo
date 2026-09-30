import test from "node:test";
import assert from "node:assert/strict";
import { assembleReplenishmentInput, DEFAULT_ASSEMBLY_ASSUMPTIONS } from "./assemble.ts";
import { calculateReplenishment } from "./calculation.ts";
import type { SupplierParsedData } from "./assemble.ts";

const supplier = (name: string, sku: string, month: "2026-08" | "2026-09", category?: string): SupplierParsedData => ({
  supplier: name,
  monthlySales: [{ sku, productName: sku, month, unitsSold: 10 }],
  openingStocks: [{ sku, productName: sku, month, openingStock: 5 }],
  inboundShipments: [{ sku, productName: sku, shipmentId: "S", expectedDate: null, quantity: 2 }],
  salesTransactions: [{ sku, productName: sku, invoiceNumber: "I", occurredAt: `${month}-01T00:00:00Z`, unitsSold: 10, sourceQuantity: -10 }],
  minimumOrderQuantities: [{ sku, productName: sku, multiple: 4 }],
  reservations: name === "Systeme Electric" ? [{ sku, reservedStock: 2 }] : [],
  currentStocks: name === "Systeme Electric" ? [{ sku, currentStock: 17 }] : [],
  ...(category ? { categories: [{ sku, category }] } : {}),
});

test("assembly combines both suppliers and derives the freshest stock month", () => {
  const result = assembleReplenishmentInput([supplier("IEK", "I-1", "2026-08"), supplier("Systeme Electric", "S-1", "2026-09", "2")]);
  assert.equal(result.monthlySales.length, 2);
  assert.equal(result.openingStocks.length, 2);
  assert.equal(result.inboundShipments.length, 2);
  assert.equal(result.salesTransactions.length, 2);
  assert.equal(result.minimumOrderQuantities?.length, 2);
  assert.equal(result.reservations?.length, 1);
  assert.equal(result.currentStocks?.length, 1);
  assert.equal(result.monthlySales[0].supplier, "IEK");
  assert.equal(result.monthlySales[1].supplier, "Systeme Electric");
  assert.equal(result.options.asOfMonth, "2026-09");
});

test("assembly uses partner category and documented IEK/default assumptions without inventing forecast growth", () => {
  const result = assembleReplenishmentInput([supplier("IEK", "I-1", "2026-08"), supplier("Systeme Electric", "S-1", "2026-09", "2")]);
  assert.deepEqual(result.skuConfigs, [
    { sku: "I-1", supplier: "IEK", category: "UNCLASSIFIED", forecastGrowthRate: 0 },
    { sku: "S-1", supplier: "Systeme Electric", category: "2", forecastGrowthRate: 0 },
  ]);
  assert.equal(result.options.defaultLeadTimeMonths, DEFAULT_ASSEMBLY_ASSUMPTIONS.defaultLeadTimeMonths);
});

test("assembly accepts explicit external growth and lead-time overrides", () => {
  const result = assembleReplenishmentInput([supplier("IEK", "I-1", "2026-08")], {
    ...DEFAULT_ASSEMBLY_ASSUMPTIONS,
    forecastGrowthBySku: { "I-1": 0.12 },
    leadTimeBySku: { "I-1": 3 },
  });
  assert.equal(result.skuConfigs[0].forecastGrowthRate, 0.12);
  assert.equal(result.skuConfigs[0].leadTimeMonths, 3);
});

test("assembly carries missing-source disclosure without changing calculation input arrays", () => {
  const partial = supplier("Новый поставщик", "SKU-1", "2026-09");
  partial.inboundShipments = [];
  partial.minimumOrderQuantities = [];
  partial.missingSources = ["inbound", "moq"];
  const result = assembleReplenishmentInput([partial]);

  assert.deepEqual(result.missingSources, { "Новый поставщик": ["inbound", "moq"] });
  assert.deepEqual(result.inboundShipments, []);
  assert.deepEqual(result.minimumOrderQuantities, []);
  assert.equal(result.asOfMonthSource, "opening_stocks");
});

test("assembly uses the current month when all suppliers provide only current stock snapshots", () => {
  const currentOnly = supplier("Новый поставщик", "SKU-1", "2026-09");
  currentOnly.openingStocks = [];
  currentOnly.currentStocks = [{ sku: "SKU-1", currentStock: 17 }];
  currentOnly.missingSources = ["openingStocks"];
  const result = assembleReplenishmentInput([currentOnly]);

  assert.equal(result.options.asOfMonth, new Date().toISOString().slice(0, 7));
  assert.equal(result.asOfMonthSource, "current_date");
});

test("a supplier with sales, transactions and stock still calculates without inbound or MOQ", () => {
  const partial = supplier("Тестовый поставщик", "SKU-1", "2026-09");
  partial.inboundShipments = [];
  partial.minimumOrderQuantities = [];
  partial.missingSources = ["inbound", "moq"];

  const assembled = assembleReplenishmentInput([partial]);
  const plan = calculateReplenishment(assembled);
  const recommendation = plan.suppliers[0].items[0];

  assert.equal(recommendation.goodsInTransitWithinHorizon, 0);
  assert.equal(recommendation.moqMultiple, null);
  assert.ok(recommendation.recommendedOrder >= 0);
  assert.deepEqual(assembled.missingSources["Тестовый поставщик"], ["inbound", "moq"]);
});
