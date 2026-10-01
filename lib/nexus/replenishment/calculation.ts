import type {
  InboundShipment,
  MinimumOrderQuantity,
  MonthlyOpeningStock,
  MonthlySales,
  SalesTransaction,
  SkuCurrentStock,
  SkuReservation,
  YearMonth,
} from "./types.ts";

export interface SkuPlanningConfig {
  sku: string;
  supplier: string;
  category: string;
  /** Planner-provided forecast expressed as a decimal rate: 0.10 means +10%. */
  forecastGrowthRate: number;
  leadTimeMonths?: number;
}

export interface ReplenishmentOptions {
  asOfMonth: YearMonth;
  /** Required fallback: never hidden as a hard-coded lead time. */
  defaultLeadTimeMonths: number;
  reviewPeriodMonths: number;
  /** Category -> target service level as a probability, e.g. 0.98. */
  categoryServiceLevel: Record<string, number>;
  trendWindowMonths?: number;
  maxAbsoluteHistoricalGrowthRate?: number;
  stockoutOpeningStockThreshold?: number;
  stockoutNeighborDemandMinimum?: number;
  /** Maximum observed/normal-neighbour demand ratio for a zero-stock month to be treated as constrained. */
  stockoutDemandSuppressionRatio?: number;
}

export interface ReplenishmentInput {
  monthlySales: MonthlySales[];
  openingStocks: MonthlyOpeningStock[];
  inboundShipments: InboundShipment[];
  salesTransactions: SalesTransaction[];
  skuConfigs: SkuPlanningConfig[];
  minimumOrderQuantities?: MinimumOrderQuantity[];
  reservations?: SkuReservation[];
  currentStocks?: SkuCurrentStock[];
  options: ReplenishmentOptions;
}

export type ReplenishmentUrgency = "high" | "medium" | "low";
export type DemandPattern = "stable" | "volatile" | "intermittent";
export type ReplenishmentException = "stockout" | "one_off_spike" | "sustained_growth_signal" | "unknown_eta" | "inbound_after_horizon" | "surplus" | "slow_stock" | "dead_stock" | "expiring_stock";
export type StockLifecycleStatus = "active" | "slow" | "dead";
export type CurrentStockSource = "explicit_snapshot" | "projected_from_opening";

export interface SeasonalForecastMonth {
  month: YearMonth;
  seasonalIndex: number;
  weight: number;
}

export interface ReplenishmentRecommendation {
  sku: string;
  productName: string;
  supplier: string;
  category: string;
  baseMonthlyDemand: number;
  rawMonthlyDemand: number;
  /** Demand-weighted seasonal index across the future lead-time + review horizon. */
  seasonalIndex: number;
  seasonalForecast: SeasonalForecastMonth[];
  historicalGrowthRate: number;
  forecastGrowthRate: number;
  combinedGrowthFactor: number;
  adjustedDemandRate: number;
  planningMonthlyDemand: number;
  stockLifecycleStatus: StockLifecycleStatus;
  stockoutAdjustmentUnitsPerMonth: number;
  stockoutCompensationFactor: number;
  stockoutMonths: YearMonth[];
  excludedSpikeCount: number;
  excludedSpikeUnits: number;
  excludedSpikeTransactionIds: string[];
  retainedGrowthSpikeCount: number;
  retainedGrowthSpikeUnits: number;
  spikeOrderImpactEstimate: number;
  openingStockAsOf: number;
  salesSinceOpening: number;
  currentStock: number;
  currentStockSource: CurrentStockSource;
  /** Present only when the stock source tracks physical locations — informational, already summed into currentStock. */
  stockByWarehouse?: Record<string, number>;
  /** Units held but excluded from currentStock by a shelf-life validity check — informational, not subtracted again. */
  expiringStockExcluded: number;
  reservedStock: number;
  availableStock: number;
  goodsInTransitWithinHorizon: number;
  goodsInTransitUnknownEta: number;
  goodsInTransitAfterHorizon: number;
  /** Kept for API compatibility; false now that unknown-ETA stock is conservatively excluded. */
  etaAssumptionApplied: boolean;
  unknownEtaExcluded: boolean;
  leadTimeMonths: number;
  reviewPeriodMonths: number;
  demandStdDev: number;
  serviceLevel: number;
  safetyStockZScore: number;
  safetyStock: number;
  targetPosition: number;
  currentPosition: number;
  recommendedOrderBeforeMoq: number;
  moqMultiple: number | null;
  recommendedOrder: number;
  coverageMonths: number | null;
  daysOfSupply: number | null;
  isOverstock: boolean;
  overstockMonths: number;
  nearestInboundExpectedDate: string | null;
  projectedStockoutDate: string | null;
  potentialStockoutDays: number | null;
  urgency: ReplenishmentUrgency;
  demandPattern: DemandPattern;
  nonZeroDemandFrequency: number;
  forecastMethod: "seasonal_trend" | "intermittent_rate";
  exceptions: ReplenishmentException[];
}

export interface SupplierReplenishmentGroup {
  supplier: string;
  items: ReplenishmentRecommendation[];
  totalRecommendedUnits: number;
}

export interface ReplenishmentPlan {
  asOfMonth: YearMonth;
  suppliers: SupplierReplenishmentGroup[];
}

const average = (values: number[]): number => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const round = (value: number): number => Number(value.toFixed(6));
const SERVICE_LEVEL_Z = [
  [0.9, 1.2816], [0.95, 1.6449], [0.975, 1.96], [0.98, 2.0537], [0.99, 2.3263], [0.995, 2.5758],
] as const;

export function serviceLevelZScore(serviceLevel: number): number {
  if (!Number.isFinite(serviceLevel) || serviceLevel <= 0 || serviceLevel >= 1) throw new Error("Service level must be between 0 and 1.");
  if (serviceLevel <= SERVICE_LEVEL_Z[0][0]) return SERVICE_LEVEL_Z[0][1];
  if (serviceLevel >= SERVICE_LEVEL_Z.at(-1)![0]) return SERVICE_LEVEL_Z.at(-1)![1];
  const upperIndex = SERVICE_LEVEL_Z.findIndex(([level]) => level >= serviceLevel);
  const [lowerLevel, lowerZ] = SERVICE_LEVEL_Z[upperIndex - 1];
  const [upperLevel, upperZ] = SERVICE_LEVEL_Z[upperIndex];
  return lowerZ + (upperZ - lowerZ) * ((serviceLevel - lowerLevel) / (upperLevel - lowerLevel));
}

function standardDeviation(values: number[]): number {
  if (!values.length) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position), upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function spikeThreshold(transactions: SalesTransaction[]): number {
  const values = transactions.map((item) => item.unitsSold).filter((value) => Number.isFinite(value) && value > 0);
  if (values.length < 4) return Number.POSITIVE_INFINITY;
  const center = median(values);
  const mad = median(values.map((value) => Math.abs(value - center)));
  const q1 = quantile(values, 0.25), q3 = quantile(values, 0.75);
  // Use the less contamination-sensitive robust bound, with a 3x-median floor preventing zero-MAD
  // series from classifying ordinary small variation as a large order. Taking the larger IQR bound would
  // let two genuine large transactions inflate Q3 enough to hide the very repeated-growth signal sought.
  return Math.max(center * 3, Math.min(center + 3 * 1.4826 * mad, q3 + 1.5 * (q3 - q1)));
}

function monthOfDate(isoDate: string): YearMonth | null {
  const match = isoDate.match(/^(\d{4})-(\d{2})/);
  return match ? `${+match[1]}-${match[2]}` as YearMonth : null;
}

function addMonths(month: YearMonth, delta: number): YearMonth {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}` as YearMonth;
}

function endOfMonth(month: YearMonth): number {
  const [year, monthNumber] = month.split("-").map(Number);
  return Date.UTC(year, monthNumber, 1) - 1;
}

const DAY_MS = 86_400_000;
const DAYS_PER_MONTH = 30.4375;
const isoDay = (timestamp: number): string => new Date(timestamp).toISOString().slice(0, 10);

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function validateInput(input: ReplenishmentInput): void {
  const { options } = input;
  if (!(options.defaultLeadTimeMonths > 0)) throw new Error("defaultLeadTimeMonths must be greater than zero.");
  if (!(options.reviewPeriodMonths >= 0)) throw new Error("reviewPeriodMonths cannot be negative.");
  if (new Set(input.skuConfigs.map((item) => `${item.supplier}\u0000${item.sku}`)).size !== input.skuConfigs.length) {
    throw new Error("skuConfigs must contain unique supplier/SKU pairs.");
  }
  for (const config of input.skuConfigs) {
    if (!config.sku || !config.supplier || !config.category) throw new Error("Every SKU config requires sku, supplier and category.");
    if (!Number.isFinite(config.forecastGrowthRate) || config.forecastGrowthRate <= -1) throw new Error(`Invalid forecastGrowthRate for ${config.sku}.`);
    if (config.leadTimeMonths !== undefined && config.leadTimeMonths <= 0) throw new Error(`Invalid leadTimeMonths for ${config.sku}.`);
    const serviceLevel = options.categoryServiceLevel[config.category];
    if (!Number.isFinite(serviceLevel) || serviceLevel <= 0 || serviceLevel >= 1) throw new Error(`Missing category service-level policy for ${config.category}.`);
  }
}

interface IndexedInput {
  sales: Map<string, MonthlySales[]>;
  stocks: Map<string, MonthlyOpeningStock[]>;
  inbound: Map<string, InboundShipment[]>;
  transactions: Map<string, SalesTransaction[]>;
  moq: Map<string, MinimumOrderQuantity>;
  reservations: Map<string, SkuReservation>;
  currentStocks: Map<string, SkuCurrentStock>;
}

const scopedKey = (supplier: string | undefined, sku: string): string => supplier ? `${supplier}\u0000${sku}` : sku;

function groupBySku<T extends { sku: string; supplier?: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = scopedKey(row.supplier, row.sku);
    const group = grouped.get(key);
    if (group) group.push(row);
    else grouped.set(key, [row]);
  }
  return grouped;
}

function rowsForConfig<T>(grouped: Map<string, T[]>, config: SkuPlanningConfig): T[] {
  return grouped.get(scopedKey(config.supplier, config.sku)) ?? grouped.get(config.sku) ?? [];
}

function valueForConfig<T>(grouped: Map<string, T>, config: SkuPlanningConfig): T | undefined {
  return grouped.get(scopedKey(config.supplier, config.sku)) ?? grouped.get(config.sku);
}

function recommendationForSku(input: ReplenishmentInput, indexed: IndexedInput, config: SkuPlanningConfig): ReplenishmentRecommendation {
  const { options } = input;
  const sales = rowsForConfig(indexed.sales, config).filter((item) => item.month <= options.asOfMonth).sort((a, b) => a.month.localeCompare(b.month));
  if (!sales.length) throw new Error(`No monthly sales found for ${config.sku}.`);
  const transactions = rowsForConfig(indexed.transactions, config).filter((item) => {
    const month = monthOfDate(item.occurredAt);
    return month !== null && month <= options.asOfMonth;
  });
  // One customer order may be split over several worksheet rows. Detect robust outliers at the
  // invoice/SKU level so a split large order cannot evade the threshold.
  const invoiceGroups = new Map<string, { id: string; month: YearMonth; unitsSold: number }>();
  transactions.forEach((item, index) => {
    const month = monthOfDate(item.occurredAt)!;
    const id = item.invoiceNumber.trim() || `ROW-${index + 1}`;
    const key = `${month}\u0000${id}`;
    const current = invoiceGroups.get(key);
    invoiceGroups.set(key, { id, month, unitsSold: (current?.unitsSold ?? 0) + item.unitsSold });
  });
  const orders = [...invoiceGroups.values()];
  const threshold = spikeThreshold(orders.map((item) => ({
    occurredAt: `${item.month}-01`, invoiceNumber: item.id, sku: config.sku,
    productName: config.sku, unitsSold: item.unitsSold, sourceQuantity: -item.unitsSold,
  })));
  const spikeCandidates = orders.filter((item) => item.unitsSold > threshold);
  const candidateMonths = [...new Set(spikeCandidates.map((item) => item.month))].sort();
  const recentCandidateMonths = candidateMonths.filter((month) => month >= addMonths(options.asOfMonth, -2));
  // A repeated large order in at least two distinct recent months is retained as a deterministic growth
  // signal. A solitary large transaction remains a one-off spike and is removed from regular demand.
  const sustainedGrowthSignal = recentCandidateMonths.length >= 2;
  const recentGrowthSet = new Set(recentCandidateMonths);
  const retainedGrowthSpikes = sustainedGrowthSignal ? spikeCandidates.filter((item) => recentGrowthSet.has(item.month)) : [];
  const retainedGrowthKeys = new Set(retainedGrowthSpikes.map((item) => `${item.month}\u0000${item.id}`));
  const spikes = spikeCandidates.filter((item) => !retainedGrowthKeys.has(`${item.month}\u0000${item.id}`));
  const spikeUnitsByMonth = new Map<YearMonth, number>();
  for (const spike of spikes) {
    spikeUnitsByMonth.set(spike.month, (spikeUnitsByMonth.get(spike.month) ?? 0) + spike.unitsSold);
  }
  const cleaned = sales.map((item) => ({ ...item, unitsSold: Math.max(0, item.unitsSold - (spikeUnitsByMonth.get(item.month) ?? 0)) }));
  const skuStocks = rowsForConfig(indexed.stocks, config);
  const stockByMonth = new Map(skuStocks.map((item) => [item.month, item.openingStock]));
  const stockoutThreshold = options.stockoutOpeningStockThreshold ?? 0;
  const neighborMinimum = options.stockoutNeighborDemandMinimum ?? 1;
  const suppressionRatio = clamp(options.stockoutDemandSuppressionRatio ?? 0.5, 0, 1);
  const stockoutMonths = cleaned.flatMap((item, index) => {
    const stock = stockByMonth.get(item.month);
    const previous = cleaned[index - 1]?.unitsSold;
    const next = cleaned[index + 1]?.unitsSold;
    const neighborDemand = previous !== undefined && next !== undefined ? (previous + next) / 2 : 0;
    return stock !== undefined && stock <= stockoutThreshold
      && previous >= neighborMinimum && next >= neighborMinimum
      && item.unitsSold < neighborDemand * suppressionRatio
      ? [item.month] : [];
  });
  const stockoutSet = new Set(stockoutMonths);
  const demandWithoutStockouts = cleaned.filter((item) => !stockoutSet.has(item.month));
  const rawMonthlyDemand = average(cleaned.map((item) => item.unitsSold));
  const baseMonthlyDemand = average(demandWithoutStockouts.map((item) => item.unitsSold));
  const demandValues = demandWithoutStockouts.map((item) => item.unitsSold);
  const nonZeroDemandFrequency = demandValues.length ? demandValues.filter((value) => value > 0).length / demandValues.length : 0;
  const preliminaryStdDev = standardDeviation(demandValues);
  const coefficientOfVariation = baseMonthlyDemand > 0 ? preliminaryStdDev / baseMonthlyDemand : 0;
  const demandPattern: DemandPattern = nonZeroDemandFrequency <= 0.5
    ? "intermittent"
    : coefficientOfVariation >= 0.75 ? "volatile" : "stable";
  const forecastMethod = demandPattern === "intermittent" ? "intermittent_rate" : "seasonal_trend";
  const lifecycleRecentRows = demandWithoutStockouts.slice(-3);
  const lifecycleRecent = lifecycleRecentRows.map((item) => item.unitsSold);
  const lifecycleEarlier = demandWithoutStockouts.slice(0, -3);
  const lifecycleRecentAverage = average(lifecycleRecent);
  // With at least a year of history, compare the latest months with their own prior calendar-month
  // baselines. This prevents an ordinary seasonal trough from being classified as dead stock.
  const calendarBaselines = lifecycleRecentRows.flatMap((recentRow) => {
    const comparable = lifecycleEarlier.filter((item) => item.month.slice(5, 7) === recentRow.month.slice(5, 7));
    return comparable.length ? [average(comparable.map((item) => item.unitsSold))] : [];
  });
  const lifecycleEarlierAverage = demandWithoutStockouts.length >= 12
    ? (calendarBaselines.length >= 2 ? average(calendarBaselines) : 0)
    : average(lifecycleEarlier.map((item) => item.unitsSold));
  const lifecycleComparable = demandWithoutStockouts.length < 12 || calendarBaselines.length >= 2;
  const stockLifecycleStatus: StockLifecycleStatus = lifecycleComparable && lifecycleRecent.length === 3 && lifecycleEarlierAverage >= 1
    ? lifecycleRecentAverage <= lifecycleEarlierAverage * 0.1
      ? "dead"
      : lifecycleRecentAverage <= lifecycleEarlierAverage * 0.35 ? "slow" : "active"
    : "active";
  // Slow stock plans from the latest observed run rate; dead stock is blocked from automatic purchasing.
  const planningMonthlyDemand = stockLifecycleStatus === "dead" ? 0
    : stockLifecycleStatus === "slow" ? lifecycleRecentAverage : baseMonthlyDemand;

  const leadTimeMonths = config.leadTimeMonths ?? options.defaultLeadTimeMonths;
  const horizonMonths = leadTimeMonths + options.reviewPeriodMonths;
  const seasonalForecast: SeasonalForecastMonth[] = Array.from({ length: Math.ceil(horizonMonths) }, (_, index) => {
    const month = addMonths(options.asOfMonth, index + 1);
    const sameCalendarMonth = demandWithoutStockouts.filter((item) => item.month.slice(5, 7) === month.slice(5, 7));
    const seasonalIndex = stockLifecycleStatus === "active" && forecastMethod === "seasonal_trend"
      && baseMonthlyDemand > 0 && sameCalendarMonth.length
      ? average(sameCalendarMonth.map((item) => item.unitsSold)) / baseMonthlyDemand
      : 1;
    return { month, seasonalIndex, weight: Math.min(1, horizonMonths - index) };
  });
  const seasonalWeight = seasonalForecast.reduce((sum, item) => sum + item.weight, 0);
  const seasonalIndex = seasonalWeight > 0
    ? seasonalForecast.reduce((sum, item) => sum + item.seasonalIndex * item.weight, 0) / seasonalWeight
    : 1;

  const window = Math.max(1, options.trendWindowMonths ?? 3);
  const recent = demandWithoutStockouts.slice(-window).map((item) => item.unitsSold);
  const earlier = demandWithoutStockouts.slice(-window * 2, -window).map((item) => item.unitsSold);
  const earlierAverage = average(earlier), recentAverage = average(recent);
  // Sparse demand uses an occurrence-rate model; a short run of zero/non-zero months is not treated as
  // a continuous trend because that would amplify timing noise as growth.
  const rawHistoricalGrowth = stockLifecycleStatus !== "active" || forecastMethod === "intermittent_rate"
    ? 0
    : earlierAverage > 0 && earlier.length ? recentAverage / earlierAverage - 1 : 0;
  const growthLimit = options.maxAbsoluteHistoricalGrowthRate ?? 0.5;
  const historicalGrowthRate = clamp(rawHistoricalGrowth, -growthLimit, growthLimit);
  const combinedGrowthFactor = (1 + historicalGrowthRate) * (1 + config.forecastGrowthRate);
  // `baseMonthlyDemand` is already stockout-compensated (stockout months are excluded from its average,
  // not counted as zero demand). `stockoutCompensationFactor` is kept only as an audit/narration figure —
  // "how much higher the corrected demand is than the naive raw average" — and must NOT be multiplied into
  // the rate again, or the compensation is effectively applied twice (once by exclusion, once by this
  // factor), inflating the recommendation beyond what the data supports.
  const stockoutCompensationFactor = rawMonthlyDemand > 0 ? Math.max(1, baseMonthlyDemand / rawMonthlyDemand) : 1;
  const adjustedDemandRate = planningMonthlyDemand * seasonalIndex * combinedGrowthFactor;

  const stockRows = skuStocks.filter((item) => item.month <= options.asOfMonth).sort((a, b) => a.month.localeCompare(b.month));
  const latestOpeningRow = stockRows.at(-1);
  const openingStockAsOf = latestOpeningRow?.openingStock ?? 0;
  const salesSinceOpening = latestOpeningRow
    // A negative monthly net value represents returns/adjustments. Without an authoritative current
    // stock snapshot, do not let that uncertain movement inflate available stock and suppress an order.
    ? Math.max(0, sales.filter((item) => item.month >= latestOpeningRow.month).reduce((sum, item) => sum + item.unitsSold, 0))
    : 0;
  const explicitCurrentStock = valueForConfig(indexed.currentStocks, config);
  const currentStockSource: CurrentStockSource = explicitCurrentStock ? "explicit_snapshot" : "projected_from_opening";
  const expiringStockExcluded = explicitCurrentStock?.excludedForShelfLife ?? 0;
  // Prefer an explicit stock snapshot when supplied. Otherwise, the best auditable estimate rolls the
  // latest opening balance forward by net monthly sales observed since that opening date.
  const currentStock = explicitCurrentStock?.currentStock ?? Math.max(0, openingStockAsOf - salesSinceOpening);
  const reservedStock = valueForConfig(indexed.reservations, config)?.reservedStock ?? 0;
  // When no reservation source is supplied, the documented fallback is zero reserved stock.
  const availableStock = Math.max(0, currentStock - reservedStock);
  const horizonEnd = endOfMonth(addMonths(options.asOfMonth, Math.ceil(horizonMonths)));
  const skuInbound = rowsForConfig(indexed.inbound, config);
  const goodsInTransitWithinHorizon = skuInbound
    .filter((item) => item.expectedDate !== null && Date.parse(item.expectedDate) <= horizonEnd)
    .reduce((sum, item) => sum + item.quantity, 0);
  const goodsInTransitUnknownEta = skuInbound.filter((item) => item.expectedDate === null).reduce((sum, item) => sum + item.quantity, 0);
  const goodsInTransitAfterHorizon = skuInbound.filter((item) => item.expectedDate !== null && Date.parse(item.expectedDate) > horizonEnd).reduce((sum, item) => sum + item.quantity, 0);
  const demandStdDev = preliminaryStdDev;
  const serviceLevel = options.categoryServiceLevel[config.category];
  const safetyStockZScore = serviceLevelZScore(serviceLevel);
  const safetyStock = stockLifecycleStatus === "dead" ? 0 : safetyStockZScore * demandStdDev * Math.sqrt(horizonMonths);

  /**
   * Deterministic replenishment formula from the case specification:
   * target_position = cleaned_seasonal_growth_adjusted_demand_rate
   *   * (lead_time_months + review_period_months) + safety_stock
   * current_position = max(0, current_stock - reserved_stock) + goods_in_transit_within_horizon
   * recommended_order = max(0, target_position - current_position)
   */
  const targetPosition = adjustedDemandRate * horizonMonths + safetyStock;
  const currentPosition = availableStock + goodsInTransitWithinHorizon;
  const recommendedOrderBeforeMoq = stockLifecycleStatus === "dead" ? 0 : Math.max(0, targetPosition - currentPosition);
  const moqMultiple = valueForConfig(indexed.moq, config)?.multiple ?? null;
  const recommendedOrder = moqMultiple && recommendedOrderBeforeMoq > 0
    ? Math.ceil(recommendedOrderBeforeMoq / moqMultiple) * moqMultiple
    : recommendedOrderBeforeMoq;
  const coverageMonths = adjustedDemandRate > 0 ? currentPosition / adjustedDemandRate : null;
  const daysOfSupply = adjustedDemandRate > 0 ? availableStock / adjustedDemandRate * DAYS_PER_MONTH : null;
  const isOverstock = coverageMonths !== null && coverageMonths > horizonMonths * 2;
  const overstockMonths = isOverstock ? coverageMonths - horizonMonths : 0;
  const planningTimestamp = endOfMonth(options.asOfMonth) + 1;
  const nearestInboundExpectedDate = skuInbound
    .flatMap((item) => item.expectedDate && Date.parse(item.expectedDate) >= planningTimestamp ? [item.expectedDate] : [])
    .sort()[0] ?? null;
  const projectedStockoutTimestamp = daysOfSupply === null ? null : planningTimestamp + Math.ceil(daysOfSupply) * DAY_MS;
  const projectedStockoutDate = projectedStockoutTimestamp === null ? null : isoDay(projectedStockoutTimestamp);
  const potentialStockoutDays = projectedStockoutTimestamp !== null && nearestInboundExpectedDate
    ? Math.max(0, Math.ceil((Date.parse(nearestInboundExpectedDate) - projectedStockoutTimestamp) / DAY_MS))
    : null;
  const urgency: ReplenishmentUrgency = coverageMonths !== null && coverageMonths < leadTimeMonths
    ? "high"
    : coverageMonths !== null && coverageMonths < horizonMonths ? "medium" : "low";
  const exceptions: ReplenishmentException[] = [
    ...(stockoutMonths.length ? ["stockout" as const] : []),
    ...(spikes.length ? ["one_off_spike" as const] : []),
    ...(retainedGrowthSpikes.length ? ["sustained_growth_signal" as const] : []),
    ...(goodsInTransitUnknownEta > 0 ? ["unknown_eta" as const] : []),
    ...(goodsInTransitAfterHorizon > 0 ? ["inbound_after_horizon" as const] : []),
    ...(isOverstock ? ["surplus" as const] : []),
    ...(stockLifecycleStatus === "slow" ? ["slow_stock" as const] : []),
    ...(stockLifecycleStatus === "dead" ? ["dead_stock" as const] : []),
    ...(expiringStockExcluded > 0 ? ["expiring_stock" as const] : []),
  ];

  return {
    sku: config.sku,
    productName: sales.at(-1)?.productName ?? config.sku,
    supplier: config.supplier,
    category: config.category,
    baseMonthlyDemand: round(baseMonthlyDemand),
    rawMonthlyDemand: round(rawMonthlyDemand),
    seasonalIndex: round(seasonalIndex),
    seasonalForecast: seasonalForecast.map((item) => ({ ...item, seasonalIndex: round(item.seasonalIndex), weight: round(item.weight) })),
    historicalGrowthRate: round(historicalGrowthRate),
    forecastGrowthRate: round(config.forecastGrowthRate),
    combinedGrowthFactor: round(combinedGrowthFactor),
    adjustedDemandRate: round(adjustedDemandRate),
    planningMonthlyDemand: round(planningMonthlyDemand),
    stockLifecycleStatus,
    stockoutAdjustmentUnitsPerMonth: round(Math.max(0, baseMonthlyDemand - rawMonthlyDemand)),
    stockoutCompensationFactor: round(stockoutCompensationFactor),
    stockoutMonths,
    excludedSpikeCount: spikes.length,
    excludedSpikeUnits: round(spikes.reduce((sum, item) => sum + item.unitsSold, 0)),
    excludedSpikeTransactionIds: spikes.map((item) => item.id),
    retainedGrowthSpikeCount: retainedGrowthSpikes.length,
    retainedGrowthSpikeUnits: round(retainedGrowthSpikes.reduce((sum, item) => sum + item.unitsSold, 0)),
    spikeOrderImpactEstimate: round((spikes.reduce((sum, item) => sum + item.unitsSold, 0) / Math.max(1, sales.length)) * horizonMonths),
    openingStockAsOf: round(openingStockAsOf),
    salesSinceOpening: round(salesSinceOpening),
    currentStock: round(currentStock),
    currentStockSource,
    ...(explicitCurrentStock?.stockByWarehouse ? { stockByWarehouse: explicitCurrentStock.stockByWarehouse } : {}),
    expiringStockExcluded: round(expiringStockExcluded),
    reservedStock: round(reservedStock),
    availableStock: round(availableStock),
    goodsInTransitWithinHorizon: round(goodsInTransitWithinHorizon),
    goodsInTransitUnknownEta: round(goodsInTransitUnknownEta),
    goodsInTransitAfterHorizon: round(goodsInTransitAfterHorizon),
    etaAssumptionApplied: false,
    unknownEtaExcluded: goodsInTransitUnknownEta > 0,
    leadTimeMonths: round(leadTimeMonths),
    reviewPeriodMonths: round(options.reviewPeriodMonths),
    demandStdDev: round(demandStdDev),
    serviceLevel: round(serviceLevel),
    safetyStockZScore: round(safetyStockZScore),
    safetyStock: round(safetyStock),
    targetPosition: round(targetPosition),
    currentPosition: round(currentPosition),
    recommendedOrderBeforeMoq: round(recommendedOrderBeforeMoq),
    moqMultiple,
    recommendedOrder: round(recommendedOrder),
    coverageMonths: coverageMonths === null ? null : round(coverageMonths),
    daysOfSupply: daysOfSupply === null ? null : round(daysOfSupply),
    isOverstock,
    overstockMonths: round(overstockMonths),
    nearestInboundExpectedDate,
    projectedStockoutDate,
    potentialStockoutDays,
    urgency,
    demandPattern,
    nonZeroDemandFrequency: round(nonZeroDemandFrequency),
    forecastMethod,
    exceptions,
  };
}

export function calculateReplenishment(input: ReplenishmentInput): ReplenishmentPlan {
  validateInput(input);
  // Build each index once. Large workbooks can contain hundreds of thousands of transactions; repeated
  // whole-array filtering per SKU would make the browser workflow quadratic and unsuitable for Vercel.
  const indexed: IndexedInput = {
    sales: groupBySku(input.monthlySales),
    stocks: groupBySku(input.openingStocks),
    inbound: groupBySku(input.inboundShipments),
    transactions: groupBySku(input.salesTransactions),
    moq: new Map(input.minimumOrderQuantities?.map((item) => [scopedKey(item.supplier, item.sku), item])),
    reservations: new Map(input.reservations?.map((item) => [scopedKey(item.supplier, item.sku), item])),
    currentStocks: new Map(input.currentStocks?.map((item) => [scopedKey(item.supplier, item.sku), item])),
  };
  const recommendations = input.skuConfigs.map((config) => recommendationForSku(input, indexed, config));
  const suppliers = [...new Set(recommendations.map((item) => item.supplier))].sort().map((supplier) => {
    const items = recommendations.filter((item) => item.supplier === supplier).sort((a, b) => a.sku.localeCompare(b.sku));
    return { supplier, items, totalRecommendedUnits: round(items.reduce((sum, item) => sum + item.recommendedOrder, 0)) };
  });
  return { asOfMonth: input.options.asOfMonth, suppliers };
}
