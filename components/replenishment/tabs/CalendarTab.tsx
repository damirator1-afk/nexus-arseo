"use client";

import type { ReplenishmentPlan } from "@/lib/nexus/replenishment/calculation";
import { groupByOrderDeadline } from "@/lib/nexus/replenishment/planSelectors";
import { number } from "../shared";
import styles from "../replenishment.module.css";

export function CalendarTab(props: { plan: ReplenishmentPlan; onOpenSku: (sku: string) => void }) {
  const { plan, onOpenSku } = props;
  const items = plan.suppliers.flatMap((group) => group.items);
  const groups = groupByOrderDeadline(items);

  return <>
    <div className={styles.sectionHead}>
      <div><p>По срокам</p><h2>Когда нужно заказать</h2></div>
      <b>{items.filter((item) => item.recommendedOrder > 0).length} позиций к заказу</b>
    </div>
    <p className={styles.gateHint} style={{ marginBottom: 20 }}>
      Дата — это оценка (дата вероятного дефицита минус срок поставки), а не отдельное вычисление движка: она нужна только для расстановки приоритетов, точная рекомендация по количеству — на вкладке «Заказы».
    </p>
    {groups.map((group) => (
      <article className={styles.calendarGroup} key={group.bucketKey}>
        <header className={styles.calendarGroupHead}><span>{group.bucketLabel}</span><span>{group.items.length}</span></header>
        {group.items.map((item) => (
          <button type="button" className={styles.calendarRow} key={`${item.supplier}:${item.sku}`} onClick={() => onOpenSku(item.sku)}>
            <span><b>{item.sku}</b><small>{item.productName} · {item.supplier}</small></span>
            <span><b>{number.format(item.recommendedOrder)} ед.</b><small>{item.orderByDate ?? "срок неизвестен"}</small></span>
          </button>
        ))}
      </article>
    ))}
    {!groups.length && <p className={styles.gateHint}>Нет позиций, требующих заказа в ближайшее время.</p>}
  </>;
}
