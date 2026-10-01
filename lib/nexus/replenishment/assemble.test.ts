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
  reservations: name === "Supplier B" ? [{ sku, reservedStock: 2 }] : [],
  currentStocks: name === "Supplier B" ? [{ sku, currentStock: 17 }] : [],
  ...(category ? { categories: [{ sku, category }] } : {}),
});

test("assembly combines both suppliers and derives the freshest stock month", () => {
  const result = assembleReplenishmentInput([supplier("Supplier A", "A-1", "2026-08"), supplier("Supplier B", "B-1", "2026-09", "2")]);
  assert.equal(result.monthlySales.length, 2);
  assert.equal(result.openingStocks.length, 2);
  assert.equal(result.inboundShipments.length, 2);
  assert.equal(result.salesTransactions.length, 2);
  assert.equal(result.minimumOrderQuantities?.length, 2);
  assert.equal(result.reservations?.length, 1);
  assert.equal(result.currentStocks?.length, 1);
  assert.equal(result.monthlySales[0].supplier, "Supplier A");
  assert.equal(result.monthlySales[1].supplier, "Supplier B");
  assert.equal(result.options.asOfMonth, "2026-09");
});

test("assembly uses supplied categories and documented defaults without inventing forecast growth", () => {
  const result = assembleReplenishmentInput([supplier("Supplier A", "A-1", "2026-08"), supplier("Supplier B", "B-1", "2026-09", "2")]);
  assert.deepEqual(result.skuConfigs, [
    { sku: "A-1", supplier: "Supplier A", category: "UNCLASSIFIED", forecastGrowthRate: 0 },
    { sku: "B-1", supplier: "Supplier B", category: "2", forecastGrowthRate: 0 },
  ]);
  assert.equal(result.options.defaultLeadTimeMonths, DEFAULT_ASSEMBLY_ASSUMPTIONS.defaultLeadTimeMonths);
});

test("assembly accepts explicit external growth and lead-time overrides", () => {
  const result = assembleReplenishmentInput([supplier("Supplier A", "A-1", "2026-08")], {
    ...DEFAULT_ASSEMBLY_ASSUMPTIONS,
    forecastGrowthBySku: { "A-1": 0.12 },
    leadTimeBySku: { "A-1": 3 },
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

test("batch stock sums valid quantity per SKU and per warehouse, excluding below-threshold and expired batches", () => {
  const partial = supplier("Supplier A", "SKU-1", "2026-09");
  partial.currentStocks = [];
  partial.stockBatches = [
    { sku: "SKU-1", warehouse: "Алматы", quantity: 56, shelfLifeRemainingPercent: 51 },
    { sku: "SKU-1", warehouse: "Астана", quantity: 18, shelfLifeRemainingPercent: 12 },
    { sku: "SKU-1", warehouse: "Астана", quantity: 5, expired: true },
    { sku: "SKU-1", quantity: 9 },
  ];
  const result = assembleReplenishmentInput([partial], { ...DEFAULT_ASSEMBLY_ASSUMPTIONS, shelfLifeValidityThresholdPercent: 30 });

  assert.equal(result.currentStocks?.length, 1);
  const stock = result.currentStocks![0];
  // Valid: 56 (51% >= 30) + 9 (no shelf-life data) = 65. Excluded: 18 (12% < 30) + 5 (expired) = 23.
  assert.equal(stock.currentStock, 65);
  assert.equal(stock.excludedForShelfLife, 23);
  assert.deepEqual(stock.stockByWarehouse, { "Алматы": 56 });
});

test("batch-derived stock takes precedence over a plain snapshot for the same SKU, plain fills the rest", () => {
  const partial = supplier("Supplier A", "SKU-1", "2026-09");
  partial.currentStocks = [{ sku: "SKU-1", currentStock: 999 }, { sku: "SKU-2", currentStock: 30 }];
  partial.stockBatches = [{ sku: "SKU-1", quantity: 65, shelfLifeRemainingPercent: 80 }];
  const result = assembleReplenishmentInput([partial]);

  assert.equal(result.currentStocks?.length, 2);
  const bySku = new Map(result.currentStocks!.map((item) => [item.sku, item.currentStock]));
  assert.equal(bySku.get("SKU-1"), 65);
  assert.equal(bySku.get("SKU-2"), 30);
});

test("expiring-stock exclusion and warehouse breakdown reach the final recommendation without affecting the order math twice", () => {
  const partial = supplier("Supplier A", "SKU-1", "2026-09");
  partial.currentStocks = [];
  partial.stockBatches = [
    { sku: "SKU-1", warehouse: "Алматы", quantity: 56, shelfLifeRemainingPercent: 51 },
    { sku: "SKU-1", warehouse: "Астана", quantity: 18, shelfLifeRemainingPercent: 12 },
  ];
  const assembled = assembleReplenishmentInput([partial]);
  const plan = calculateReplenishment(assembled);
  const recommendation = plan.suppliers[0].items[0];

  assert.equal(recommendation.currentStock, 56);
  assert.equal(recommendation.expiringStockExcluded, 18);
  assert.deepEqual(recommendation.stockByWarehouse, { "Алматы": 56 });
  assert.ok(recommendation.exceptions.includes("expiring_stock"));
});
