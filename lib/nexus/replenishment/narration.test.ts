import assert from "node:assert/strict";
import test from "node:test";
import {
  handleReplenishmentNarrationPost,
  narrateReplenishment,
  type NarrationTransportRequest,
  type ReplenishmentNarrationInput,
} from "./narration.ts";

const recommendation: ReplenishmentNarrationInput = {
  sku: "SKU-42",
  productName: "Автоматический выключатель",
  supplier: "Supplier A",
  category: "A",
  baseMonthlyDemand: 12.5,
  seasonalIndex: 1.2,
  seasonalForecast: [{ month: "2026-10", seasonalIndex: 1.2, weight: 1 }],
  historicalGrowthRate: 0.1,
  forecastGrowthRate: 0.05,
  stockoutAdjustmentUnitsPerMonth: 2.25,
  stockoutMonths: ["2026-07"],
  excludedSpikeCount: 1,
  excludedSpikeUnits: 80,
  retainedGrowthSpikeCount: 0,
  retainedGrowthSpikeUnits: 0,
  spikeOrderImpactEstimate: 40,
  openingStockAsOf: 35,
  salesSinceOpening: 15,
  currentStock: 20,
  currentStockSource: "projected_from_opening",
  reservedStock: 4,
  availableStock: 16,
  goodsInTransitWithinHorizon: 7,
  goodsInTransitUnknownEta: 0,
  goodsInTransitAfterHorizon: 0,
  etaAssumptionApplied: false,
  unknownEtaExcluded: false,
  demandStdDev: 3.5,
  serviceLevel: 0.98,
  safetyStockZScore: 2.0537,
  safetyStock: 10.16,
  targetPosition: 51.74,
  currentPosition: 23,
  recommendedOrder: 30,
  urgency: "high",
  demandPattern: "stable",
  nonZeroDemandFrequency: 1,
  forecastMethod: "seasonal_trend",
  exceptions: ["one_off_spike"],
  planningMonthlyDemand: 12.5,
  stockLifecycleStatus: "active",
  daysOfSupply: 38.96,
  isOverstock: false,
  overstockMonths: 0,
  nearestInboundExpectedDate: "2026-10-11",
  projectedStockoutDate: "2026-10-04",
  potentialStockoutDays: 7,
};

test("narration API returns FALLBACK instead of failing when the API key is absent", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const response = await handleReplenishmentNarrationPost(new Request("http://localhost/api/replenishment/narrate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(recommendation),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { narrative: "", source: "FALLBACK" });
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("narration API converts an upstream error to a non-500 FALLBACK", async () => {
  const response = await handleReplenishmentNarrationPost(new Request("http://localhost/api/replenishment/narrate", {
    method: "POST",
    body: JSON.stringify(recommendation),
  }), async () => { throw new Error("upstream unavailable"); });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { narrative: "", source: "FALLBACK" });
});

test("narrator passes the supplied recommendation numbers unchanged and uses strict narration instructions", async () => {
  let captured: NarrationTransportRequest | undefined;
  const result = await narrateReplenishment(recommendation, async (request) => {
    captured = request;
    return JSON.stringify({ narrative: "Рекомендуется заказать 30 единиц с учётом рассчитанной позиции." });
  });

  assert.equal(result.source, "LLM");
  assert.deepEqual(captured?.recommendation, recommendation);
  assert.equal(captured?.model, process.env.OPENAI_MODEL || "gpt-5-mini");
  assert.match(captured?.systemPrompt ?? "", /Не пересчитывай/);
  assert.match(captured?.systemPrompt ?? "", /не добавляй новые числа/);
});

test("narration API rejects malformed input without invoking the narrator", async () => {
  let invoked = false;
  const response = await handleReplenishmentNarrationPost(new Request("http://localhost/api/replenishment/narrate", {
    method: "POST",
    body: JSON.stringify({ ...recommendation, safetyStock: Number.NaN }),
  }), async () => { invoked = true; return { narrative: "", source: "FALLBACK" }; });
  assert.equal(response.status, 400);
  assert.equal(invoked, false);
  assert.deepEqual(await response.json(), { narrative: "", source: "FALLBACK" });
});
