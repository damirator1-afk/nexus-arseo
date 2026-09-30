"use client";

import type { ReplenishmentAssemblyMetadata } from "@/lib/nexus/replenishment/assemble";
import { FILE_FIELDS, type PlanningControls } from "../shared";
import styles from "../replenishment.module.css";

export function MethodologyTab(props: { planning: PlanningControls } & ReplenishmentAssemblyMetadata) {
  const { planning, missingSources, asOfMonthSource } = props;

  return <>
    <div className={styles.sectionHead}><div><p>Как считает Nexus</p><h2>Методика</h2></div></div>

    <div className={styles.formulaNote} style={{ marginBottom: 20 }}>
      Расчётная модель: <code>СПРОС × ГОРИЗОНТ + ЗАПАС − ПОЗИЦИЯ</code>. LLM не участвует в
      вычислениях — только в необязательном текстовом объяснении поверх уже посчитанных чисел.
    </div>

    <article className={styles.analyticsBlock}>
      <h3>Этапы очистки и прогноза спроса</h3>
      <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
        <li>Разовые крупные заказы (одна накладная/клиент) исключаются робастным порогом медиана/MAD/IQR.</li>
        <li>Повторяющиеся крупные заказы в ≥2 месяцах за последние 3 сохраняются как устойчивый рост, а не выброс.</li>
        <li>Месяцы с подтверждённым дефицитом (нулевой остаток) исключаются из базового спроса, а не считаются нулевым спросом.</li>
        <li>Сезонность считается по тем же календарным месяцам за прошлые годы, тренд ограничен ±50% в год.</li>
        <li>Товар со статусом «мёртвый запас» (спрос упал до ≤10% от исторического) получает рекомендацию 0 — автозаказ жёстко блокируется.</li>
      </ul>
    </article>

    <article className={styles.analyticsBlock}>
      <h3>Данные по поставщикам</h3>
      {Object.entries(missingSources).map(([supplier, missing]) => {
        const missingSet = new Set(missing);
        const present = FILE_FIELDS.filter((field) => !missingSet.has(field.kind));
        const absent = FILE_FIELDS.filter((field) => missingSet.has(field.kind));
        return <div className={styles.sourceDisclosure} key={supplier}>
          <b>{supplier}</b>
          <p><span className={styles.sourcePresent}>Загружено:</span> {present.length ? present.map((field) => field.label).join(", ") : "нет источников"}</p>
          {absent.map((field) => <p key={field.kind}><span className={styles.sourceMissing}>Нет {field.label.toLocaleLowerCase("ru-RU")}:</span> {field.missingTreatment.split(" — ")[1] ?? field.missingTreatment}</p>)}
        </div>;
      })}
      {asOfMonthSource === "current_date" && <p className={styles.assumption}>Расчётный месяц взят по текущей дате: загруженные снимки текущего остатка не содержат отдельной даты остатка.</p>}
    </article>

    <article className={styles.analyticsBlock}>
      <h3>Плановые допущения текущего расчёта</h3>
      <div className={styles.barRow}><span>Срок поставки</span><span /><span>{planning.leadTimeMonths} мес.</span></div>
      <div className={styles.barRow}><span>Период пересмотра</span><span /><span>{planning.reviewPeriodMonths} мес.</span></div>
      <div className={styles.barRow}><span>Внешний прогноз роста</span><span /><span>{planning.forecastGrowthPercent}%</span></div>
      <div className={styles.barRow}><span>Сервис A / кат. 1</span><span /><span>{planning.serviceLevelA}%</span></div>
      <div className={styles.barRow}><span>Сервис B / кат. 2</span><span /><span>{planning.serviceLevelB}%</span></div>
      <div className={styles.barRow}><span>Сервис C / кат. 3–4</span><span /><span>{planning.serviceLevelC}%</span></div>
      <div className={styles.barRow}><span>Сервис без категории</span><span /><span>{planning.unclassifiedServiceLevel}%</span></div>
      <p className={styles.gateHint} style={{ marginTop: 12 }}>Изменить эти значения можно только для нового расчёта — экран «Новый расчёт» вернёт к вводу параметров.</p>
    </article>

    <article className={styles.analyticsBlock}>
      <h3>Термины</h3>
      <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
        <li><b>Срочно / Контроль / Планово</b> — покрытие текущей позиции меньше срока поставки / меньше горизонта / достаточно.</li>
        <li><b>Стабильный / Волатильный / Прерывистый</b> — характер истории продаж (частота ненулевых месяцев и разброс).</li>
        <li><b>Мёртвый запас</b> — автозаказ заблокирован; <b>Медленный</b> — план по среднему за последние 3 месяца.</li>
      </ul>
    </article>
  </>;
}
