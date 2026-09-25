import * as XLSX from "xlsx";
import type {
  InboundShipment,
  MinimumOrderQuantity,
  MonthlyOpeningStock,
  MonthlySales,
  SalesTransaction,
  SkuCategory,
  SkuCostPrice,
  SkuCurrentStock,
  SkuReservation,
  XlsxInput,
  YearMonth,
} from "./types.ts";

type Cell = string | number | boolean | Date | null | undefined;
type Rows = Cell[][];

const MONTHS: Record<string, number> = {
  янв: 1, январь: 1, января: 1,
  фев: 2, февр: 2, февраль: 2, февраля: 2,
  мар: 3, март: 3, марта: 3,
  апр: 4, апрель: 4, апреля: 4,
  май: 5, мая: 5,
  июн: 6, июнь: 6, июня: 6,
  июл: 7, июль: 7, июля: 7,
  авг: 8, август: 8, августа: 8,
  сен: 9, сент: 9, сентябрь: 9, сентября: 9,
  окт: 10, октябрь: 10, октября: 10,
  ноя: 11, ноябрь: 11, ноября: 11,
  дек: 12, декабрь: 12, декабря: 12,
};

function text(value: Cell): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function key(value: Cell): string {
  return text(value)
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/\u00a0/g, " ")
    .replace(/[^a-zа-я0-9]+/giu, " ")
    .trim();
}

function numberValue(value: Cell): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(value: Cell): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.floor(parsed.S))).toISOString();
  }
  const raw = text(value);
  const match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    const [, day, month, year, hour = "0", minute = "0", second = "0"] = match;
    return new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second)).toISOString();
  }
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function rowsFromWorkbook(input: XlsxInput, sheetName?: string): Rows {
  const workbook = XLSX.read(input, { type: "array", cellDates: true });
  const selected = sheetName ?? workbook.SheetNames[0];
  if (!selected || !workbook.Sheets[selected]) throw new Error(`Worksheet not found: ${selected ?? "<first>"}`);
  return XLSX.utils.sheet_to_json(workbook.Sheets[selected], { header: 1, raw: true, defval: null }) as Rows;
}

function findHeaderRow(rows: Rows, required: RegExp[], limit = 20): number {
  const index = rows.slice(0, limit).findIndex((row) => required.every((pattern) => row.some((cell) => pattern.test(key(cell)))));
  if (index < 0) throw new Error("Required XLSX headers were not found.");
  return index;
}

function findColumn(row: Cell[], patterns: RegExp[]): number {
  return row.findIndex((cell) => patterns.some((pattern) => pattern.test(key(cell))));
}

function requireColumn(row: Cell[], patterns: RegExp[], label: string): number {
  const index = findColumn(row, patterns);
  if (index < 0) throw new Error(`Required column was not found: ${label}`);
  return index;
}

function parseMonth(value: Cell): YearMonth | null {
  const normalized = key(value);
  const yearMatch = normalized.match(/\b(20\d{2})\b/);
  if (!yearMatch) return null;
  const token = normalized.split(" ").find((part) => MONTHS[part] !== undefined);
  if (!token) return null;
  return `${+yearMatch[1]}-${String(MONTHS[token]).padStart(2, "0")}` as YearMonth;
}

export function parseSalesTransactions(input: XlsxInput, sheetName?: string): SalesTransaction[] {
  const rows = rowsFromWorkbook(input, sheetName);
  const headerIndex = findHeaderRow(rows, [/^дата$/, /^код$/, /^количество$/]);
  const header = rows[headerIndex];
  const date = requireColumn(header, [/^дата$/], "Дата");
  const invoice = requireColumn(header, [/^номер$/], "Номер");
  const document = findColumn(header, [/^документ$/]);
  const sku = requireColumn(header, [/^код$/, /^код 1с$/], "Код");
  const product = requireColumn(header, [/^номенклатура$/, /^наименование$/], "Номенклатура");
  const unit = findColumn(header, [/^ед$/, /^единица$/]);
  const warehouse = findColumn(header, [/^склад$/]);
  const quantity = requireColumn(header, [/^количество$/], "Количество");

  return rows.slice(headerIndex + 1).flatMap((row) => {
    const occurredAt = isoDate(row[date]);
    const sourceQuantity = numberValue(row[quantity]);
    const skuValue = text(row[sku]);
    const documentValue = document >= 0 ? text(row[document]) : "";
    // The real journals contain a handful of receipts and customer-order documents among shipment rows.
    // They are inventory movements or pre-shipment intentions, not completed sales demand.
    const nonSaleDocument = /приходная накладная|заказ покупателя/iu.test(documentValue);
    if (!occurredAt || sourceQuantity === null || sourceQuantity === 0 || !skuValue || nonSaleDocument) return [];
    return [{
      occurredAt,
      invoiceNumber: text(row[invoice]),
      ...(documentValue ? { document: documentValue } : {}),
      sku: skuValue,
      productName: text(row[product]),
      ...(unit >= 0 && text(row[unit]) ? { unit: text(row[unit]) } : {}),
      ...(warehouse >= 0 && text(row[warehouse]) ? { warehouse: text(row[warehouse]) } : {}),
      // Sales are negative in the older extracts and positive in newer ones; document semantics, rather
      // than sign alone, identify a sale. Preserve the signed source value for audit.
      unitsSold: Math.abs(sourceQuantity),
      sourceQuantity,
    }];
  });
}

interface MonthlyBase {
  sku: string;
  productName: string;
  unit?: string;
  month: YearMonth;
  value: number;
}

function parseMonthly(input: XlsxInput, sheetName?: string): MonthlyBase[] {
  const rows = rowsFromWorkbook(input, sheetName);
  const headerIndex = findHeaderRow(rows, [/номенклатур|наименование/, /код/]);
  const header = rows[headerIndex];
  const sku = requireColumn(header, [/^код$/, /^номенклатура код$/, /номенклатурн.*код/, /^код 1с$/], "SKU code");
  const product = requireColumn(header, [/^номенклатура$/, /^наименование$/], "product name");
  const unit = findColumn(header, [/^ед$/, /^ед ед$/, /^единица$/]);
  const monthColumns = header.flatMap((cell, index) => {
    const month = parseMonth(cell);
    return month ? [{ index, month }] : [];
  });
  if (!monthColumns.length) throw new Error("No monthly columns were found.");

  // Data begins after all contiguous qualifier rows (for example "Количество" / "нач. остаток").
  let dataStart = headerIndex + 1;
  while (dataStart < rows.length && !text(rows[dataStart]?.[sku])) dataStart += 1;

  return rows.slice(dataStart).flatMap((row) => {
    const skuValue = text(row[sku]);
    if (!skuValue) return [];
    const identity = {
      sku: skuValue,
      productName: text(row[product]),
      ...(unit >= 0 && text(row[unit]) ? { unit: text(row[unit]) } : {}),
    };
    return monthColumns.map(({ index, month }) => ({
      ...identity,
      month,
      // A present month column with an empty/NaN cell is a known zero. An absent month has no column/record.
      value: numberValue(row[index]) ?? 0,
    }));
  });
}

export function parseMonthlySales(input: XlsxInput, sheetName?: string): MonthlySales[] {
  return parseMonthly(input, sheetName).map(({ value, ...row }) => ({ ...row, unitsSold: value }));
}

export function parseMonthlyOpeningStock(input: XlsxInput, sheetName?: string): MonthlyOpeningStock[] {
  return parseMonthly(input, sheetName).map(({ value, ...row }) => ({ ...row, openingStock: value }));
}

function expectedDateFromHeader(header: Cell): string | null {
  const match = text(header).match(/поступлени[ея]\s+до\s+(\d{1,2})\.(\d{1,2})\.(\d{4})/iu);
  if (!match) return null;
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

export function parseInboundShipments(input: XlsxInput, sheetName?: string): InboundShipment[] {
  const rows = rowsFromWorkbook(input, sheetName);
  const headerIndex = findHeaderRow(rows, [/код 1с/, /наименование/]);
  const header = rows[headerIndex];
  const sku = requireColumn(header, [/^код 1с$/], "Код 1с");
  const product = requireColumn(header, [/^наименование$/], "Наименование");
  const supplierArticle = findColumn(header, [/^артикул(?: поставщика| иэк)?$/]);
  const shipmentColumns = header.flatMap((cell, index) => {
    const label = text(cell);
    const normalized = key(cell);
    const isDetailedSupply = /поступлени[ея]\s+до/iu.test(label);
    const isAggregateInTransit = normalized.split(" ").some((token, tokenIndex, tokens) => token === "в" && tokens[tokenIndex + 1] === "пути");
    return isDetailedSupply || isAggregateInTransit
      ? [{ index, shipmentId: label, expectedDate: expectedDateFromHeader(cell) }]
      : [];
  });
  if (!shipmentColumns.length) throw new Error("No inbound-shipment columns were found.");

  return rows.slice(headerIndex + 1).flatMap((row) => {
    const skuValue = text(row[sku]);
    if (!skuValue) return [];
    return shipmentColumns.flatMap(({ index, shipmentId, expectedDate }) => {
      const quantity = numberValue(row[index]);
      if (quantity === null || quantity === 0) return [];
      return [{
        sku: skuValue,
        ...(supplierArticle >= 0 && text(row[supplierArticle]) ? { supplierArticle: text(row[supplierArticle]) } : {}),
        productName: text(row[product]),
        shipmentId,
        expectedDate,
        quantity,
      }];
    });
  });
}

export function parseMinimumOrderQuantities(input: XlsxInput, sheetName?: string): MinimumOrderQuantity[] {
  const rows = rowsFromWorkbook(input, sheetName);
  const headerIndex = findHeaderRow(rows, [/код/, /кратность|мин разр к отгр/]);
  const header = rows[headerIndex];
  const sku = requireColumn(header, [/^код 1с$/, /^номенклатура код$/, /номенклатурн.*код/], "SKU code");
  const product = requireColumn(header, [/^номенклатура$/, /^наименование$/], "product name");
  const supplierArticle = findColumn(header, [/^артикул(?: поставщика)?$/]);
  const multiple = requireColumn(header, [/^кратность$/, /^мин разр к отгр$/], "MOQ/order multiple");

  return rows.slice(headerIndex + 1).flatMap((row) => {
    const skuValue = text(row[sku]);
    const multipleValue = numberValue(row[multiple]);
    if (!skuValue || multipleValue === null || multipleValue <= 0) return [];
    return [{
      sku: skuValue,
      ...(supplierArticle >= 0 && text(row[supplierArticle]) ? { supplierArticle: text(row[supplierArticle]) } : {}),
      productName: text(row[product]),
      multiple: multipleValue,
    }];
  });
}

/** Reads partner-provided category metadata when it exists (currently the Systeme Electric dashboard). */
export function parseSkuCategories(input: XlsxInput, sheetName?: string): SkuCategory[] {
  const rows = rowsFromWorkbook(input, sheetName);
  const headerIndex = findHeaderRow(rows, [/код 1с/, /категория/]);
  const header = rows[headerIndex];
  const sku = requireColumn(header, [/^код 1с$/], "Код 1с");
  const category = requireColumn(header, [/^категория(?: 20\d{2})?$/], "Категория");
  return rows.slice(headerIndex + 1).flatMap((row) => {
    const skuValue = text(row[sku]), categoryValue = text(row[category]);
    return skuValue && categoryValue ? [{ sku: skuValue, category: categoryValue }] : [];
  });
}

/** Reads customer-reserved stock from the Systeme Electric dashboard. IEK has no equivalent source. */
export function parseSkuReservations(input: XlsxInput, sheetName?: string): SkuReservation[] {
  const rows = rowsFromWorkbook(input, sheetName);
  const headerIndex = findHeaderRow(rows, [/код 1с/, /^зарезервировано$/]);
  const header = rows[headerIndex];
  const sku = requireColumn(header, [/^код 1с$/], "Код 1с");
  const reserved = requireColumn(header, [/^зарезервировано$/], "Зарезервировано");
  return rows.slice(headerIndex + 1).flatMap((row) => {
    const skuValue = text(row[sku]);
    const reservedValue = numberValue(row[reserved]);
    return skuValue && reservedValue !== null ? [{ sku: skuValue, reservedStock: Math.max(0, reservedValue) }] : [];
  });
}

/** Reads the current physical-stock snapshot when the supplier dashboard exposes one. */
export function parseSkuCurrentStocks(input: XlsxInput, sheetName?: string): SkuCurrentStock[] {
  const rows = rowsFromWorkbook(input, sheetName);
  const headerIndex = findHeaderRow(rows, [/код 1с/, /^остаток$/]);
  const header = rows[headerIndex];
  const sku = requireColumn(header, [/^код 1с$/], "Код 1с");
  // Exact matching intentionally avoids the neighbouring "Остаток ТЗ" and "Свободный остаток" fields.
  const stock = requireColumn(header, [/^остаток$/], "Остаток");
  return rows.slice(headerIndex + 1).flatMap((row) => {
    const skuValue = text(row[sku]);
    const stockValue = numberValue(row[stock]);
    return skuValue && stockValue !== null ? [{ sku: skuValue, currentStock: Math.max(0, stockValue) }] : [];
  });
}

/**
 * Reads per-unit cost price ("СС реал") when the supplier dashboard exposes one — currently only
 * Systeme Electric's export. IEK has no price column anywhere in its files; calling this against
 * an IEK workbook throws (no "сс реал" header to find), so callers only invoke it per-supplier.
 * Presentation-only: never fed into assembleReplenishmentInput/calculateReplenishment.
 */
export function parseSkuCostPrices(input: XlsxInput, sheetName?: string): SkuCostPrice[] {
  const rows = rowsFromWorkbook(input, sheetName);
  const headerIndex = findHeaderRow(rows, [/код 1с/, /сс реал/]);
  const header = rows[headerIndex];
  const sku = requireColumn(header, [/^код 1с$/], "Код 1с");
  const price = requireColumn(header, [/сс реал/], "СС реал");
  return rows.slice(headerIndex + 1).flatMap((row) => {
    const skuValue = text(row[sku]);
    const priceValue = numberValue(row[price]);
    return skuValue && priceValue !== null && priceValue > 0 ? [{ sku: skuValue, costPrice: priceValue }] : [];
  });
}
