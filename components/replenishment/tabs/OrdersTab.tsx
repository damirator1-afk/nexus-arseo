"use client";

import type { Dispatch, SetStateAction } from "react";
import type { ReplenishmentPlan, ReplenishmentRecommendation, ReplenishmentUrgency } from "@/lib/nexus/replenishment/calculation";
import type { ConfirmedOrderLine } from "@/lib/nexus/replenishment/orderShare";
import { AlertIcon, BoxIcon, ClockIcon, CoinIcon, SearchIcon } from "../icons";
import { SupplierDispatch } from "../SupplierDispatch";
import {
  demandPatternLabel, exceptionViews, explanation, lifecycleLabel, matchesExceptionView,
  money, number, urgencyLabel, validManagerQuantity,
  type ExceptionView, type ManagerDecision,
} from "../shared";
import styles from "../replenishment.module.css";

const URGENCY_PILL: Record<ReplenishmentUrgency, { cls: string; Icon: typeof AlertIcon }> = {
  high: { cls: styles.critical, Icon: AlertIcon },
  medium: { cls: styles.soon, Icon: ClockIcon },
  low: { cls: styles.planned, Icon: BoxIcon },
};

export function OrdersTab(props: {
  plan: ReplenishmentPlan;
  visible: ReplenishmentPlan["suppliers"];
  costPrices: Map<string, number>;
  confirmedRows: ConfirmedOrderLine[];
  query: string;
  setQuery: (query: string) => void;
  exceptionView: ExceptionView;
  setExceptionView: (view: ExceptionView) => void;
  decisions: Record<string, ManagerDecision>;
  setDecisions: Dispatch<SetStateAction<Record<string, ManagerDecision>>>;
  narratives: Record<string, string>;
  narrating: Record<string, boolean>;
  requestNarrative: (item: ReplenishmentRecommendation) => void;
  downloadConfirmedOrders: () => void;
  onNewCalculation: () => void;
  focusSku?: string | null;
}) {
  const {
    plan, visible, costPrices, confirmedRows, query, setQuery, exceptionView, setExceptionView,
    decisions, setDecisions, narratives, narrating, requestNarrative, downloadConfirmedOrders,
    onNewCalculation, focusSku,
  } = props;

  const allItems = plan.suppliers.flatMap((group) => group.items);
  const pricedOrdering = allItems.filter((item) => item.recommendedOrder > 0 && costPrices.has(item.sku));
  const knownOrderValue = pricedOrdering.reduce((sum, item) => sum + item.recommendedOrder * (costPrices.get(item.sku) ?? 0), 0);

  return <>
    <div className={styles.sectionHead}>
      <div><p>Результат на {plan.asOfMonth}</p><h2>Рекомендации по поставщикам</h2></div>
      <div className={styles.resultActions}>
        <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={!confirmedRows.length} onClick={downloadConfirmedOrders}>Экспорт в Excel ({confirmedRows.length})</button>
        <button className={styles.btn} onClick={onNewCalculation}>Новый расчёт</button>
      </div>
    </div>

    <div className={styles.kpis}>
      <div className={`${styles.kpi} ${styles.tPlan}`}><div className={styles.kTop}><div className={styles.kLabel}>Позиций</div><div className={styles.kIco}><BoxIcon size={20} /></div></div><div className={`${styles.kValue} ${styles.num}`}>{allItems.length}</div></div>
      <div className={`${styles.kpi} ${styles.tPlan}`}><div className={styles.kTop}><div className={styles.kLabel}>К заказу</div><div className={styles.kIco}><BoxIcon size={20} /></div></div><div className={`${styles.kValue} ${styles.num}`}>{number.format(plan.suppliers.reduce((sum, group) => sum + group.totalRecommendedUnits, 0))}</div></div>
      <div className={`${styles.kpi} ${styles.tCrit}`}><div className={styles.kTop}><div className={styles.kLabel}>Срочных</div><div className={styles.kIco}><AlertIcon size={20} /></div></div><div className={`${styles.kValue} ${styles.num}`}>{allItems.filter((item) => item.urgency === "high").length}</div></div>
      <div className={`${styles.kpi} ${styles.tPlan}`}>
        <div className={styles.kTop}><div className={styles.kLabel}>Сумма заказа</div><div className={styles.kIco}><CoinIcon size={20} /></div></div>
        <div className={`${styles.kValue} ${styles.num}`}>{pricedOrdering.length ? money(knownOrderValue) : "Нет данных"}</div>
        <div className={styles.kSub}>цена известна у {pricedOrdering.length} позиций из тех, что к заказу</div>
      </div>
    </div>

    <SupplierDispatch lines={confirmedRows} asOfMonth={plan.asOfMonth} />

    <div className={styles.searchInput} style={{ marginBottom: 16 }}>
      <SearchIcon size={16} />
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск: название, код 1С, артикул" />
    </div>

    <nav className={styles.chips} aria-label="Фильтр исключений">{exceptionViews.map((view) => {
      const count = allItems.filter((item) => matchesExceptionView(item, view.key)).length;
      return <button key={view.key} className={`${styles.chip} ${exceptionView === view.key ? styles.chipActive : ""}`} onClick={() => setExceptionView(view.key)}>{view.label}<b>{count}</b></button>;
    })}</nav>

    {visible.map((group) => <article className={styles.supBlock} key={group.supplier}>
      <header className={styles.supHead}>
        <div className={styles.supTitle}>{group.supplier}</div>
        <div className={styles.supStats}><span>{group.items.length} SKU · <b className={styles.num}>{number.format(group.totalRecommendedUnits)}</b> ед.</span></div>
      </header>
      <div className={styles.tableWrap}><table><thead><tr><th>Статус</th><th>Товар и обоснование</th><th>Заказать</th><th>Сумма</th><th>Покрытие</th><th>Обоснование</th></tr></thead><tbody>
        {group.items.map((item) => {
          const narrativeKey = `${item.supplier}:${item.sku}`;
          const decision = decisions[narrativeKey] ?? { quantity: item.recommendedOrder, status: "draft" as const };
          const { cls: pillCls, Icon: PillIcon } = URGENCY_PILL[item.urgency];
          const costPrice = costPrices.get(item.sku);
          return <tr key={item.sku} ref={focusSku === item.sku ? (node) => node?.scrollIntoView({ block: "center", behavior: "smooth" }) : undefined}>
            <td>
              <span className={`${styles.pill} ${pillCls}`}><PillIcon size={12} />{urgencyLabel[item.urgency]}</span>
            </td>
            <td>
              <b>{item.sku}</b><small>{item.productName}</small>
              <span className={styles.pattern}>{demandPatternLabel[item.demandPattern]}</span>
              {item.stockLifecycleStatus !== "active" && <span className={`${styles.pattern} ${styles.lifecycleWarning}`}>{lifecycleLabel[item.stockLifecycleStatus]}</span>}
            </td>
            <td>
              <span className={`${styles.qtyValue} ${styles.num}`}>{number.format(item.recommendedOrder)}</span><small>MOQ {item.moqMultiple ?? "—"}</small>
              {item.stockLifecycleStatus === "dead" && <small className={styles.doNotOrder}>Не заказывать: спрос прекратился</small>}
              {item.isOverstock && item.recommendedOrder === 0 && <small className={styles.doNotOrder}>Не заказывать: запас превышает горизонт на {number.format(item.overstockMonths)} мес.</small>}
              {decision.status === "confirmed" && <small className={styles.confirmed}>Подтверждено: {number.format(decision.quantity)}</small>}
            </td>
            <td>{costPrice !== undefined ? <b className={styles.num}>{money(costPrice * item.recommendedOrder)}</b> : <small>нет данных</small>}</td>
            <td><b className={styles.num}>{item.daysOfSupply === null ? "—" : `${Math.round(item.daysOfSupply)} дн.`}</b><small>{item.daysOfSupply === null ? "Нет текущего спроса" : `товара хватит до ${item.projectedStockoutDate ?? "—"}`}</small></td>
            <td><details open={focusSku === item.sku}><summary>Показать расчёт</summary>
              <p>{explanation(item)}</p>
              {item.potentialStockoutDays !== null && item.potentialStockoutDays > 0 && <p className={styles.stockoutRisk}>Остаток закончится {item.projectedStockoutDate}, ближайшая поставка ожидается {item.nearestInboundExpectedDate}: {item.potentialStockoutDays} дн. потенциального дефицита.</p>}
              {item.isOverstock && <p className={styles.overstockNote}>{item.recommendedOrder === 0 ? `Автозаказ не требуется: совокупная позиция покрывает ${number.format(item.coverageMonths ?? 0)} мес. спроса.` : `Остаток покрывает ${number.format(item.coverageMonths ?? 0)} мес. спроса — выше обычного горизонта, но небольшой заказ всё ещё рекомендован из-за страхового запаса по волатильности этого SKU.`}</p>}
              {item.stockLifecycleStatus === "slow" && <p className={styles.assumption}>Slow stock: планирование переведено на средний спрос последних трёх доступных месяцев.</p>}
              {item.stockLifecycleStatus === "dead" && <p className={styles.stockoutRisk}>Dead stock: автоматическое пополнение заблокировано, рекомендация равна нулю.</p>}
              {item.unknownEtaExcluded && <p className={styles.assumption}>Поставка без точного ETA не уменьшает заказ. После подтверждения даты менеджер может пересчитать план.</p>}
              {narratives[narrativeKey] && <div className={styles.aiNarrative}><small>Объяснение ИИ</small><p>{narratives[narrativeKey]}</p></div>}
              <div className={styles.decisionPanel}>
                <label><small>Количество менеджера</small><input type="number" min="0" step={item.moqMultiple ?? 1} value={decision.quantity} onChange={(event) => setDecisions((current) => ({ ...current, [narrativeKey]: { quantity: Math.max(0, Number(event.target.value) || 0), status: "draft" } }))} /></label>
                <button onClick={() => setDecisions((current) => ({ ...current, [narrativeKey]: { quantity: validManagerQuantity(decision.quantity, item.moqMultiple), status: "confirmed" } }))}>Подтвердить</button>
              </div>
              <button className={styles.aiButton} disabled={narrating[narrativeKey]} onClick={() => requestNarrative(item)}>{narrating[narrativeKey] ? "ИИ формирует объяснение…" : "Получить объяснение от ИИ"}</button>
            </details></td>
          </tr>;
        })}
      </tbody></table></div>
    </article>)}
  </>;
}
