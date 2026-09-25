import type {
  DemandPattern,
  ReplenishmentException,
  ReplenishmentRecommendation,
  ReplenishmentUrgency,
  StockLifecycleStatus,
} from "./calculation.ts";

/**
 * `ReplenishmentPlan` intentionally carries no cross-SKU aggregates — `calculateReplenishment`
 * stays a pure per-SKU engine. These selectors compute presentation-only summaries from its
 * output for dashboard views (KPI tiles, analytics, a calendar of order deadlines) without
 * touching the audited calculation logic itself.
 */

const URGENCY_KEYS: ReplenishmentUrgency[] = ["high", "medium", "low"];
const LIFECYCLE_KEYS: StockLifecycleStatus[] = ["active", "slow", "dead"];
const DEMAND_PATTERN_KEYS: DemandPattern[] = ["stable", "volatile", "intermittent"];
const EXCEPTION_KEYS: ReplenishmentException[] = [
  "stockout", "one_off_spike", "sustained_growth_signal", "unknown_eta",
  "inbound_after_horizon", "surplus", "slow_stock", "dead_stock",
];

function zeroRecord<K extends string>(keys: K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

export interface PlanSupplierTotal {
  supplier: string;
  skuCount: number;
  recommendedUnits: number;
}

export interface PlanAggregate {
  totalSkuCount: number;
  totalRecommendedUnits: number;
  urgencyCounts: Record<ReplenishmentUrgency, number>;
  lifecycleCounts: Record<StockLifecycleStatus, number>;
  /** Sums can exceed totalSkuCount: a SKU may carry more than one exception at once. */
  exceptionCounts: Record<ReplenishmentException, number>;
  demandPatternCounts: Record<DemandPattern, number>;
  supplierTotals: PlanSupplierTotal[];
}

export function summarizePlan(items: ReplenishmentRecommendation[]): PlanAggregate {
  const urgencyCounts = zeroRecord(URGENCY_KEYS);
  const lifecycleCounts = zeroRecord(LIFECYCLE_KEYS);
  const demandPatternCounts = zeroRecord(DEMAND_PATTERN_KEYS);
  const exceptionCounts = zeroRecord(EXCEPTION_KEYS);
  const supplierTotals = new Map<string, PlanSupplierTotal>();
  let totalRecommendedUnits = 0;

  for (const item of items) {
    urgencyCounts[item.urgency] += 1;
    lifecycleCounts[item.stockLifecycleStatus] += 1;
    demandPatternCounts[item.demandPattern] += 1;
    for (const exception of item.exceptions) exceptionCounts[exception] += 1;
    totalRecommendedUnits += item.recommendedOrder;
    const entry = supplierTotals.get(item.supplier) ?? { supplier: item.supplier, skuCount: 0, recommendedUnits: 0 };
    entry.skuCount += 1;
    entry.recommendedUnits += item.recommendedOrder;
    supplierTotals.set(item.supplier, entry);
  }

  return {
    totalSkuCount: items.length,
    totalRecommendedUnits,
    urgencyCounts,
    lifecycleCounts,
    exceptionCounts,
    demandPatternCounts,
    supplierTotals: [...supplierTotals.values()].sort((a, b) => a.supplier.localeCompare(b.supplier)),
  };
}

export interface OrderDeadlineItem extends ReplenishmentRecommendation {
  /**
   * Presentation-only estimate (`projectedStockoutDate` minus `leadTimeMonths`), computed here —
   * NOT part of the audited calculation engine and not persisted anywhere else.
   */
  orderByDate: string | null;
}

export interface OrderDeadlineGroup {
  bucketKey: string;
  bucketLabel: string;
  items: OrderDeadlineItem[];
}

const MONTH_LABELS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const DAY_MS = 86_400_000;
const DAYS_PER_MONTH = 30.4375;

function computeOrderByDate(item: ReplenishmentRecommendation): string | null {
  if (!item.projectedStockoutDate) return null;
  const stockoutMs = Date.parse(item.projectedStockoutDate);
  if (!Number.isFinite(stockoutMs)) return null;
  const leadDays = Math.round(item.leadTimeMonths * DAYS_PER_MONTH);
  return new Date(stockoutMs - leadDays * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Groups SKUs that currently need an order (`recommendedOrder > 0`) by the month their order
 * should go out, so a manager can see "what to order by when" instead of one flat table.
 * Items with no projectable stockout date land in a separate "unknown" bucket rather than being
 * silently dropped.
 */
export function groupByOrderDeadline(items: ReplenishmentRecommendation[], asOfDate: Date = new Date()): OrderDeadlineGroup[] {
  const todayKey = asOfDate.toISOString().slice(0, 10);
  const groups = new Map<string, OrderDeadlineGroup>();
  const ensure = (bucketKey: string, bucketLabel: string): OrderDeadlineGroup => {
    const existing = groups.get(bucketKey);
    if (existing) return existing;
    const created = { bucketKey, bucketLabel, items: [] as OrderDeadlineItem[] };
    groups.set(bucketKey, created);
    return created;
  };

  for (const item of items) {
    if (item.recommendedOrder <= 0) continue;
    const orderByDate = computeOrderByDate(item);
    const enriched: OrderDeadlineItem = { ...item, orderByDate };
    if (orderByDate === null) { ensure("unknown", "Нет данных о сроке").items.push(enriched); continue; }
    if (orderByDate < todayKey) { ensure("overdue", "Просрочено").items.push(enriched); continue; }
    const [year, month] = orderByDate.split("-").map(Number);
    ensure(`${year}-${String(month).padStart(2, "0")}`, `${MONTH_LABELS[month - 1]} ${year}`).items.push(enriched);
  }

  const bucketRank = (key: string): number => (key === "overdue" ? -1 : key === "unknown" ? Number.MAX_SAFE_INTEGER : 0);
  return [...groups.values()]
    .sort((a, b) => bucketRank(a.bucketKey) - bucketRank(b.bucketKey) || a.bucketKey.localeCompare(b.bucketKey))
    .map((group) => ({ ...group, items: group.items.sort((a, b) => (a.orderByDate ?? "").localeCompare(b.orderByDate ?? "")) }));
}
