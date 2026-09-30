import {
  DEFAULT_ASSEMBLY_ASSUMPTIONS,
  type AssemblyAssumptions,
  type ReplenishmentSourceKind,
  type SupplierParsedData,
} from "../../lib/nexus/replenishment/assemble.ts";
import type { ReplenishmentRecommendation } from "../../lib/nexus/replenishment/calculation.ts";
import type { ReplenishmentNarrationInput } from "../../lib/nexus/replenishment/narration.ts";
import {
  isMissingColumnError, parseInboundShipments, parseMinimumOrderQuantities, parseMonthlyOpeningStock,
  parseMonthlySales, parseSalesTransactions, parseSkuCategories, parseSkuCostPrices,
  parseSkuCurrentStocks, parseSkuReservations,
} from "../../lib/nexus/replenishment/xlsxParsers.ts";
import type { SkuCostPrice, XlsxInput } from "../../lib/nexus/replenishment/types.ts";

export type FileKind = ReplenishmentSourceKind;
export type SupplierKey = string;
export type SupplierDefinition = { key: SupplierKey; name: string };
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

export const FILE_FIELDS: Array<{ kind: FileKind; label: string; hint: string; missingTreatment: string }> = [
  { kind: "transactions", label: "Динамика продаж", hint: "Транзакции и накладные", missingTreatment: "нет транзакций — разовые всплески не исключаются" },
  { kind: "monthlySales", label: "Продажи по месяцам", hint: "Количество по SKU", missingTreatment: "нет помесячных продаж — рекомендации по спросу не формируются" },
  { kind: "openingStocks", label: "Остатки по месяцам", hint: "Начальный остаток", missingTreatment: "нет помесячных остатков — используется снимок текущего остатка" },
  { kind: "inbound", label: "Товар в пути", hint: "Поставки, остаток и категории", missingTreatment: "нет товара в пути — считается нулевым" },
  { kind: "moq", label: "MOQ / кратность", hint: "Шаг округления заказа", missingTreatment: "нет MOQ — округление не применяется" },
];

export const createInitialManualSuppliers = (): SupplierDefinition[] => [{ key: "supplier-1", name: "Поставщик 1" }];

const CYRILLIC_SLUG: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

export function supplierKeyFromName(name: string, occupied: Iterable<string>): string {
  const base = [...name.trim().toLocaleLowerCase("ru-RU")]
    .map((character) => CYRILLIC_SLUG[character] ?? character)
    .join("")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "supplier";
  const used = new Set(occupied);
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

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
export const supplierSkuKey = (supplier: string, sku: string): string => `${supplier}\u0000${sku}`;
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

type OptionalParser<T extends { sku: string }> = (input: XlsxInput) => T[];

function optionalRowsFromBuffers<T extends { sku: string }>(
  buffers: Partial<Record<FileKind, Uint8Array>>,
  parser: OptionalParser<T>,
): T[] {
  // Dashboards/inbound sheets are the usual metadata carrier, so inspect them first. If they do not
  // contain the requested column, continue through every supplied workbook as promised by the upload UI.
  const candidates = Object.entries(buffers).sort(([left], [right]) => Number(right === "inbound") - Number(left === "inbound"));
  for (const [, buffer] of candidates) {
    if (!buffer) continue;
    try {
      const rows = parser(buffer);
      if (rows.length) return rows;
    } catch (error) {
      if (isMissingColumnError(error)) continue;
      throw error;
    }
  }
  return [];
}

export class MissingStockSourceError extends Error {
  readonly supplierKey: string;

  constructor(supplierKey: string, supplierName: string) {
    super(`Для поставщика «${supplierName}» нужен хотя бы один источник остатка: помесячные остатки или файл со столбцом «Остаток».`);
    this.name = "MissingStockSourceError";
    this.supplierKey = supplierKey;
  }
}

/**
 * Pure composition of the five per-supplier parsers — shared by both the manual-upload and
 * demo-fetch paths. Real partner workbooks run to hundreds of thousands of rows (IEK's sales
 * history alone is ~170k transactions); each parser call is itself a long synchronous block, so
 * this yields to the browser between steps (and reports `onProgress`) rather than running all
 * five as one uninterrupted multi-second block that would freeze clicks and repaints entirely.
 */
export async function buildSupplierParsedData(
  supplier: SupplierDefinition,
  buffers: Partial<Record<FileKind, Uint8Array>>,
  onProgress?: (label: string) => void,
  optionalSourceKinds?: FileKind[],
): Promise<SupplierParsedData> {
  const parseProvided = async <T,>(kind: FileKind, label: string, parser: (input: XlsxInput) => T[]): Promise<T[]> => {
    const buffer = buffers[kind];
    if (!buffer) return [];
    onProgress?.(`${supplier.name}: ${label}…`);
    const rows = parser(buffer);
    await yieldToBrowser();
    return rows;
  };

  const salesTransactions = await parseProvided("transactions", "динамика продаж", parseSalesTransactions);
  const monthlySales = await parseProvided("monthlySales", "продажи по месяцам", parseMonthlySales);
  const openingStocks = await parseProvided("openingStocks", "остатки по месяцам", parseMonthlyOpeningStock);
  const inboundShipments = await parseProvided("inbound", "товар в пути", parseInboundShipments);
  const minimumOrderQuantities = await parseProvided("moq", "MOQ и кратность", parseMinimumOrderQuantities);

  onProgress?.(`${supplier.name}: дополнительные поля…`);
  const optionalBuffers = optionalSourceKinds
    ? Object.fromEntries(optionalSourceKinds.flatMap((kind) => buffers[kind] ? [[kind, buffers[kind]]] : []))
    : buffers;
  const categories = optionalRowsFromBuffers(optionalBuffers, parseSkuCategories);
  const reservations = optionalRowsFromBuffers(optionalBuffers, parseSkuReservations);
  const currentStocks = optionalRowsFromBuffers(optionalBuffers, parseSkuCurrentStocks);
  await yieldToBrowser();

  if (!openingStocks.length && !currentStocks.length) {
    throw new MissingStockSourceError(supplier.key, supplier.name);
  }

  return {
    supplier: supplier.name.trim(),
    salesTransactions,
    monthlySales,
    openingStocks,
    inboundShipments,
    minimumOrderQuantities,
    categories,
    reservations,
    currentStocks,
    missingSources: FILE_FIELDS.filter((field) => !buffers[field.kind]).map((field) => field.kind),
  };
}

/** Reads only the files selected for one supplier; absent kinds remain explicit empty sources. */
export async function parseSupplierFromFiles(
  supplier: SupplierDefinition,
  files: Partial<Record<FileKind, File>>,
  onProgress?: (label: string) => void,
): Promise<SupplierParsedData> {
  const entries = await Promise.all(Object.entries(files).flatMap(([kind, file]) => file
    ? [file.arrayBuffer().then((buffer) => [kind as FileKind, new Uint8Array(buffer)] as const)]
    : []));
  return buildSupplierParsedData(supplier, Object.fromEntries(entries), onProgress);
}

export async function parseSupplierCostPrices(files: Partial<Record<FileKind, File>>): Promise<SkuCostPrice[]> {
  const entries = await Promise.all(Object.entries(files).flatMap(([kind, file]) => file
    ? [file.arrayBuffer().then((buffer) => [kind as FileKind, new Uint8Array(buffer)] as const)]
    : []));
  return optionalRowsFromBuffers(Object.fromEntries(entries), parseSkuCostPrices);
}

export function parseSupplierCostPricesFromBuffers(buffers: Partial<Record<FileKind, Uint8Array>>): SkuCostPrice[] {
  return optionalRowsFromBuffers(buffers, parseSkuCostPrices);
}

export function supplierMissingTreatments(files: Partial<Record<FileKind, unknown>>): string[] {
  return FILE_FIELDS.filter((field) => !files[field.kind]).map((field) => field.missingTreatment);
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
