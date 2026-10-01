import type { ReplenishmentUrgency } from "./calculation.ts";

export interface ConfirmedOrderLine {
  supplier: string;
  sku: string;
  productName: string;
  recommendedOrder: number;
  quantity: number;
  urgency: ReplenishmentUrgency;
}

export interface SupplierOrderDraft {
  supplier: string;
  lines: ConfirmedOrderLine[];
  totalUnits: number;
}

export const SHARE_MESSAGE_LINE_LIMIT = 25;

export function groupConfirmedOrders(lines: ConfirmedOrderLine[]): SupplierOrderDraft[] {
  const groups = new Map<string, ConfirmedOrderLine[]>();
  for (const line of lines) {
    if (!(line.quantity > 0)) continue;
    const supplierLines = groups.get(line.supplier) ?? [];
    supplierLines.push(line);
    groups.set(line.supplier, supplierLines);
  }
  return [...groups.entries()].map(([supplier, supplierLines]) => ({
    supplier,
    lines: supplierLines.sort((a, b) => a.sku.localeCompare(b.sku)),
    totalUnits: supplierLines.reduce((sum, line) => sum + line.quantity, 0),
  })).sort((a, b) => a.supplier.localeCompare(b.supplier));
}

export function buildSupplierOrderMessage(
  supplier: string,
  lines: ConfirmedOrderLine[],
  asOfMonth: string,
  lineLimit = SHARE_MESSAGE_LINE_LIMIT,
): string {
  const selected = lines.filter((line) => line.quantity > 0);
  const totalUnits = selected.reduce((sum, line) => sum + line.quantity, 0);
  const shown = selected.slice(0, Math.max(0, lineLimit));
  const hidden = selected.length - shown.length;
  const details = shown.map((line, index) => {
    const sku = line.sku.replace(/\s+/g, " ").trim();
    const productName = line.productName.replace(/\s+/g, " ").trim();
    return `${index + 1}. ${sku} — ${line.quantity} шт. · ${productName}`;
  });
  if (hidden > 0) details.push(`…ещё ${hidden} поз. — полный перечень в приложенном CSV.`);

  return [
    `Заказ поставщику ${supplier}`,
    `Расчёт NEXUS на ${asOfMonth}`,
    "",
    ...details,
    "",
    `Итого: ${selected.length} поз., ${totalUnits} шт.`,
    "Количество подтверждено менеджером. Просьба подтвердить наличие и срок поставки.",
  ].join("\n");
}

export function whatsappShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export function telegramShareUrl(message: string, sourceUrl = ""): string {
  const params = new URLSearchParams({ url: sourceUrl, text: message });
  return `https://t.me/share/url?${params.toString()}`;
}

export function supplierOrderCsv(lines: ConfirmedOrderLine[], asOfMonth: string): string {
  // Prefix formula-like spreadsheet text so uploaded names/SKUs cannot execute as a
  // formula when the CSV is opened in Excel. Numeric quantities remain numeric text as before.
  const cell = (value: string | number): string => {
    const raw = String(value);
    const safe = typeof value === "string" && /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const header = ["Поставщик", "SKU", "Наименование", "Рекомендация NEXUS", "Подтверждено менеджером", "Срочность", "Расчёт на"];
  const rows = lines.filter((line) => line.quantity > 0).map((line) => [
    line.supplier, line.sku, line.productName, line.recommendedOrder, line.quantity, line.urgency, asOfMonth,
  ]);
  return `﻿${[header, ...rows].map((row) => row.map(cell).join(";")).join("\r\n")}`;
}
