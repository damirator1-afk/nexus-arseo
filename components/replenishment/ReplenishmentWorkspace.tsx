"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { assembleReplenishmentInput } from "@/lib/nexus/replenishment/assemble";
import { calculateReplenishment, type ReplenishmentPlan, type ReplenishmentRecommendation } from "@/lib/nexus/replenishment/calculation";
import type { ConfirmedOrderLine } from "@/lib/nexus/replenishment/orderShare";
import { summarizePlan } from "@/lib/nexus/replenishment/planSelectors";
import { parseSkuCostPrices } from "@/lib/nexus/replenishment/xlsxParsers";
import { fetchDemoSupplierBuffers } from "./demoData";
import {
  buildAssumptions, buildSupplierParsedData, csvCell, DEFAULT_PLANNING, FILE_FIELDS, matchesExceptionView,
  narrationInput, parseSupplierFromFiles, SUPPLIERS, urgencyRank,
  type DataSource, type ExceptionView, type FilesState, type ManagerDecision, type PlanningControls,
} from "./shared";
import { UploadGate } from "./UploadGate";
import { ThemeToggle } from "./ThemeToggle";
import { TodayTab } from "./tabs/TodayTab";
import { OrdersTab } from "./tabs/OrdersTab";
import { CalendarTab } from "./tabs/CalendarTab";
import { AnalyticsTab } from "./tabs/AnalyticsTab";
import { MethodologyTab } from "./tabs/MethodologyTab";
import styles from "./replenishment.module.css";

type Tab = "today" | "orders" | "calendar" | "analytics" | "methodology";
type Mode = "demo" | "manual";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "today", label: "Что делать сегодня" },
  { key: "orders", label: "Заказ поставщикам" },
  { key: "calendar", label: "Календарь заказов" },
  { key: "analytics", label: "Аналитика" },
  { key: "methodology", label: "Методика и данные" },
];

export function ReplenishmentWorkspace() {
  const shellRef = useRef<HTMLElement>(null);
  const autoRanRef = useRef(false);

  const [files, setFiles] = useState<FilesState>({ iek: {}, systeme: {} });
  const [mode, setMode] = useState<Mode>("demo");
  const [plan, setPlan] = useState<ReplenishmentPlan>();
  const [dataSource, setDataSource] = useState<DataSource>();
  // SKU -> per-unit cost price, presentation-only (never fed into assembleReplenishmentInput /
  // calculateReplenishment). Only Systeme Electric's dashboard exposes a price column; IEK has
  // none. Built alongside the parse step, not part of SupplierParsedData.
  const [costPrices, setCostPrices] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("today");
  const [focusSku, setFocusSku] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [narratives, setNarratives] = useState<Record<string, string>>({});
  const [narrating, setNarrating] = useState<Record<string, boolean>>({});
  const [exceptionView, setExceptionView] = useState<ExceptionView>("all");
  const [decisions, setDecisions] = useState<Record<string, ManagerDecision>>({});
  const [planning, setPlanning] = useState<PlanningControls>(DEFAULT_PLANNING);

  const selectedCount = Object.values(files).flatMap((group) => Object.values(group)).length;
  const ready = selectedCount === FILE_FIELDS.length * SUPPLIERS.length;

  const summary = useMemo(() => summarizePlan(plan?.suppliers.flatMap((group) => group.items) ?? []), [plan]);

  const priceCoverage = useMemo(() => {
    const items = plan?.suppliers.flatMap((group) => group.items) ?? [];
    return { known: items.filter((item) => costPrices.has(item.sku)).length, total: items.length };
  }, [plan, costPrices]);

  const visible = useMemo(() => plan?.suppliers.map((group) => ({
    ...group,
    items: group.items.filter((item) => matchesExceptionView(item, exceptionView) && `${item.sku} ${item.productName}`.toLocaleLowerCase("ru-RU").includes(query.toLocaleLowerCase("ru-RU"))).sort((a, b) => urgencyRank[a.urgency] - urgencyRank[b.urgency] || b.recommendedOrder - a.recommendedOrder),
  })).map((group) => ({ ...group, totalRecommendedUnits: group.items.reduce((sum, item) => sum + item.recommendedOrder, 0) })) ?? [], [plan, query, exceptionView]);

  const confirmedRows = useMemo<ConfirmedOrderLine[]>(() => plan?.suppliers.flatMap((group) => group.items.flatMap((item) => {
    const decision = decisions[`${item.supplier}:${item.sku}`];
    return decision?.status === "confirmed" ? [{
      supplier: item.supplier,
      sku: item.sku,
      productName: item.productName,
      recommendedOrder: item.recommendedOrder,
      quantity: decision.quantity,
      urgency: item.urgency,
    }] : [];
  })) ?? [], [plan, decisions]);

  const downloadConfirmedOrders = () => {
    if (!confirmedRows.length) return;
    const header = ["Поставщик", "SKU", "Наименование", "Рекомендация", "Подтверждено", "Срочность"];
    const rows = confirmedRows.map((item) => [item.supplier, item.sku, item.productName, item.recommendedOrder, item.quantity, item.urgency]);
    const csv = `﻿${[header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `nexus-purchase-orders-${plan?.asOfMonth ?? "export"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const runDemo = async () => {
    setRunning(true); setError(""); setProgress("Загружаем файлы партнёра…");
    try {
      // Real partner workbooks run to hundreds of thousands of rows; parsing all 10 files as one
      // uninterrupted block would freeze clicks/repaints for 10+ seconds. Parsing yields between
      // steps (see buildSupplierParsedData) and reports progress here so the tab stays responsive
      // and visibly working instead of looking stuck.
      const results = await Promise.all(SUPPLIERS.map(async (supplier) => {
        const buffers = await fetchDemoSupplierBuffers(supplier.key);
        const parsedData = await buildSupplierParsedData(supplier.key, buffers, setProgress);
        // Cost price ("СС реал") is presentation-only and only Systeme Electric's dashboard has
        // it; parsed from the same already-fetched "inbound" buffer, no extra request.
        const prices = supplier.key === "systeme" ? parseSkuCostPrices(buffers.inbound) : [];
        return { parsedData, prices };
      }));
      setProgress("Считаем рекомендации по 3000+ позициям…");
      await new Promise((resolve) => setTimeout(resolve, 0));
      setPlan(calculateReplenishment(assembleReplenishmentInput(results.map((r) => r.parsedData), buildAssumptions(planning))));
      setCostPrices(new Map(results.flatMap((r) => r.prices.map((p) => [p.sku, p.costPrice] as const))));
      setDataSource("demo"); setDecisions({}); setExceptionView("all"); setActiveTab("today");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить демо-данные на реальных файлах партнёра.");
      setMode("manual");
    } finally { setRunning(false); setProgress(""); }
  };

  const runManual = async () => {
    setRunning(true); setError(""); setProgress("Читаем выбранные файлы…");
    try {
      const parsed = await Promise.all(SUPPLIERS.map((supplier) => parseSupplierFromFiles(supplier.key, files[supplier.key], setProgress)));
      const systemeInbound = files.systeme.inbound;
      const prices = systemeInbound ? parseSkuCostPrices(new Uint8Array(await systemeInbound.arrayBuffer())) : [];
      setProgress("Считаем рекомендации по 3000+ позициям…");
      await new Promise((resolve) => setTimeout(resolve, 0));
      setPlan(calculateReplenishment(assembleReplenishmentInput(parsed, buildAssumptions(planning))));
      setCostPrices(new Map(prices.map((p) => [p.sku, p.costPrice] as const)));
      setDataSource("own"); setDecisions({}); setExceptionView("all"); setActiveTab("today");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось обработать XLSX-файлы.");
    } finally { setRunning(false); setProgress(""); }
  };

  // Opens with a real, already-computed result — no click required — unless the user has switched
  // to manual upload before this fires. Guarded by a ref (not state) so React's dev-mode double-effect
  // cannot trigger two concurrent fetches of the ~15MB demo dataset.
  useEffect(() => {
    if (autoRanRef.current) return;
    autoRanRef.current = true;
    void runDemo();
    // Intentionally mount-only: this is the initial, default-assumptions demo load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onGateRun = () => { if (mode === "demo") void runDemo(); else void runManual(); };

  const onNewCalculation = () => {
    setPlan(undefined); setDataSource(undefined); setDecisions({}); setExceptionView("all");
    setQuery(""); setFocusSku(null); setMode("demo"); setActiveTab("today");
    void runDemo();
  };

  const onOpenSku = (sku: string) => {
    setFocusSku(sku); setExceptionView("all"); setQuery(""); setActiveTab("orders");
  };

  const requestNarrative = async (item: ReplenishmentRecommendation) => {
    const key = `${item.supplier}:${item.sku}`;
    setNarrating((current) => ({ ...current, [key]: true }));
    try {
      const response = await fetch("/api/replenishment/narrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(narrationInput(item)),
      });
      const result = await response.json() as { narrative?: unknown; source?: unknown };
      const narrative = typeof result.narrative === "string" ? result.narrative.trim() : "";
      if (response.ok && result.source === "LLM" && narrative) {
        setNarratives((current) => ({ ...current, [key]: narrative }));
      }
    } catch {
      // The deterministic explanation remains visible; LLM narration is optional enhancement only.
    } finally {
      setNarrating((current) => ({ ...current, [key]: false }));
    }
  };

  return <main className={styles.shell} ref={shellRef}>
    <header className={styles.topbar}>
      <a href="/" className={styles.brand}>
        <span>ЭК</span>
        <div><b>Электрокомплект</b><small>Автозаказ поставщикам</small></div>
      </a>
      <div style={{ marginLeft: "auto" }}><ThemeToggle shellRef={shellRef} /></div>
    </header>

    <div className={styles.ctx}>
      <span className={styles.ctxItem}>Расчёт <b>детерминированный</b></span>
      <span className={styles.ctxItem}>Срок поставки <b>{planning.leadTimeMonths} мес.</b></span>
      <span className={styles.ctxItem}>Период пересмотра <b>{planning.reviewPeriodMonths} мес.</b></span>
      {plan && <span className={styles.ctxItem}>Данные <b>{dataSource === "demo" ? "демо на реальных файлах" : "свои файлы"}</b></span>}
      {plan && <span className={styles.ctxItem}>Расчёт на <b>{plan.asOfMonth}</b></span>}
    </div>

    {!plan && <UploadGate
      mode={mode}
      onModeChange={setMode}
      files={files}
      setFiles={setFiles}
      planning={planning}
      setPlanning={setPlanning}
      error={error}
      running={running}
      progress={progress}
      ready={ready}
      selectedCount={selectedCount}
      onRun={onGateRun}
    />}

    {plan && <div className={styles.uploadArea}>
      <nav className={styles.tabs} role="tablist" aria-label="Разделы">
        {TABS.map((tab) => <button key={tab.key} className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ""}`} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>)}
      </nav>

      {activeTab === "today" && <TodayTab plan={plan} summary={summary} dataSource={dataSource ?? "own"} costPrices={costPrices} onOpenSku={onOpenSku} />}
      {activeTab === "orders" && <OrdersTab
        plan={plan}
        visible={visible}
        costPrices={costPrices}
        confirmedRows={confirmedRows}
        query={query}
        setQuery={setQuery}
        exceptionView={exceptionView}
        setExceptionView={setExceptionView}
        decisions={decisions}
        setDecisions={setDecisions}
        narratives={narratives}
        narrating={narrating}
        requestNarrative={requestNarrative}
        downloadConfirmedOrders={downloadConfirmedOrders}
        onNewCalculation={onNewCalculation}
        focusSku={focusSku}
      />}
      {activeTab === "calendar" && <CalendarTab plan={plan} onOpenSku={onOpenSku} />}
      {activeTab === "analytics" && <AnalyticsTab summary={summary} priceCoverage={priceCoverage} />}
      {activeTab === "methodology" && <MethodologyTab planning={planning} />}
    </div>}

    <footer className={styles.footer}><span>HackAlem AI / ТОО «Электрокомплект»</span><span>Проверяемая модель · без скрытых вычислений</span></footer>
  </main>;
}
