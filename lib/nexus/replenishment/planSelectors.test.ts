import test from "node:test";
import assert from "node:assert/strict";
import { groupByOrderDeadline, summarizePlan } from "./planSelectors.ts";
import type { ReplenishmentRecommendation } from "./calculation.ts";

function makeItem(overrides: Partial<ReplenishmentRecommendation> = {}): ReplenishmentRecommendation {
  return {
    sku: "SKU-1",
    productName: "Test SKU",
    supplier: "IEK",
    category: "A",
    baseMonthlyDemand: 10,
    rawMonthlyDemand: 10,
    seasonalIndex: 1,
    seasonalForecast: [],
    historicalGrowthRate: 0,
    forecastGrowthRate: 0,
    combinedGrowthFactor: 1,
    adjustedDemandRate: 10,
    planningMonthlyDemand: 10,
    stockLifecycleStatus: "active",
    stockoutAdjustmentUnitsPerMonth: 0,
    stockoutCompensationFactor: 1,
    stockoutMonths: [],
    excludedSpikeCount: 0,
    excludedSpikeUnits: 0,
    excludedSpikeTransactionIds: [],
    retainedGrowthSpikeCount: 0,
    retainedGrowthSpikeUnits: 0,
    spikeOrderImpactEstimate: 0,
    openingStockAsOf: 20,
    salesSinceOpening: 5,
    currentStock: 15,
    currentStockSource: "projected_from_opening",
    expiringStockExcluded: 0,
    reservedStock: 0,
    availableStock: 15,
    goodsInTransitWithinHorizon: 0,
    goodsInTransitUnknownEta: 0,
    goodsInTransitAfterHorizon: 0,
    etaAssumptionApplied: false,
    unknownEtaExcluded: false,
    leadTimeMonths: 2,
    reviewPeriodMonths: 1,
    demandStdDev: 1,
    serviceLevel: 0.95,
    safetyStockZScore: 1.6449,
    safetyStock: 5,
    targetPosition: 35,
    currentPosition: 15,
    recommendedOrderBeforeMoq: 20,
    moqMultiple: null,
    recommendedOrder: 20,
    coverageMonths: 1.5,
    daysOfSupply: 45,
    isOverstock: false,
    overstockMonths: 0,
    nearestInboundExpectedDate: null,
    projectedStockoutDate: null,
    potentialStockoutDays: null,
    urgency: "medium",
    demandPattern: "stable",
    nonZeroDemandFrequency: 1,
    forecastMethod: "seasonal_trend",
    exceptions: [],
    ...overrides,
  };
}

test("summarizePlan counts every SKU exactly once across all buckets", () => {
  const items = [
    makeItem({ sku: "A", urgency: "high", stockLifecycleStatus: "active", demandPattern: "stable", recommendedOrder: 10, supplier: "IEK" }),
    makeItem({ sku: "B", urgency: "medium", stockLifecycleStatus: "slow", demandPattern: "volatile", recommendedOrder: 5, supplier: "IEK", exceptions: ["slow_stock"] }),
    makeItem({ sku: "C", urgency: "low", stockLifecycleStatus: "dead", demandPattern: "intermittent", recommendedOrder: 0, supplier: "Systeme Electric", exceptions: ["dead_stock", "stockout"] }),
  ];
  const summary = summarizePlan(items);
  assert.equal(summary.totalSkuCount, 3);
  assert.equal(summary.totalRecommendedUnits, 15);
  assert.deepEqual(summary.urgencyCounts, { high: 1, medium: 1, low: 1 });
  assert.deepEqual(summary.lifecycleCounts, { active: 1, slow: 1, dead: 1 });
  assert.deepEqual(summary.demandPatternCounts, { stable: 1, volatile: 1, intermittent: 1 });
  assert.equal(summary.exceptionCounts.slow_stock, 1);
  assert.equal(summary.exceptionCounts.dead_stock, 1);
  assert.equal(summary.exceptionCounts.stockout, 1);
  assert.equal(summary.exceptionCounts.surplus, 0);
});

test("summarizePlan groups supplier totals and sums recommended units per supplier", () => {
  const items = [
    makeItem({ sku: "A", supplier: "IEK", recommendedOrder: 10 }),
    makeItem({ sku: "B", supplier: "IEK", recommendedOrder: 5 }),
    makeItem({ sku: "C", supplier: "Systeme Electric", recommendedOrder: 7 }),
  ];
  const summary = summarizePlan(items);
  assert.deepEqual(summary.supplierTotals, [
    { supplier: "IEK", skuCount: 2, recommendedUnits: 15 },
    { supplier: "Systeme Electric", skuCount: 1, recommendedUnits: 7 },
  ]);
});

test("summarizePlan on an empty plan returns zeroed counts, not errors", () => {
  const summary = summarizePlan([]);
  assert.equal(summary.totalSkuCount, 0);
  assert.equal(summary.totalRecommendedUnits, 0);
  assert.deepEqual(summary.supplierTotals, []);
  assert.deepEqual(summary.urgencyCounts, { high: 0, medium: 0, low: 0 });
});

test("groupByOrderDeadline excludes SKUs with no recommended order", () => {
  const items = [
    makeItem({ sku: "A", recommendedOrder: 0, projectedStockoutDate: "2026-10-01" }),
    makeItem({ sku: "B", recommendedOrder: 5, projectedStockoutDate: "2026-10-01", leadTimeMonths: 1 }),
  ];
  const groups = groupByOrderDeadline(items, new Date("2026-09-01T00:00:00Z"));
  const allSkus = groups.flatMap((group) => group.items.map((item) => item.sku));
  assert.deepEqual(allSkus, ["B"]);
});

test("groupByOrderDeadline buckets a past order-by date as overdue", () => {
  const items = [makeItem({ sku: "A", recommendedOrder: 5, projectedStockoutDate: "2026-09-10", leadTimeMonths: 1 })];
  // order-by date = 2026-09-10 minus ~30 days = ~2026-08-11, before the "as of" date below.
  const groups = groupByOrderDeadline(items, new Date("2026-09-01T00:00:00Z"));
  assert.equal(groups[0].bucketKey, "overdue");
  assert.equal(groups[0].items[0].sku, "A");
});

test("groupByOrderDeadline buckets a future order-by date by calendar month and sorts chronologically", () => {
  const items = [
    makeItem({ sku: "LATER", recommendedOrder: 5, projectedStockoutDate: "2026-12-15", leadTimeMonths: 1 }),
    makeItem({ sku: "SOONER", recommendedOrder: 5, projectedStockoutDate: "2026-10-15", leadTimeMonths: 1 }),
  ];
  const groups = groupByOrderDeadline(items, new Date("2026-09-01T00:00:00Z"));
  const monthGroups = groups.filter((group) => group.bucketKey !== "overdue" && group.bucketKey !== "unknown");
  assert.deepEqual(monthGroups.map((group) => group.bucketKey), [...monthGroups.map((group) => group.bucketKey)].sort());
  assert.equal(monthGroups[0].items[0].sku, "SOONER");
});

test("groupByOrderDeadline puts SKUs with no stockout projection in the unknown bucket, not dropped", () => {
  const items = [makeItem({ sku: "A", recommendedOrder: 5, projectedStockoutDate: null })];
  const groups = groupByOrderDeadline(items, new Date("2026-09-01T00:00:00Z"));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].bucketKey, "unknown");
  assert.equal(groups[0].items[0].sku, "A");
});
