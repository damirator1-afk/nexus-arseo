"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import {
  FILE_FIELDS,
  supplierKeyFromName,
  supplierMissingTreatments,
  type FileKind,
  type FilesState,
  type PlanningControls,
  type SupplierDefinition,
  type SupplierKey,
} from "./shared";
import styles from "./replenishment.module.css";

type Mode = "demo" | "manual";

export function UploadGate(props: {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  suppliers: SupplierDefinition[];
  setSuppliers: Dispatch<SetStateAction<SupplierDefinition[]>>;
  files: FilesState;
  setFiles: Dispatch<SetStateAction<FilesState>>;
  supplierErrors: Record<string, string>;
  setSupplierErrors: Dispatch<SetStateAction<Record<string, string>>>;
  planning: PlanningControls;
  setPlanning: Dispatch<SetStateAction<PlanningControls>>;
  error: string;
  running: boolean;
  progress: string;
  ready: boolean;
  selectedCount: number;
  onRun: (mode: Mode) => void;
}) {
  const {
    mode, onModeChange, suppliers, setSuppliers, files, setFiles, supplierErrors, setSupplierErrors,
    planning, setPlanning, error, running, progress, ready, selectedCount, onRun,
  } = props;
  const [newSupplierName, setNewSupplierName] = useState("");
  const normalizedNames = suppliers.map((supplier) => supplier.name.trim().toLocaleLowerCase("ru-RU"));

  const setFile = (supplier: SupplierKey, kind: FileKind, file: File | undefined) => {
    setFiles((current) => ({ ...current, [supplier]: { ...current[supplier], [kind]: file } }));
    setSupplierErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== supplier)));
  };

  const addSupplier = () => {
    const name = newSupplierName.trim();
    if (!name) return;
    const key = supplierKeyFromName(name, suppliers.map((supplier) => supplier.key));
    setSuppliers((current) => [...current, { key, name }]);
    setFiles((current) => ({ ...current, [key]: {} }));
    setNewSupplierName("");
  };

  const removeSupplier = (key: string) => {
    setSuppliers((current) => current.filter((supplier) => supplier.key !== key));
    setFiles((current) => Object.fromEntries(Object.entries(current).filter(([supplierKey]) => supplierKey !== key)));
  };

  return <section className={styles.uploadArea} aria-label="Загрузка исходных данных">
    <div className={styles.gateActions}>
      <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={running && mode === "demo"} onClick={() => { onModeChange("demo"); onRun("demo"); }}>
        {running && mode === "demo" ? "Загружаем демо…" : "Пересчитать демо на реальных данных"}
      </button>
      <button type="button" className={styles.btn} disabled={running} onClick={() => onModeChange("manual")}>Загрузить свои файлы →</button>
    </div>

    {running
      ? <div className={styles.empty}>{progress || "Загрузка данных…"}</div>
      : <p className={styles.gateHint}>
          {mode === "demo"
            ? "По умолчанию открывается готовый расчёт на реальных выгрузках IEK и Systeme Electric — файлы никуда не отправляются, всё считается в браузере."
            : "Добавьте поставщиков и загрузите доступные XLSX. Обязателен только источник остатка; остальные файлы можно пропустить."}
        </p>}

    {mode === "manual" && !running && <>
      <div className={styles.sectionHead}>
        <div><p>Входные данные</p><h2>Поставщики и доступные источники</h2></div>
        <b>{selectedCount} файлов · {suppliers.length} поставщиков</b>
      </div>

      <div className={styles.addSupplierRow}>
        <label>
          <span>Название поставщика</span>
          <input
            value={newSupplierName}
            onChange={(event) => setNewSupplierName(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addSupplier(); } }}
            placeholder="Например, Schneider Central Asia"
          />
        </label>
        <button type="button" className={`${styles.btn} ${styles.btnGhost}`} disabled={!newSupplierName.trim()} onClick={addSupplier}>+ Добавить поставщика</button>
      </div>

      {!suppliers.length && <p className={styles.error} role="alert">Добавьте хотя бы одного поставщика.</p>}

      <div className={styles.supplierGrid}>{suppliers.map((supplier, index) => {
        const supplierFiles = files[supplier.key] ?? {};
        const loadedFields = FILE_FIELDS.filter((field) => supplierFiles[field.kind]);
        const missingTreatments = supplierMissingTreatments(supplierFiles);
        const normalizedName = supplier.name.trim().toLocaleLowerCase("ru-RU");
        const nameError = !normalizedName
          ? "Укажите название поставщика."
          : normalizedNames.filter((name) => name === normalizedName).length > 1 ? "Название поставщика должно быть уникальным." : "";
        return <article className={styles.supplierCard} key={supplier.key}>
          <header>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <label className={styles.supplierNameField}>
              <small>ПОСТАВЩИК</small>
              <input
                aria-label={`Название поставщика ${index + 1}`}
                value={supplier.name}
                onChange={(event) => setSuppliers((current) => current.map((item) => item.key === supplier.key ? { ...item, name: event.target.value } : item))}
              />
            </label>
            <button type="button" className={styles.removeSupplier} aria-label={`Удалить ${supplier.name || "поставщика"}`} onClick={() => removeSupplier(supplier.key)}>Удалить</button>
          </header>

          <div className={styles.fileList}>{FILE_FIELDS.map((field) => {
            const file = supplierFiles[field.kind];
            return <label className={`${styles.fileField} ${file ? styles.loaded : ""}`} key={field.kind}>
              <input type="file" accept=".xlsx,.xls" onChange={(event) => setFile(supplier.key, field.kind, event.target.files?.[0])} />
              <span>{file ? "✓" : "+"}</span>
              <div><b>{field.label} <em>опционально</em></b><small>{file?.name ?? field.hint}</small></div>
            </label>;
          })}</div>

          <div className={styles.sourceSummary}>
            <b>Сводка перед расчётом</b>
            <p><span className={styles.sourcePresent}>Есть:</span> {loadedFields.length ? loadedFields.map((field) => field.label).join(", ") : "файлы пока не выбраны"}</p>
            {missingTreatments.map((treatment) => <p key={treatment}><span className={styles.sourceMissing}>Пробел:</span> {treatment}</p>)}
          </div>

          {(nameError || supplierErrors[supplier.key]) && <p className={styles.inlineWarning} role="alert">{nameError || supplierErrors[supplier.key]}</p>}
        </article>;
      })}</div>
    </>}

    <fieldset className={styles.planningControls}>
      <legend>Плановые допущения</legend>
      <label><span>Срок поставки, мес.</span><input type="number" min="0.1" step="0.1" value={planning.leadTimeMonths} onChange={(event) => setPlanning((current) => ({ ...current, leadTimeMonths: Number(event.target.value) }))} /></label>
      <label><span>Период пересмотра, мес.</span><input type="number" min="0" step="0.1" value={planning.reviewPeriodMonths} onChange={(event) => setPlanning((current) => ({ ...current, reviewPeriodMonths: Number(event.target.value) }))} /></label>
      <label><span>Внешний прогноз, %</span><input type="number" min="-99" step="1" value={planning.forecastGrowthPercent} onChange={(event) => setPlanning((current) => ({ ...current, forecastGrowthPercent: Number(event.target.value) }))} /></label>
      <label><span>Сервис A / кат. 1, %</span><input type="number" min="90" max="99.5" step="0.1" value={planning.serviceLevelA} onChange={(event) => setPlanning((current) => ({ ...current, serviceLevelA: Number(event.target.value) }))} /></label>
      <label><span>Сервис B / кат. 2, %</span><input type="number" min="90" max="99.5" step="0.1" value={planning.serviceLevelB} onChange={(event) => setPlanning((current) => ({ ...current, serviceLevelB: Number(event.target.value) }))} /></label>
      <label><span>Сервис C / кат. 3–4, %</span><input type="number" min="90" max="99.5" step="0.1" value={planning.serviceLevelC} onChange={(event) => setPlanning((current) => ({ ...current, serviceLevelC: Number(event.target.value) }))} /></label>
      <label><span>Сервис без категории, %</span><input type="number" min="90" max="99.5" step="0.1" value={planning.unclassifiedServiceLevel} onChange={(event) => setPlanning((current) => ({ ...current, unclassifiedServiceLevel: Number(event.target.value) }))} /></label>
    </fieldset>

    {mode === "manual" && <div className={styles.runbar}>
      <div><span>Все вычисления выполняются локально в браузере</span><small>Файлы не отправляются во внешние сервисы; при первом запуске проверим наличие источника остатка</small></div>
      <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={!ready || running} onClick={() => onRun("manual")}>{running ? "Обработка…" : "Рассчитать заказы →"}</button>
    </div>}

    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>;
}
