import type { ReplenishmentInput, ReplenishmentOptions, SkuPlanningConfig } from "./calculation.ts";
import type { InboundShipment, MinimumOrderQuantity, MonthlyOpeningStock, MonthlySales, SalesTransaction, SkuCategory, SkuCurrentStock, SkuReservation, YearMonth } from "./types.ts";

export type ReplenishmentSourceKind = "transactions" | "monthlySales" | "openingStocks" | "inbound" | "moq";

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
}

export const DEFAULT_ASSEMBLY_ASSUMPTIONS: AssemblyAssumptions = {
  // No authoritative lead-time/review SLA was supplied in the workbooks. These explicit, UI-replaceable
  // planning assumptions are deliberately kept outside calculateReplenishment.
  defaultLeadTimeMonths: 2,
  reviewPeriodMonths: 1,
  defaultCategory: "UNCLASSIFIED",
  defaultForecastGrowthRate: 0,
  // Engineering assumptions until partner-provided service targets exist: top category 98%, middle 95%,
  // lower categories 90%; unclassified SKUs use the neutral 95% target.
  categoryServiceLevel: { "1": 0.98, "2": 0.95, "3": 0.9, "4": 0.9, A: 0.98, B: 0.95, C: 0.9, UNCLASSIFIED: 0.95 },
};

function latestMonth(rows: MonthlyOpeningStock[]): YearMonth | null {
  const months = rows.map((row) => row.month).sort();
  return months.at(-1) ?? null;
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
  const currentStocks = suppliers.flatMap((data) => scoped(data, data.currentStocks ?? []));
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
