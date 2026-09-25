import { DEFAULT_ASSEMBLY_ASSUMPTIONS, type AssemblyAssumptions, type SupplierParsedData } from "@/lib/nexus/replenishment/assemble";
import type { ReplenishmentRecommendation } from "@/lib/nexus/replenishment/calculation";
import type { ReplenishmentNarrationInput } from "@/lib/nexus/replenishment/narration";
import {
  parseInboundShipments, parseMinimumOrderQuantities, parseMonthlyOpeningStock, parseMonthlySales,
  parseSalesTransactions, parseSkuCategories, parseSkuCurrentStocks, parseSkuReservations,
} from "@/lib/nexus/replenishment/xlsxParsers";

export type FileKind = "transactions" | "monthlySales" | "openingStocks" | "inbound" | "moq";
export type SupplierKey = "iek" | "systeme";
export type FilesState = Record<SupplierKey, Partial<Record<FileKind, File>>>;
export type ExceptionView = "all" | "urgent" | "anomaly" | "supply" | "surplus";
export type ManagerDecision = { quantity: number; status: "draft" | "confirmed" };
export type PlanningControls = {
  leadTimeMonths: number;
  reviewPeriodMonths: number;
  forecastGrowthPercent: number;
  serviceLevelA: number;
  serviceLevelB: number;
  serviceLevelC: number;
  unclassifiedServiceLevel: number;
};
export type DataSource = "demo" | "own";

export const FILE_FIELDS: Array<{ kind: FileKind; label: string; hint: string }> = [
  { kind: "transactions", label: "Динамика продаж", hint: "Транзакции и накладные" },
  { kind: "monthlySales", label: "Продажи по месяцам", hint: "Количество по SKU" },
  { kind: "openingStocks", label: "Остатки по месяцам", hint: "Начальный остаток" },
  { kind: "inbound", label: "Товар в пути", hint: "Поставки и категории" },
  { kind: "moq", label: "MOQ / кратность", hint: "Шаг округления заказа" },
];
export const SUPPLIERS: Array<{ key: SupplierKey; name: string; code: string }> = [
  { key: "iek", name: "IEK", code: "01" },
  { key: "systeme", name: "Systeme Electric", code: "02" },
];

export const DEFAULT_PLANNING: PlanningControls = {
  leadTimeMonths: DEFAULT_ASSEMBLY_ASSUMPTIONS.defaultLeadTimeMonths,
  reviewPeriodMonths: DEFAULT_ASSEMBLY_ASSUMPTIONS.reviewPeriodMonths,
  forecastGrowthPercent: DEFAULT_ASSEMBLY_ASSUMPTIONS.defaultForecastGrowthRate * 100,
  serviceLevelA: 98,
  serviceLevelB: 95,
  serviceLevelC: 90,
  unclassifiedServiceLevel: 95,
};

export const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
export const percent = new Intl.NumberFormat("ru-RU", { style: "percent", maximumFractionDigits: 0 });
/** KZT cost figures are presentation-only (see SkuCostPrice) — never fed into the calculation. */
export const money = (value: number): string => `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value)} ₸`;
export const urgencyLabel = { high: "Срочно", medium: "Контроль", low: "Планово" } as const;
export const urgencyRank = { high: 0, medium: 1, low: 2 } as const;
export const demandPatternLabel = { stable: "Стабильный", volatile: "Волатильный", intermittent: "Прерывистый" } as const;
export const lifecycleLabel = { active: "Активный", slow: "Медленный", dead: "Мёртвый запас" } as const;
export const exceptionViews: Array<{ key: ExceptionView; label: string }> = [
  { key: "all", label: "Все SKU" }, { key: "urgent", label: "Заказать сейчас" },
  { key: "anomaly", label: "Аномалии спроса" }, { key: "supply", label: "Риски поставки" },
  { key: "surplus", label: "Избыток" },
];

export function matchesExceptionView(item: ReplenishmentRecommendation, view: ExceptionView): boolean {
  if (view === "urgent") return item.urgency === "high";
  if (view === "anomaly") return item.exceptions.some((value) => ["stockout", "one_off_spike", "sustained_growth_signal", "slow_stock", "dead_stock"].includes(value));
  if (view === "supply") return item.exceptions.some((value) => ["unknown_eta", "inbound_after_horizon"].includes(value));
  if (view === "surplus") return item.exceptions.includes("surplus");
  return true;
}

export function validManagerQuantity(quantity: number, moq: number | null): number {
  const safe = Math.max(0, Number.isFinite(quantity) ? quantity : 0);
  return moq && safe > 0 ? Math.ceil(safe / moq) * moq : safe;
}

const clampServiceLevel = (percentValue: number): number => Math.min(99.5, Math.max(90, percentValue)) / 100;
export const csvCell = (value: string | number): string => `"${String(value).replaceAll('"', '""')}"`;

const yieldToBrowser = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Pure composition of the five per-supplier parsers — shared by both the manual-upload and
 * demo-fetch paths. Real partner workbooks run to hundreds of thousands of rows (IEK's sales
 * history alone is ~170k transactions); each parser call is itself a long synchronous block, so
 * this yields to the browser between steps (and reports `onProgress`) rather than running all
 * five as one uninterrupted multi-second block that would freeze clicks and repaints entirely.
 */
export async function buildSupplierParsedData(
  key: SupplierKey,
  buffers: Record<FileKind, Uint8Array>,
  onProgress?: (label: string) => void,
): Promise<SupplierParsedData> {
  const supplierName = key === "iek" ? "IEK" : "Systeme Electric";

  onProgress?.(`${supplierName}: динамика продаж…`);
  const salesTransactions = parseSalesTransactions(buffers.transactions);
  await yieldToBrowser();

  onProgress?.(`${supplierName}: продажи по месяцам…`);
  const monthlySales = parseMonthlySales(buffers.monthlySales);
  await yieldToBrowser();

  onProgress?.(`${supplierName}: остатки по месяцам…`);
  const openingStocks = parseMonthlyOpeningStock(buffers.openingStocks);
  await yieldToBrowser();

  onProgress?.(`${supplierName}: товар в пути…`);
  const inboundShipments = parseInboundShipments(buffers.inbound);
  await yieldToBrowser();

  onProgress?.(`${supplierName}: MOQ и кратность…`);
  const minimumOrderQuantities = parseMinimumOrderQuantities(buffers.moq);
  await yieldToBrowser();

  let extras: Pick<SupplierParsedData, "categories" | "reservations" | "currentStocks"> = { reservations: [], currentStocks: [] };
  if (key === "systeme") {
    onProgress?.(`${supplierName}: категории, резервы, остатки…`);
    extras = {
      categories: parseSkuCategories(buffers.inbound),
      reservations: parseSkuReservations(buffers.inbound),
      currentStocks: parseSkuCurrentStocks(buffers.inbound),
    };
    await yieldToBrowser();
  }

  return { supplier: supplierName, salesTransactions, monthlySales, openingStocks, inboundShipments, minimumOrderQuantities, ...extras };
}

/** Reads the 5 user-selected Files for one supplier and hands them to `buildSupplierParsedData`. */
export async function parseSupplierFromFiles(key: SupplierKey, files: Partial<Record<FileKind, File>>, onProgress?: (label: string) => void): Promise<SupplierParsedData> {
  for (const field of FILE_FIELDS) if (!files[field.kind]) throw new Error(`Не выбран файл «${field.label}» для ${key === "iek" ? "IEK" : "Systeme Electric"}.`);
  const entries = await Promise.all(FILE_FIELDS.map(async (field) => [field.kind, new Uint8Array(await files[field.kind]!.arrayBuffer())] as const));
  return buildSupplierParsedData(key, Object.fromEntries(entries) as Record<FileKind, Uint8Array>, onProgress);
}

export function buildAssumptions(planning: PlanningControls): AssemblyAssumptions {
  return {
    ...DEFAULT_ASSEMBLY_ASSUMPTIONS,
    defaultLeadTimeMonths: Math.max(0.1, planning.leadTimeMonths),
    reviewPeriodMonths: Math.max(0, planning.reviewPeriodMonths),
    defaultForecastGrowthRate: Math.max(-99, planning.forecastGrowthPercent) / 100,
    categoryServiceLevel: {
      ...DEFAULT_ASSEMBLY_ASSUMPTIONS.categoryServiceLevel,
      "1": clampServiceLevel(planning.serviceLevelA), A: clampServiceLevel(planning.serviceLevelA),
      "2": clampServiceLevel(planning.serviceLevelB), B: clampServiceLevel(planning.serviceLevelB),
      "3": clampServiceLevel(planning.serviceLevelC), "4": clampServiceLevel(planning.serviceLevelC), C: clampServiceLevel(planning.serviceLevelC),
      UNCLASSIFIED: clampServiceLevel(planning.unclassifiedServiceLevel),
    },
  };
}

export function explanation(item: ReplenishmentRecommendation): string {
  const seasonalPath = item.seasonalForecast.map((month) => `${month.month} ×${number.format(month.seasonalIndex)}`).join(", ");
  const stockBasis = item.currentStockSource === "explicit_snapshot"
    ? "фактический снимок"
    : `оценка: начальный остаток ${number.format(item.openingStockAsOf)} − продажи ${number.format(item.salesSinceOpening)}`;
  return `Тип спроса: ${demandPatternLabel[item.demandPattern]}, статус SKU: ${lifecycleLabel[item.stockLifecycleStatus]}, плановый спрос ${number.format(item.planningMonthlyDemand)} ед./мес. Базовый спрос ${number.format(item.baseMonthlyDemand)} ед./мес.; средняя сезонность будущего горизонта ×${number.format(item.seasonalIndex)} (${seasonalPath}); исторический рост ${percent.format(item.historicalGrowthRate)}; внешний прогноз ${percent.format(item.forecastGrowthRate)}. Поправка stockout: +${number.format(item.stockoutAdjustmentUnitsPerMonth)} ед./мес. (${item.stockoutMonths.length} мес.); исключено всплесков: ${item.excludedSpikeCount} на ${number.format(item.excludedSpikeUnits)} ед., оценка влияния на заказ ${number.format(item.spikeOrderImpactEstimate)} ед.; сохранено повторных крупных продаж: ${item.retainedGrowthSpikeCount}. Страховой запас ${number.format(item.safetyStock)} = z ${number.format(item.safetyStockZScore)} × σ ${number.format(item.demandStdDev)} × √горизонта, уровень сервиса ${percent.format(item.serviceLevel)}. Позиция: остаток ${number.format(item.currentStock)} (${stockBasis}) − резерв ${number.format(item.reservedStock)} + подтверждённо в пути ${number.format(item.goodsInTransitWithinHorizon)}; без точного ETA ${number.format(item.goodsInTransitUnknownEta)} не уменьшает заказ, после горизонта ${number.format(item.goodsInTransitAfterHorizon)}; доступный остаток ${number.format(item.availableStock)}, целевой уровень ${number.format(item.targetPosition)}.`;
}

export function narrationInput(item: ReplenishmentRecommendation): ReplenishmentNarrationInput {
  const {
    sku, productName, supplier, category, baseMonthlyDemand, seasonalIndex, seasonalForecast, historicalGrowthRate,
    forecastGrowthRate, stockoutAdjustmentUnitsPerMonth, stockoutMonths, excludedSpikeCount,
    excludedSpikeUnits, retainedGrowthSpikeCount, retainedGrowthSpikeUnits, spikeOrderImpactEstimate,
    openingStockAsOf, salesSinceOpening, currentStock, currentStockSource, reservedStock, availableStock, goodsInTransitWithinHorizon, goodsInTransitUnknownEta,
    goodsInTransitAfterHorizon, etaAssumptionApplied, unknownEtaExcluded, demandPattern, nonZeroDemandFrequency, forecastMethod, exceptions,
    planningMonthlyDemand, stockLifecycleStatus, daysOfSupply, isOverstock, overstockMonths,
    nearestInboundExpectedDate, projectedStockoutDate, potentialStockoutDays,
    demandStdDev, serviceLevel, safetyStockZScore, safetyStock, targetPosition, currentPosition,
    recommendedOrder, urgency,
  } = item;
  return {
    sku, productName, supplier, category, baseMonthlyDemand, seasonalIndex, seasonalForecast, historicalGrowthRate,
    forecastGrowthRate, stockoutAdjustmentUnitsPerMonth, stockoutMonths, excludedSpikeCount,
    excludedSpikeUnits, retainedGrowthSpikeCount, retainedGrowthSpikeUnits, spikeOrderImpactEstimate,
    openingStockAsOf, salesSinceOpening, currentStock, currentStockSource, reservedStock, availableStock, goodsInTransitWithinHorizon, goodsInTransitUnknownEta,
    goodsInTransitAfterHorizon, etaAssumptionApplied, unknownEtaExcluded, demandPattern, nonZeroDemandFrequency, forecastMethod, exceptions,
    planningMonthlyDemand, stockLifecycleStatus, daysOfSupply, isOverstock, overstockMonths,
    nearestInboundExpectedDate, projectedStockoutDate, potentialStockoutDays,
    demandStdDev, serviceLevel, safetyStockZScore, safetyStock, targetPosition, currentPosition,
    recommendedOrder, urgency,
  };
}
