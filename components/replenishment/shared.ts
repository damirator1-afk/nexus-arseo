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
  parseGroupedMonthlyReportRows, parseMonthlySales, parseSalesTransactions, parseSkuCategories, parseSkuCostPrices,
  parseSkuCurrentStocks, parseSkuReservations, parseSkuStockBatches,
  type GroupedMonthlyRow,
} from "../../lib/nexus/replenishment/xlsxParsers.ts";
import type { MonthlyOpeningStock, MonthlySales, SkuCostPrice, SkuStockBatch, XlsxInput } from "../../lib/nexus/replenishment/types.ts";

export type FileKind = ReplenishmentSourceKind;
export type SupplierKey = string;
export type SupplierDefinition = { key: SupplierKey; name: string };
export type FilesState = Record<SupplierKey, Partial<Record<FileKind, File[]>>>;
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
  /** Batches at or above this % of shelf life remaining count as available stock — see stockBatches upload. */
  shelfLifeValidityThresholdPercent: number;
  /** Used only when an uploaded monthly file contains bare month values such as "07". */
  assumedYearForBareMonths?: number;
};
export type DataSource = "demo" | "own";

export const FILE_FIELDS: Array<{ kind: FileKind; label: string; hint: string; missingTreatment: string }> = [
  { kind: "transactions", label: "Динамика продаж", hint: "Транзакции и накладные", missingTreatment: "нет транзакций — разовые всплески не исключаются" },
  { kind: "monthlySales", label: "Продажи по месяцам", hint: "Количество по SKU", missingTreatment: "нет помесячных продаж — рекомендации по спросу не формируются" },
  { kind: "openingStocks", label: "Остатки по месяцам", hint: "Начальный остаток", missingTreatment: "нет помесячных остатков — используется снимок текущего остатка" },
  { kind: "inbound", label: "Товар в пути", hint: "Поставки, остаток и категории", missingTreatment: "нет товара в пути — считается нулевым" },
  { kind: "moq", label: "MOQ / кратность", hint: "Шаг округления заказа", missingTreatment: "нет MOQ — округление не применяется" },
  { kind: "stockBatches", label: "Остатки по партиям (срок годности)", hint: "Склад, партия, срок годности — опционально", missingTreatment: "нет данных по партиям — используется обычный остаток" },
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
  shelfLifeValidityThresholdPercent: DEFAULT_ASSEMBLY_ASSUMPTIONS.shelfLifeValidityThresholdPercent,
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
const clampShelfLifeThreshold = (percentValue: number): number => Math.min(100, Math.max(0, Number.isFinite(percentValue) ? percentValue : 0));
export const csvCell = (value: string | number): string => `"${String(value).replaceAll('"', '""')}"`;

const yieldToBrowser = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type OptionalParser<T extends { sku: string }> = (input: XlsxInput) => T[];

function optionalRowsFromBuffers<T extends { sku: string }>(
  buffers: Partial<Record<FileKind, Uint8Array[]>>,
  parser: OptionalParser<T>,
): T[] {
  // Dashboards/inbound sheets are the usual metadata carrier, so inspect them first. If they do not
  // contain the requested column, continue through every supplied workbook as promised by the upload UI.
  const candidates = Object.entries(buffers)
    .flatMap(([kind, kindBuffers]) => (kindBuffers ?? []).map((buffer) => [kind as FileKind, buffer] as const))
    .sort(([left], [right]) => Number(right === "inbound") - Number(left === "inbound"));
  const collected: T[] = [];
  for (const [, buffer] of candidates) {
    try {
      const rows = parser(buffer);
      for (const row of rows) collected.push(row);
    } catch (error) {
      if (isMissingColumnError(error)) continue;
      throw error;
    }
  }
  return collected;
}

function aggregateMonthlyRows<T extends { sku: string; month: string }>(
  rows: T[],
  valueOf: (row: T) => number,
  withValue: (row: T, value: number) => T,
): T[] {
  const aggregated = new Map<string, T>();
  for (const row of rows) {
    const mapKey = `${row.sku}\u0000${row.month}`;
    const current = aggregated.get(mapKey);
    aggregated.set(mapKey, current ? withValue(current, valueOf(current) + valueOf(row)) : row);
  }
  return [...aggregated.values()];
}

function normalizedProductName(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("ru-RU");
}

function comparableProductName(value: string): string {
  return normalizedProductName(value)
    .replace(/ё/gu, "е")
    .replace(/[^a-zа-я0-9]+/giu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function productTokenSignature(value: string): string {
  return comparableProductName(value).split(" ").filter(Boolean).sort().join(" ");
}

function productNumberSignature(value: string): string {
  return (normalizedProductName(value).match(/\d+(?:[.,]\d+)?/gu) ?? [])
    .map((numberToken) => numberToken.replace(",", "."))
    .sort()
    .join("|");
}

function levenshteinSimilarity(leftValue: string, rightValue: string): number {
  const left = comparableProductName(leftValue);
  const right = comparableProductName(rightValue);
  if (left === right) return 1;
  if (!left || !right) return 0;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const old = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = old;
    }
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}

type IdentityResolution = { found: boolean; sku: string | null };
type ProductIdentityIndex = {
  byName: Map<string, string | null>;
  byTokenSignature: Map<string, string | null>;
  candidates: Array<{ sku: string; productName: string; numberSignature: string }>;
};

function buildProductIdentityIndex(identities: Array<{ sku: string; productName: string }>): ProductIdentityIndex {
  const byName = new Map<string, string | null>();
  const byTokenSignature = new Map<string, string | null>();
  const candidates = new Map<string, { sku: string; productName: string; numberSignature: string }>();
  const addIdentity = (map: Map<string, string | null>, identityKey: string, sku: string): void => {
    if (!identityKey) return;
    const existing = map.get(identityKey);
    if (!map.has(identityKey)) map.set(identityKey, sku);
    else if (existing !== sku) map.set(identityKey, null);
  };

  for (const identity of identities) {
    const normalizedName = normalizedProductName(identity.productName);
    const comparableName = comparableProductName(identity.productName);
    if (!normalizedName || !comparableName) continue;
    addIdentity(byName, normalizedName, identity.sku);
    addIdentity(byTokenSignature, productTokenSignature(identity.productName), identity.sku);
    candidates.set(`${identity.sku}\u0000${comparableName}`, {
      sku: identity.sku,
      productName: identity.productName,
      numberSignature: productNumberSignature(identity.productName),
    });
  }
  return { byName, byTokenSignature, candidates: [...candidates.values()] };
}

function resolveProductIdentity(productName: string, index: ProductIdentityIndex, allowFuzzy = true): IdentityResolution {
  const normalizedName = normalizedProductName(productName);
  if (index.byName.has(normalizedName)) return { found: true, sku: index.byName.get(normalizedName) ?? null };

  // Word order and punctuation are presentation details in the customer's reports. A token signature
  // still requires the complete same set of words and numeric attributes, and conflicting SKUs remain blocked.
  const tokenSignature = productTokenSignature(productName);
  if (index.byTokenSignature.has(tokenSignature)) {
    return { found: true, sku: index.byTokenSignature.get(tokenSignature) ?? null };
  }

  // A coded row already has a usable identity. Typo recovery is only needed for the no-SKU reports
  // and avoiding it here keeps large 3,000+ SKU demo/customer runs linear for the common path.
  if (!allowFuzzy) return { found: false, sku: null };
  const comparableName = comparableProductName(productName);
  if (comparableName.length < 20 || comparableName.split(" ").length < 3) return { found: false, sku: null };
  const numberSignature = productNumberSignature(productName);
  const bestBySku = new Map<string, number>();
  for (const candidate of index.candidates) {
    // Weight, pack size and every other numeric characteristic must agree before typo tolerance is considered.
    if (candidate.numberSignature !== numberSignature) continue;
    const score = levenshteinSimilarity(productName, candidate.productName);
    bestBySku.set(candidate.sku, Math.max(bestBySku.get(candidate.sku) ?? 0, score));
  }
  const ranked = [...bestBySku.entries()].sort((left, right) => right[1] - left[1]);
  const best = ranked[0];
  if (!best || best[1] < 0.94) return { found: false, sku: null };
  const runnerUpScore = ranked[1]?.[1] ?? 0;
  if (best[1] - runnerUpScore < 0.03) return { found: true, sku: null };
  return { found: true, sku: best[0] };
}

function reconcileMonthlySalesRows(
  rows: GroupedMonthlyRow[],
  authoritativeIdentities: Array<{ sku: string; productName: string }> = [],
): {
  monthlySales: MonthlySales[];
  unmatchedProductNames: string[];
} {
  // Stock, transaction, inbound and MOQ files carry the supplier's operational SKU identity. Some
  // sales exports put an EAN barcode in their "Артикул" column instead. An exact-name authoritative
  // match therefore canonicalizes both coded and uncoded sales rows to the operational SKU. The
  // conservative extensions above also tolerate reordered words and very small typos, but only when
  // numeric attributes agree and one SKU is clearly better; conflicts remain blocked rather than guessed.
  const authoritativeIndex = buildProductIdentityIndex(authoritativeIdentities);
  const monthlyIndex = buildProductIdentityIndex(rows.flatMap((row) => (
    row.sku ? [{ sku: row.sku, productName: row.productName }] : []
  )));

  const resolutionCache = new Map<string, IdentityResolution>();

  const resolvedSku = (productName: string): string | null => {
    const normalizedName = normalizedProductName(productName);
    const cached = resolutionCache.get(normalizedName);
    if (cached) return cached.sku;
    const authoritativeResolution = resolveProductIdentity(productName, authoritativeIndex);
    const resolution = authoritativeResolution.found
      ? authoritativeResolution
      : resolveProductIdentity(productName, monthlyIndex);
    resolutionCache.set(normalizedName, resolution);
    return resolution.sku;
  };

  const matched: MonthlySales[] = [];
  const unmatched = new Map<string, string>();
  for (const row of rows) {
    if (row.sku) {
      const authoritativeResolution = resolveProductIdentity(row.productName, authoritativeIndex, false);
      matched.push({ ...row, sku: authoritativeResolution.sku || row.sku });
      continue;
    }
    const normalizedName = normalizedProductName(row.productName);
    const matchedSku = resolvedSku(row.productName);
    if (matchedSku) {
      matched.push({ ...row, sku: matchedSku });
    } else if (normalizedName && !unmatched.has(normalizedName)) {
      unmatched.set(normalizedName, row.productName.trim().replace(/\s+/gu, " "));
    }
  }

  return {
    monthlySales: aggregateMonthlyRows(matched, (row) => row.unitsSold, (row, unitsSold) => ({ ...row, unitsSold })),
    unmatchedProductNames: [...unmatched.values()],
  };
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
  buffers: Partial<Record<FileKind, Uint8Array[]>>,
  onProgress?: (label: string) => void,
  optionalSourceKinds?: FileKind[],
  assumedYearForBareMonths?: number,
): Promise<SupplierParsedData> {
  const parseProvided = async <T,>(kind: FileKind, label: string, parser: (input: XlsxInput) => T[]): Promise<T[]> => {
    const kindBuffers = buffers[kind] ?? [];
    const collected: T[] = [];
    for (const [index, buffer] of kindBuffers.entries()) {
      onProgress?.(`${supplier.name}: ${label}${kindBuffers.length > 1 ? ` (${index + 1}/${kindBuffers.length})` : ""}…`);
      try {
        for (const row of parser(buffer)) collected.push(row);
      } catch (error) {
        const reason = isMissingColumnError(error)
          ? "не нашли ожидаемые колонки — проверьте, что это тот файл и в нём есть нужные заголовки (артикул/код 1С, дата, количество и т.д.)"
          : error instanceof Error ? error.message : "не удалось прочитать файл";
        const fileNumber = kindBuffers.length > 1 ? ` №${index + 1}` : "";
        throw new Error(`Поставщик «${supplier.name}», файл «${label}${fileNumber}»: ${reason}.`);
      }
      await yieldToBrowser();
    }
    return collected;
  };

  const salesTransactions = await parseProvided("transactions", "динамика продаж", parseSalesTransactions);
  const monthlySalesRows = await parseProvided<GroupedMonthlyRow>("monthlySales", "продажи по месяцам", (input) => {
    try {
      return parseMonthlySales(input, undefined, assumedYearForBareMonths);
    } catch (ordinaryError) {
      if (!isMissingColumnError(ordinaryError)) throw ordinaryError;
      try {
        return parseGroupedMonthlyReportRows(input);
      } catch (groupedError) {
        const ordinaryReason = ordinaryError instanceof Error ? ordinaryError.message : "неизвестная ошибка";
        const groupedReason = groupedError instanceof Error ? groupedError.message : "неизвестная ошибка";
        throw new Error(`Не подошёл ни обычный помесячный формат (${ordinaryReason}), ни иерархический отчёт 1С (${groupedReason})`);
      }
    }
  });
  const stockBatchesFromOpeningStocks: SkuStockBatch[] = [];
  const openingStockRows = await parseProvided<MonthlyOpeningStock>("openingStocks", "остатки по месяцам", (input) => {
    try {
      return parseMonthlyOpeningStock(input, undefined, assumedYearForBareMonths);
    } catch (monthlyError) {
      const isStructuralMismatch = isMissingColumnError(monthlyError)
        || (monthlyError instanceof Error && monthlyError.message === "No monthly columns were found.");
      if (!isStructuralMismatch) throw monthlyError;
      try {
        stockBatchesFromOpeningStocks.push(...parseSkuStockBatches(input));
        return [];
      } catch (batchError) {
        const monthlyReason = monthlyError instanceof Error ? monthlyError.message : "неизвестная ошибка";
        const batchReason = batchError instanceof Error ? batchError.message : "неизвестная ошибка";
        throw new Error(`Не подошёл ни помесячный формат (${monthlyReason}), ни формат остатков по партиям/складам (${batchReason})`);
      }
    }
  });
  const openingStocks = aggregateMonthlyRows(openingStockRows, (row) => row.openingStock, (row, openingStock) => ({ ...row, openingStock }));
  const inboundShipments = await parseProvided("inbound", "товар в пути", parseInboundShipments);
  const minimumOrderQuantities = await parseProvided("moq", "MOQ и кратность", parseMinimumOrderQuantities);
  const stockBatches = [
    ...stockBatchesFromOpeningStocks,
    ...await parseProvided("stockBatches", "остатки по партиям", parseSkuStockBatches),
  ];
  const { monthlySales, unmatchedProductNames } = reconcileMonthlySalesRows(monthlySalesRows, [
    ...salesTransactions,
    ...openingStocks,
    ...inboundShipments,
    ...minimumOrderQuantities,
    ...stockBatches.flatMap((batch) => batch.productName ? [{ sku: batch.sku, productName: batch.productName }] : []),
  ]);

  onProgress?.(`${supplier.name}: дополнительные поля…`);
  const optionalBuffers = optionalSourceKinds
    ? Object.fromEntries(optionalSourceKinds.flatMap((kind) => buffers[kind]?.length ? [[kind, buffers[kind]]] : []))
    : buffers;
  const categories = optionalRowsFromBuffers(optionalBuffers, parseSkuCategories);
  const reservations = optionalRowsFromBuffers(optionalBuffers, parseSkuReservations);
  const currentStocks = optionalRowsFromBuffers(optionalBuffers, parseSkuCurrentStocks);
  await yieldToBrowser();

  if (!openingStocks.length && !currentStocks.length && !stockBatches.length) {
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
    stockBatches,
    ...(unmatchedProductNames.length ? { unmatchedProductNames } : {}),
    missingSources: FILE_FIELDS.filter((field) => !buffers[field.kind]?.length).map((field) => field.kind),
  };
}

async function fileArraysToBuffers(files: Partial<Record<FileKind, File[]>>): Promise<Partial<Record<FileKind, Uint8Array[]>>> {
  const entries = await Promise.all(Object.entries(files).map(async ([kind, kindFiles]) => [
    kind as FileKind,
    await Promise.all((kindFiles ?? []).map(async (file) => new Uint8Array(await file.arrayBuffer()))),
  ] as const));
  return Object.fromEntries(entries);
}

/** Reads only the files selected for one supplier; absent kinds remain explicit empty sources. */
export async function parseSupplierFromFiles(
  supplier: SupplierDefinition,
  files: Partial<Record<FileKind, File[]>>,
  onProgress?: (label: string) => void,
  assumedYearForBareMonths?: number,
): Promise<SupplierParsedData> {
  return buildSupplierParsedData(supplier, await fileArraysToBuffers(files), onProgress, undefined, assumedYearForBareMonths);
}

export async function parseSupplierCostPrices(files: Partial<Record<FileKind, File[]>>): Promise<SkuCostPrice[]> {
  return optionalRowsFromBuffers(await fileArraysToBuffers(files), parseSkuCostPrices);
}

export function parseSupplierCostPricesFromBuffers(buffers: Partial<Record<FileKind, Uint8Array[]>>): SkuCostPrice[] {
  return optionalRowsFromBuffers(buffers, parseSkuCostPrices);
}

export function supplierMissingTreatments(files: Partial<Record<FileKind, readonly unknown[]>>): string[] {
  return FILE_FIELDS.filter((field) => !files[field.kind]?.length).map((field) => field.missingTreatment);
}

export function buildAssumptions(planning: PlanningControls): AssemblyAssumptions {
  return {
    ...DEFAULT_ASSEMBLY_ASSUMPTIONS,
    defaultLeadTimeMonths: Math.max(0.1, planning.leadTimeMonths),
    reviewPeriodMonths: Math.max(0, planning.reviewPeriodMonths),
    defaultForecastGrowthRate: Math.max(-99, planning.forecastGrowthPercent) / 100,
    shelfLifeValidityThresholdPercent: clampShelfLifeThreshold(planning.shelfLifeValidityThresholdPercent),
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
  const warehouseNote = item.stockByWarehouse
    ? ` По складам: ${Object.entries(item.stockByWarehouse).map(([warehouse, qty]) => `${warehouse} ${number.format(qty)}`).join(", ")}.`
    : "";
  const shelfLifeNote = item.expiringStockExcluded > 0
    ? ` Под риском списания (не входит в остаток): ${number.format(item.expiringStockExcluded)} ед.`
    : "";
  return `Тип спроса: ${demandPatternLabel[item.demandPattern]}, статус SKU: ${lifecycleLabel[item.stockLifecycleStatus]}, плановый спрос ${number.format(item.planningMonthlyDemand)} ед./мес. Базовый спрос ${number.format(item.baseMonthlyDemand)} ед./мес.; средняя сезонность будущего горизонта ×${number.format(item.seasonalIndex)} (${seasonalPath}); исторический рост ${percent.format(item.historicalGrowthRate)}; внешний прогноз ${percent.format(item.forecastGrowthRate)}. Поправка stockout: +${number.format(item.stockoutAdjustmentUnitsPerMonth)} ед./мес. (${item.stockoutMonths.length} мес.); исключено всплесков: ${item.excludedSpikeCount} на ${number.format(item.excludedSpikeUnits)} ед., оценка влияния на заказ ${number.format(item.spikeOrderImpactEstimate)} ед.; сохранено повторных крупных продаж: ${item.retainedGrowthSpikeCount}. Страховой запас ${number.format(item.safetyStock)} = z ${number.format(item.safetyStockZScore)} × σ ${number.format(item.demandStdDev)} × √горизонта, уровень сервиса ${percent.format(item.serviceLevel)}. Позиция: остаток ${number.format(item.currentStock)} (${stockBasis}) − резерв ${number.format(item.reservedStock)} + подтверждённо в пути ${number.format(item.goodsInTransitWithinHorizon)}; без точного ETA ${number.format(item.goodsInTransitUnknownEta)} не уменьшает заказ, после горизонта ${number.format(item.goodsInTransitAfterHorizon)}; доступный остаток ${number.format(item.availableStock)}, целевой уровень ${number.format(item.targetPosition)}.${warehouseNote}${shelfLifeNote}`;
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
