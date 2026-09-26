"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildSupplierOrderMessage, groupConfirmedOrders, supplierOrderCsv,
  telegramShareUrl, whatsappShareUrl, type ConfirmedOrderLine,
} from "@/lib/nexus/replenishment/orderShare";
import { CloseIcon, DownloadIcon, MessageIcon, SendIcon } from "./icons";
import { number } from "./shared";
import styles from "./replenishment.module.css";

const lineKey = (line: ConfirmedOrderLine): string => `${line.supplier}:${line.sku}`;

function downloadCsv(lines: ConfirmedOrderLine[], supplier: string, asOfMonth: string) {
  const url = URL.createObjectURL(new Blob([supplierOrderCsv(lines, asOfMonth)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `nexus-order-${supplier.toLocaleLowerCase("ru-RU").replace(/[^a-zа-я0-9]+/giu, "-")}-${asOfMonth}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function SupplierDispatch({ lines, asOfMonth }: { lines: ConfirmedOrderLine[]; asOfMonth: string }) {
  const drafts = useMemo(() => groupConfirmedOrders(lines), [lines]);
  const [activeSupplier, setActiveSupplier] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  const activeDraft = drafts.find((draft) => draft.supplier === activeSupplier) ?? null;
  const selectedLines = activeDraft?.lines.filter((line) => selected.has(lineKey(line))) ?? [];
  const message = activeDraft ? buildSupplierOrderMessage(activeDraft.supplier, selectedLines, asOfMonth) : "";

  const openDraft = (supplier: string) => {
    const draft = drafts.find((item) => item.supplier === supplier);
    if (!draft) return;
    setActiveSupplier(supplier);
    setSelected(new Set(draft.lines.map(lineKey)));
    setCopied(false);
  };

  const close = () => { setActiveSupplier(null); setCopied(false); };

  useEffect(() => {
    if (!activeDraft) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activeDraft]);

  const toggleLine = (line: ConfirmedOrderLine) => {
    const key = lineKey(line);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setCopied(false);
  };

  const toggleAll = () => {
    if (!activeDraft) return;
    setSelected(selectedLines.length === activeDraft.lines.length ? new Set() : new Set(activeDraft.lines.map(lineKey)));
    setCopied(false);
  };

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return <section className={styles.dispatchSection} aria-label="Отправка заказов поставщикам">
    <div className={styles.dispatchIntro}>
      <div><span>Последний шаг</span><h3>Подготовить заказ поставщику</h3></div>
      <p>В отправку попадают только количества, которые менеджер подтвердил в таблице ниже.</p>
    </div>

    {drafts.length ? <div className={styles.dispatchCards}>{drafts.map((draft) => <article className={styles.dispatchCard} key={draft.supplier}>
      <div className={styles.dispatchCardMark}><MessageIcon size={19} /></div>
      <div className={styles.dispatchCardCopy}>
        <b>{draft.supplier}</b>
        <span><strong className={styles.num}>{draft.lines.length}</strong> поз. · <strong className={styles.num}>{number.format(draft.totalUnits)}</strong> шт.</span>
      </div>
      <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => openDraft(draft.supplier)}><SendIcon size={15} />Подготовить отправку</button>
    </article>)}</div> : <div className={styles.dispatchEmpty}>
      <MessageIcon size={19} /> Подтвердите хотя бы одну позицию в столбце «Обоснование» — после этого здесь появится заказ поставщику.
    </div>}

    {activeDraft && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className={styles.dispatchModal} role="dialog" aria-modal="true" aria-labelledby="dispatch-title">
        <header className={styles.modalHead}>
          <div><span>Заказ поставщику</span><h2 id="dispatch-title">{activeDraft.supplier}</h2></div>
          <button type="button" className={styles.iconButton} onClick={close} aria-label="Закрыть"><CloseIcon size={18} /></button>
        </header>

        <div className={styles.dispatchSteps} aria-label="Этапы отправки">
          <span className={styles.stepActive}>1 · Выбор</span><i /><span>2 · Файл и сообщение</span><i /><span>3 · Отправка</span>
        </div>

        <div className={styles.dispatchFacts}>
          <div><b className={styles.num}>{selectedLines.length}</b><span>позиций выбрано</span></div>
          <div><b className={styles.num}>{number.format(selectedLines.reduce((sum, line) => sum + line.quantity, 0))}</b><span>единиц в заказе</span></div>
          <div><b>{asOfMonth}</b><span>дата расчёта</span></div>
        </div>

        <div className={styles.dispatchToolbar}>
          <label><input type="checkbox" checked={selectedLines.length === activeDraft.lines.length && activeDraft.lines.length > 0} onChange={toggleAll} />Выбрать все подтверждённые</label>
          <span>{selectedLines.length} из {activeDraft.lines.length}</span>
        </div>
        <div className={styles.dispatchList}>{activeDraft.lines.map((line) => <label key={lineKey(line)} className={styles.dispatchLine}>
          <input type="checkbox" checked={selected.has(lineKey(line))} onChange={() => toggleLine(line)} />
          <span><b>{line.sku}</b><small>{line.productName}</small></span>
          <strong className={styles.num}>{number.format(line.quantity)} шт.</strong>
        </label>)}</div>

        <div className={styles.messagePreview}>
          <div><b>Предпросмотр сообщения</b><button type="button" onClick={() => void copyMessage()}>{copied ? "Скопировано" : "Копировать текст"}</button></div>
          <pre>{message}</pre>
        </div>

        <div className={styles.dispatchNotice}>Мессенджер откроется с готовым текстом. Получателя и окончательную отправку всегда подтверждает менеджер. Полный перечень передайте отдельным CSV-файлом.</div>

        <footer className={styles.modalActions}>
          <button type="button" className={styles.btn} disabled={!selectedLines.length} onClick={() => downloadCsv(selectedLines, activeDraft.supplier, asOfMonth)}><DownloadIcon size={15} />Скачать CSV</button>
          <a className={`${styles.btn} ${styles.whatsappButton} ${!selectedLines.length ? styles.linkDisabled : ""}`} href={selectedLines.length ? whatsappShareUrl(message) : undefined} target="_blank" rel="noreferrer">WhatsApp</a>
          <a className={`${styles.btn} ${styles.telegramButton} ${!selectedLines.length ? styles.linkDisabled : ""}`} href={selectedLines.length ? telegramShareUrl(message, typeof window === "undefined" ? "" : window.location.href) : undefined} target="_blank" rel="noreferrer"><SendIcon size={15} />Telegram</a>
        </footer>
      </section>
    </div>}
  </section>;
}
