"use client";

import type { ReplenishmentPlan, ReplenishmentRecommendation } from "@/lib/nexus/replenishment/calculation";
import type { PlanAggregate } from "@/lib/nexus/replenishment/planSelectors";
import { AlertIcon, BoxIcon, ClockIcon, CoinIcon } from "../icons";
import { money, number, supplierSkuKey, urgencyLabel, urgencyRank, type DataSource } from "../shared";
import styles from "../replenishment.module.css";

const urgencyRankOf = (item: ReplenishmentRecommendation) => urgencyRank[item.urgency];

export function TodayTab(props: {
  plan: ReplenishmentPlan;
  summary: PlanAggregate;
  dataSource: DataSource;
  costPrices: Map<string, number>;
  onOpenSku: (sku: string) => void;
  onNewCalculation: () => void;
}) {
  const { plan, summary, costPrices } = props;
  const priced = plan.suppliers.flatMap((group) => group.items).filter((item) => item.recommendedOrder > 0 && costPrices.has(supplierSkuKey(item.supplier, item.sku)));
  const knownOrderValue = priced.reduce((sum, item) => sum + item.recommendedOrder * (costPrices.get(supplierSkuKey(item.supplier, item.sku)) ?? 0), 0);
  const orderingCount = plan.suppliers.flatMap((group) => group.items).filter((item) => item.recommendedOrder > 0).length;
  const attention = plan.suppliers
    .flatMap((group) => group.items)
    .filter((item) => item.recommendedOrder > 0)
    .sort((a, b) => urgencyRankOf(a) - urgencyRankOf(b) || (a.projectedStockoutDate ?? "9999").localeCompare(b.projectedStockoutDate ?? "9999"))
    .slice(0, 8);

  return <>
    <div className={styles.sectionHead}>
      <div><p>Итоги</p><h2>Что важно знать сегодня</h2></div>
      <button type="button" className={styles.btn} onClick={props.onNewCalculation}>Новый расчёт</button>
    </div>

    <div className={styles.kpis}>
      <div className={`${styles.kpi} ${styles.tCrit}`}>
        <div className={styles.kTop}><div className={styles.kLabel}>Срочно</div><div className={styles.kIco}><AlertIcon size={20} /></div></div>
        <div className={`${styles.kValue} ${styles.num}`}>{summary.urgencyCounts.high}</div>
        <div className={styles.kSub}>покрытие меньше срока поставки — заказать немедленно</div>
      </div>
      <div className={`${styles.kpi} ${styles.tWarn}`}>
        <div className={styles.kTop}><div className={styles.kLabel}>Мёртвый запас</div><div className={styles.kIco}><ClockIcon size={20} /></div></div>
        <div className={`${styles.kValue} ${styles.num}`}>{summary.lifecycleCounts.dead}</div>
        <div className={styles.kSub}>автозаказ заблокирован, спрос прекратился</div>
      </div>
      <div className={`${styles.kpi} ${styles.tPlan}`}>
        <div className={styles.kTop}><div className={styles.kLabel}>К заказу, ед.</div><div className={styles.kIco}><BoxIcon size={20} /></div></div>
        <div className={`${styles.kValue} ${styles.num}`}>{number.format(summary.totalRecommendedUnits)}</div>
        <div className={styles.kSub}>{summary.totalSkuCount} позиций всего</div>
      </div>
      <div className={`${styles.kpi} ${styles.tPlan}`}>
        <div className={styles.kTop}><div className={styles.kLabel}>Стоимость заказа</div><div className={styles.kIco}><CoinIcon size={20} /></div></div>
        <div className={`${styles.kValue} ${styles.num}`}>{priced.length ? money(knownOrderValue) : "Нет данных"}</div>
        <div className={styles.kSub}>известна цена у {priced.length} из {orderingCount} позиций к заказу</div>
      </div>
      {summary.supplierTotals.map((supplierTotal) => (
        <div className={`${styles.kpi} ${styles.tPlan}`} key={supplierTotal.supplier}>
          <div className={styles.kTop}><div className={styles.kLabel}>{supplierTotal.supplier}</div><div className={styles.kIco}><BoxIcon size={20} /></div></div>
          <div className={`${styles.kValue} ${styles.num}`}>{supplierTotal.skuCount}</div>
          <div className={styles.kSub}>{number.format(supplierTotal.recommendedUnits)} ед. к заказу</div>
        </div>
      ))}
    </div>

    <div className={styles.sectionHead}><div><p>Приоритет</p><h2>Требует внимания в первую очередь</h2></div></div>
    {attention.length
      ? <div className={styles.attentionList}>
          {attention.map((item) => (
            <button type="button" className={styles.attentionRow} key={`${item.supplier}:${item.sku}`} onClick={() => props.onOpenSku(item.sku)}>
              <span><b>{item.sku}</b><small>{item.productName} · {item.supplier}</small></span>
              <span><b className={styles.num}>{number.format(item.recommendedOrder)} ед.</b><small>{urgencyLabel[item.urgency]}</small></span>
              <span><small>{item.daysOfSupply === null ? "—" : `${Math.round(item.daysOfSupply)} дн. запаса`}</small></span>
            </button>
          ))}
        </div>
      : <p className={styles.gateHint}>Нет позиций, требующих немедленного заказа.</p>}
  </>;
}
