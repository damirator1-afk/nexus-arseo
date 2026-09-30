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

  const addFiles = (supplier: SupplierKey, kind: FileKind, selected: File[]) => {
    if (!selected.length) return;
    setFiles((current) => {
      const existing = current[supplier]?.[kind] ?? [];
      const fingerprints = new Set(existing.map((file) => `${file.name}\u0000${file.size}\u0000${file.lastModified}`));
      const additions = selected.filter((file) => !fingerprints.has(`${file.name}\u0000${file.size}\u0000${file.lastModified}`));
      return { ...current, [supplier]: { ...current[supplier], [kind]: [...existing, ...additions] } };
    });
    setSupplierErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== supplier)));
  };

  const removeFile = (supplier: SupplierKey, kind: FileKind, index: number) => {
    setFiles((current) => ({
      ...current,
      [supplier]: {
        ...current[supplier],
        [kind]: (current[supplier]?.[kind] ?? []).filter((_, fileIndex) => fileIndex !== index),
      },
    }));
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
      <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={running} onClick={() => { onModeChange("demo"); onRun("demo"); }}>
        {running && mode === "demo" ? "Загружаем демо…" : "Посмотреть демо на реальных данных"}
      </button>
      <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={running} onClick={() => onModeChange("manual")}>Загрузить свои документы</button>
    </div>

    {running
      ? <div className={styles.empty}>{progress || "Загрузка данных…"}</div>
      : <p className={styles.gateHint}>
          {mode === "demo"
            ? "Демо использует реальные выгрузки IEK и Systeme Electric. Расчёт начнётся только после нажатия кнопки — все данные обрабатываются в браузере."
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
        const loadedFields = FILE_FIELDS.filter((field) => supplierFiles[field.kind]?.length);
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
            const kindFiles = supplierFiles[field.kind] ?? [];
            return <div className={styles.fileSource} key={field.kind}>
              <label className={`${styles.fileField} ${kindFiles.length ? styles.loaded : ""}`}>
                <input
                  type="file"
                  multiple
                  accept=".xlsx,.xls"
                  onChange={(event) => {
                    addFiles(supplier.key, field.kind, Array.from(event.currentTarget.files ?? []));
                    event.currentTarget.value = "";
                  }}
                />
                <span>{kindFiles.length ? "✓" : "+"}</span>
                <div>
                  <b>{field.label} <em>опционально</em></b>
                  <small>{kindFiles.length ? `${kindFiles.length} файл(ов) выбрано` : field.hint}</small>
                </div>
              </label>
              {kindFiles.length > 0 && <ul className={styles.selectedFiles}>{kindFiles.map((file, fileIndex) => <li key={`${file.name}-${file.size}-${file.lastModified}-${fileIndex}`}>
                <span title={file.name}>{file.name}</span>
                <button type="button" aria-label={`Убрать файл ${file.name}`} onClick={() => removeFile(supplier.key, field.kind, fileIndex)}>Убрать</button>
              </li>)}</ul>}
            </div>;
          })}</div>

          <div className={styles.sourceSummary}>
            <b>Сводка перед расчётом</b>
            <p><span className={styles.sourcePresent}>Есть:</span> {loadedFields.length ? loadedFields.map((field) => {
              const count = supplierFiles[field.kind]?.length ?? 0;
              return `${field.label}${count > 1 ? ` (${count} файла)` : ""}`;
            }).join(", ") : "файлы пока не выбраны"}</p>
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
      <label><span>Годен от ОСГ, %</span><input type="number" min="0" max="100" step="1" value={planning.shelfLifeValidityThresholdPercent} onChange={(event) => setPlanning((current) => ({ ...current, shelfLifeValidityThresholdPercent: Number(event.target.value) }))} /></label>
      <label><span>Год для месяцев без указания года (если применимо)</span><input type="number" min="1900" max="9999" step="1" value={planning.assumedYearForBareMonths ?? ""} onChange={(event) => setPlanning((current) => ({ ...current, assumedYearForBareMonths: event.target.value ? Number(event.target.value) : undefined }))} /></label>
    </fieldset>

    {mode === "manual" && <div className={styles.runbar}>
      <div><span>Все вычисления выполняются локально в браузере</span><small>Файлы не отправляются во внешние сервисы; при первом запуске проверим наличие источника остатка</small></div>
      <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={!ready || running} onClick={() => onRun("manual")}>{running ? "Обработка…" : "Рассчитать заказы →"}</button>
    </div>}

    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>;
}
