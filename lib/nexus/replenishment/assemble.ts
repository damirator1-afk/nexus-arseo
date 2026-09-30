import type { ReplenishmentInput, ReplenishmentOptions, SkuPlanningConfig } from "./calculation.ts";
import type { InboundShipment, MinimumOrderQuantity, MonthlyOpeningStock, MonthlySales, SalesTransaction, SkuCategory, SkuCurrentStock, SkuReservation, SkuStockBatch, YearMonth } from "./types.ts";

export type ReplenishmentSourceKind = "transactions" | "monthlySales" | "openingStocks" | "inbound" | "moq" | "stockBatches";

export interface SupplierParsedData {
  supplier: string;
  monthlySales: MonthlySales[];
  openingStocks: MonthlyOpeningStock[];
  inboundShipments: InboundShipment[];
  salesTransactions: SalesTransaction[];
  minimumOrderQuantities: MinimumOrderQuantity[];
  categories?: SkuCategory[];
  reservations?: SkuReservation[];
  currentStocks?: SkuCurrentStock[];
  /** Batch-level stock (warehouse + shelf life), when the supplier provides it — see aggregateStockBatches. */
  stockBatches?: SkuStockBatch[];
  /** Exact product names from no-SKU sales rows that could not be reconciled within this supplier. */
  unmatchedProductNames?: string[];
  /** File kinds not supplied by this supplier; retained for transparent UI disclosure. */
  missingSources?: ReplenishmentSourceKind[];
}

export interface ReplenishmentAssemblyMetadata {
  missingSources: Record<string, ReplenishmentSourceKind[]>;
  /** A current-stock-only input has no dated opening-balance month, so the run uses today's month. */
  asOfMonthSource: "opening_stocks" | "current_date";
}

export type AssembledReplenishmentInput = ReplenishmentInput & ReplenishmentAssemblyMetadata;

export interface AssemblyAssumptions {
  defaultLeadTimeMonths: number;
  reviewPeriodMonths: number;
  categoryServiceLevel: Record<string, number>;
  /** Used whenever a supplier file does not expose an SKU category. */
  defaultCategory: string;
  /** External forecast remains independent from the historical trend calculated later. */
  defaultForecastGrowthRate: number;
  forecastGrowthBySku?: Record<string, number>;
  leadTimeBySku?: Record<string, number>;
  /** Batches at or above this % of shelf life remaining count as available stock; below it, excluded. */
  shelfLifeValidityThresholdPercent: number;
}

export const DEFAULT_ASSEMBLY_ASSUMPTIONS: AssemblyAssumptions = {
  // No authoritative lead-time/review SLA was supplied in the workbooks. These explicit, UI-replaceable
  // planning assumptions are deliberately kept outside calculateReplenishment.
  defaultLeadTimeMonths: 2,
  reviewPeriodMonths: 1,
  defaultCategory: "UNCLASSIFIED",
  defaultForecastGrowthRate: 0,
  // Matches the threshold observed in the one real batch-tracked source seen so far; editable in the UI
  // since it is that company's own policy, not a universal constant.
  shelfLifeValidityThresholdPercent: 30,
  // Engineering assumptions until partner-provided service targets exist: top category 98%, middle 95%,
  // lower categories 90%; unclassified SKUs use the neutral 95% target.
  categoryServiceLevel: { "1": 0.98, "2": 0.95, "3": 0.9, "4": 0.9, A: 0.98, B: 0.95, C: 0.9, UNCLASSIFIED: 0.95 },
};

function latestMonth(rows: MonthlyOpeningStock[]): YearMonth | null {
  const months = rows.map((row) => row.month).sort();
  return months.at(-1) ?? null;
}

/**
 * Collapses per-batch stock into one currentStock-shaped record per SKU: sums quantity from batches
 * that pass the shelf-life validity check (no shelf-life data at all counts as valid), keeps the
 * per-warehouse split and the excluded quantity as informational fields, never subtracted again
 * downstream — calculateReplenishment treats the returned currentStock as already "clean".
 */
function aggregateStockBatches(batches: SkuStockBatch[], thresholdPercent: number): SkuCurrentStock[] {
  const bySku = new Map<string, { valid: number; excluded: number; byWarehouse: Record<string, number> }>();
  for (const batch of batches) {
    const entry = bySku.get(batch.sku) ?? { valid: 0, excluded: 0, byWarehouse: {} };
    const isValid = !batch.expired && (batch.shelfLifeRemainingPercent == null || batch.shelfLifeRemainingPercent >= thresholdPercent);
    if (isValid) {
      entry.valid += batch.quantity;
      if (batch.warehouse) entry.byWarehouse[batch.warehouse] = (entry.byWarehouse[batch.warehouse] ?? 0) + batch.quantity;
    } else {
      entry.excluded += batch.quantity;
    }
    bySku.set(batch.sku, entry);
  }
  return [...bySku.entries()].map(([sku, agg]) => ({
    sku,
    currentStock: agg.valid,
    ...(Object.keys(agg.byWarehouse).length ? { stockByWarehouse: agg.byWarehouse } : {}),
    ...(agg.excluded > 0 ? { excludedForShelfLife: agg.excluded } : {}),
  }));
}

export function assembleReplenishmentInput(suppliers: SupplierParsedData[], assumptions: AssemblyAssumptions = DEFAULT_ASSEMBLY_ASSUMPTIONS): AssembledReplenishmentInput {
  if (!suppliers.length) throw new Error("Не переданы данные поставщиков.");
  if (new Set(suppliers.map((item) => item.supplier)).size !== suppliers.length) {
    throw new Error("Названия поставщиков должны быть уникальными.");
  }
  // Supplier scope is attached here rather than in the file parsers: a workbook describes one supplier,
  // while the normalized calculation may contain identical 1C codes from several suppliers.
  const scoped = <T extends { sku: string }>(data: SupplierParsedData, rows: T[]): Array<T & { supplier: string }> =>
    rows.map((row) => ({ ...row, supplier: data.supplier }));
  const monthlySales = suppliers.flatMap((data) => scoped(data, data.monthlySales));
  const openingStocks = suppliers.flatMap((data) => scoped(data, data.openingStocks));
  const inboundShipments = suppliers.flatMap((data) => scoped(data, data.inboundShipments));
  const salesTransactions = suppliers.flatMap((data) => scoped(data, data.salesTransactions));
  const minimumOrderQuantities = suppliers.flatMap((data) => scoped(data, data.minimumOrderQuantities));
  const reservations = suppliers.flatMap((data) => scoped(data, data.reservations ?? []));
  const currentStocks = suppliers.flatMap((data) => {
    // Batch-level stock is more granular than a plain snapshot, so where both exist for the same SKU
    // the batch-derived figure wins; the plain snapshot only fills in SKUs the batches don't cover.
    const batchDerived = aggregateStockBatches(data.stockBatches ?? [], assumptions.shelfLifeValidityThresholdPercent);
    const batchSkus = new Set(batchDerived.map((item) => item.sku));
    const plain = (data.currentStocks ?? []).filter((item) => !batchSkus.has(item.sku));
    return scoped(data, [...batchDerived, ...plain]);
  });
  const skuConfigs: SkuPlanningConfig[] = suppliers.flatMap((data) => {
    const categoryBySku = new Map(data.categories?.map((item) => [item.sku, item.category]));
    return [...new Set(data.monthlySales.map((item) => item.sku))].map((sku) => ({
      sku,
      supplier: data.supplier,
      category: categoryBySku.get(sku) ?? assumptions.defaultCategory,
      forecastGrowthRate: assumptions.forecastGrowthBySku?.[sku] ?? assumptions.defaultForecastGrowthRate,
      ...(assumptions.leadTimeBySku?.[sku] ? { leadTimeMonths: assumptions.leadTimeBySku[sku] } : {}),
    }));
  });
  const categoryServiceLevel = { ...assumptions.categoryServiceLevel };
  for (const config of skuConfigs) if (categoryServiceLevel[config.category] === undefined) categoryServiceLevel[config.category] = categoryServiceLevel[assumptions.defaultCategory] ?? 0.95;
  const latestOpeningStockMonth = latestMonth(openingStocks);
  // A current-stock snapshot carries no authoritative month in the workbook. When every supplier
  // uses snapshots only, today's month is the most honest planning anchor and the metadata below
  // makes that fallback explicit to the user instead of presenting it as a source-file date.
  const asOfMonth = latestOpeningStockMonth
    ?? new Date().toISOString().slice(0, 7) as YearMonth;
  const options: ReplenishmentOptions = {
    asOfMonth,
    defaultLeadTimeMonths: assumptions.defaultLeadTimeMonths,
    reviewPeriodMonths: assumptions.reviewPeriodMonths,
    categoryServiceLevel,
  };
  return {
    monthlySales,
    openingStocks,
    inboundShipments,
    salesTransactions,
    minimumOrderQuantities,
    reservations,
    currentStocks,
    skuConfigs,
    options,
    missingSources: Object.fromEntries(suppliers.map((data) => [data.supplier, [...(data.missingSources ?? [])]])),
    asOfMonthSource: latestOpeningStockMonth ? "opening_stocks" : "current_date",
  };
}
