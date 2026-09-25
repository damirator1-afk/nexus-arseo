"use client";

import type { PlanAggregate } from "@/lib/nexus/replenishment/planSelectors";
import { demandPatternLabel, lifecycleLabel, number, urgencyLabel } from "../shared";
import styles from "../replenishment.module.css";

const EXCEPTION_LABEL: Record<string, string> = {
  stockout: "Дефицит в истории",
  one_off_spike: "Разовый всплеск",
  sustained_growth_signal: "Устойчивый рост",
  unknown_eta: "Поставка без ETA",
  inbound_after_horizon: "Поставка за горизонтом",
  surplus: "Избыток",
  slow_stock: "Медленный товар",
  dead_stock: "Мёртвый запас",
};

function Bar({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return <div className={styles.barRow}>
    <span>{label}</span>
    <span className={styles.barTrack}><span className={styles.barFill} style={{ width: `${pct}%` }} /></span>
    <span>{count}</span>
  </div>;
}

export function AnalyticsTab(props: { summary: PlanAggregate; priceCoverage: { known: number; total: number } }) {
  const { summary, priceCoverage } = props;
  const total = summary.totalSkuCount;
  const coveragePct = priceCoverage.total > 0 ? Math.round((priceCoverage.known / priceCoverage.total) * 100) : 0;

  return <>
    <div className={styles.sectionHead}><div><p>Разбивка по плану</p><h2>Аналитика</h2></div></div>

    <article className={styles.analyticsBlock}>
      <h3>По срочности</h3>
      {(["high", "medium", "low"] as const).map((key) => <Bar key={key} label={urgencyLabel[key]} count={summary.urgencyCounts[key]} total={total} />)}
    </article>

    <article className={styles.analyticsBlock}>
      <h3>По статусу запаса</h3>
      {(["active", "slow", "dead"] as const).map((key) => <Bar key={key} label={lifecycleLabel[key]} count={summary.lifecycleCounts[key]} total={total} />)}
    </article>

    <article className={styles.analyticsBlock}>
      <h3>По типу спроса</h3>
      {(["stable", "volatile", "intermittent"] as const).map((key) => <Bar key={key} label={demandPatternLabel[key]} count={summary.demandPatternCounts[key]} total={total} />)}
    </article>

    <article className={styles.analyticsBlock}>
      <h3>Исключения <small style={{ fontWeight: 400 }}>(один SKU может входить в несколько категорий)</small></h3>
      {Object.entries(summary.exceptionCounts).filter(([, count]) => count > 0).map(([key, count]) => (
        <Bar key={key} label={EXCEPTION_LABEL[key] ?? key} count={count} total={total} />
      ))}
      {Object.values(summary.exceptionCounts).every((count) => count === 0) && <p className={styles.gateHint}>Исключений не найдено.</p>}
    </article>

    <article className={styles.analyticsBlock}>
      <h3>По поставщикам</h3>
      {summary.supplierTotals.map((supplierTotal) => (
        <div className={styles.barRow} key={supplierTotal.supplier}>
          <span>{supplierTotal.supplier}</span>
          <span>{supplierTotal.skuCount} SKU</span>
          <span>{number.format(supplierTotal.recommendedUnits)} ед.</span>
        </div>
      ))}
    </article>

    <p className={styles.assumption}>
      Себестоимость известна только для {priceCoverage.known} из {priceCoverage.total} позиций ({coveragePct}%) —
      только по одному файлу Systeme Electric; у IEK цены нет ни в одном источнике. На вкладках «Сегодня» и
      «Заказ поставщикам» сумма заказа считается только по позициям с известной ценой, остальные помечены
      «нет данных», а не приравнены к нулю — округлять пробел до нуля было бы так же вводящим в заблуждение,
      как выдумывать цену.
    </p>
  </>;
}
