"use client";

import type { Dispatch, SetStateAction } from "react";
import { FILE_FIELDS, SUPPLIERS, type FileKind, type FilesState, type PlanningControls, type SupplierKey } from "./shared";
import styles from "./replenishment.module.css";

type Mode = "demo" | "manual";

export function UploadGate(props: {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  files: FilesState;
  setFiles: Dispatch<SetStateAction<FilesState>>;
  planning: PlanningControls;
  setPlanning: Dispatch<SetStateAction<PlanningControls>>;
  error: string;
  running: boolean;
  progress: string;
  ready: boolean;
  selectedCount: number;
  onRun: () => void;
}) {
  const { mode, onModeChange, files, setFiles, planning, setPlanning, error, running, progress, ready, selectedCount, onRun } = props;

  const setFile = (supplier: SupplierKey, kind: FileKind, file: File | undefined) => {
    setFiles((current) => ({ ...current, [supplier]: { ...current[supplier], [kind]: file } }));
  };

  return <section className={styles.uploadArea} aria-label="Загрузка исходных данных">
    <div className={styles.gateActions}>
      <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={running && mode === "demo"} onClick={() => { onModeChange("demo"); onRun(); }}>
        {running && mode === "demo" ? "Загружаем демо…" : "Пересчитать демо на реальных данных"}
      </button>
      <button type="button" className={styles.btn} onClick={() => onModeChange("manual")}>Загрузить свои файлы →</button>
    </div>

    {running
      ? <div className={styles.empty}>{progress || "Загрузка данных…"}</div>
      : <p className={styles.gateHint}>
          {mode === "demo"
            ? "По умолчанию открывается готовый расчёт на реальных выгрузках IEK и Systeme Electric — файлы никуда не отправляются, всё считается в браузере."
            : "Выберите пять файлов на каждого поставщика — те же типы, что и в демо-наборе."}
        </p>}

    {mode === "manual" && !running && <>
      <div className={styles.sectionHead}><div><p>Входные данные</p><h2>Два поставщика, один расчётный контур</h2></div><b>{selectedCount}/10 файлов</b></div>
      <div className={styles.supplierGrid}>{SUPPLIERS.map((supplier) => <article className={styles.supplierCard} key={supplier.key}>
        <header><span>{supplier.code}</span><div><small>ПОСТАВЩИК</small><h3>{supplier.name}</h3></div></header>
        <div className={styles.fileList}>{FILE_FIELDS.map((field) => {
          const file = files[supplier.key][field.kind];
          return <label className={`${styles.fileField} ${file ? styles.loaded : ""}`} key={field.kind}>
            <input type="file" accept=".xlsx,.xls" onChange={(event) => setFile(supplier.key, field.kind, event.target.files?.[0])} />
            <span>{file ? "✓" : "+"}</span><div><b>{field.label}</b><small>{file?.name ?? field.hint}</small></div>
          </label>;
        })}</div>
      </article>)}</div>
    </>}

    <fieldset className={styles.planningControls}>
      <legend>Плановые допущения</legend>
      <label><span>Срок поставки, мес.</span><input type="number" min="0.1" step="0.1" value={planning.leadTimeMonths} onChange={(event) => setPlanning((current) => ({ ...current, leadTimeMonths: Number(event.target.value) }))} /></label>
      <label><span>Период пересмотра, мес.</span><input type="number" min="0" step="0.1" value={planning.reviewPeriodMonths} onChange={(event) => setPlanning((current) => ({ ...current, reviewPeriodMonths: Number(event.target.value) }))} /></label>
      <label><span>Внешний прогноз, %</span><input type="number" min="-99" step="1" value={planning.forecastGrowthPercent} onChange={(event) => setPlanning((current) => ({ ...current, forecastGrowthPercent: Number(event.target.value) }))} /></label>
      <label><span>Сервис A / кат. 1, %</span><input type="number" min="90" max="99.5" step="0.1" value={planning.serviceLevelA} onChange={(event) => setPlanning((current) => ({ ...current, serviceLevelA: Number(event.target.value) }))} /></label>
      <label><span>Сервис B / кат. 2, %</span><input type="number" min="90" max="99.5" step="0.1" value={planning.serviceLevelB} onChange={(event) => setPlanning((current) => ({ ...current, serviceLevelB: Number(event.target.value) }))} /></label>
      <label><span>Сервис C / кат. 3–4, %</span><input type="number" min="90" max="99.5" step="0.1" value={planning.serviceLevelC} onChange={(event) => setPlanning((current) => ({ ...current, serviceLevelC: Number(event.target.value) }))} /></label>
      <label><span>Сервис IEK без категории, %</span><input type="number" min="90" max="99.5" step="0.1" value={planning.unclassifiedServiceLevel} onChange={(event) => setPlanning((current) => ({ ...current, unclassifiedServiceLevel: Number(event.target.value) }))} /></label>
    </fieldset>

    {mode === "manual" && <div className={styles.runbar}>
      <div><span>Все вычисления выполняются локально в браузере</span><small>Файлы не отправляются во внешние сервисы</small></div>
      <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={!ready || running} onClick={onRun}>{running ? "Обработка…" : "Рассчитать заказы →"}</button>
    </div>}

    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>;
}
