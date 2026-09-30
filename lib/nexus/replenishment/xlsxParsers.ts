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
  SkuStockBatch,
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

/**
 * Combines several column-name synonyms into one loose (unanchored) pattern, for findHeaderRow only —
 * that check must still match a compound header cell like "Номенклатура.Код" (normalizes to
 * "номенклатура код"), so it looks for any synonym as a substring, not an exact whole-cell match.
 * requireColumn's exact per-column patterns stay anchored; only header-row detection is loosened.
 */
function combine(patterns: RegExp[]): RegExp {
  return new RegExp(patterns.map((pattern) => pattern.source.replace(/^\^/, "").replace(/\$$/, "")).join("|"));
}

function findColumn(row: Cell[], patterns: RegExp[]): number {
  return row.findIndex((cell) => patterns.some((pattern) => pattern.test(key(cell))));
}

function requireColumn(row: Cell[], patterns: RegExp[], label: string): number {
  const index = findColumn(row, patterns);
  if (index < 0) throw new Error(`Required column was not found: ${label}`);
  return index;
}

/**
 * Optional metadata can legitimately be absent from a supplier workbook. Callers may ignore only
 * these two parser outcomes; corrupt workbooks and every other parsing failure must stay visible.
 */
export function isMissingColumnError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.startsWith("Required XLSX headers were not found.")
    || error.message.startsWith("Required column was not found:");
}

/**
 * Shared synonym lists for the handful of columns nearly every parser needs, so recognition is not
 * limited to IEK/Systeme Electric's own exact 1С wording. Broadens matching, not a substitute for
 * the manual column-mapping fallback a genuinely unfamiliar file still needs — no fixed list can
 * anticipate every company's naming, this just shrinks how often that fallback is required.
 */
const SKU_PATTERNS = [/^код$/, /^код 1с$/, /^код товара$/, /^код номенклатуры$/, /^номенклатура код$/, /^номенклатурный код$/, /^артикул$/, /^sku$/, /^item code$/, /^product code$/];
const PRODUCT_NAME_PATTERNS = [/^номенклатура$/, /^наименование$/, /^название$/, /^название товара$/, /^товар$/, /^product$/, /^product name$/, /^name$/, /^item$/];
const QUANTITY_PATTERNS = [/^количество$/, /^кол во$/, /^qty$/, /^quantity$/, /^amount$/];
const DATE_PATTERNS = [/^дата$/, /^дата документа$/, /^дата продажи$/, /^date$/];
const WAREHOUSE_PATTERNS = [/^склад$/, /^warehouse$/];
/** Percentage of shelf life remaining — an input value from the source file, never computed here. */
const SHELF_LIFE_REMAINING_PATTERNS = [/^осг$/, /^осг %$/, /^остаток срока годности$/, /^остаток срока годности %$/, /^shelf life$/, /^shelf life %$/];
/** Days/status column that marks a batch outright unusable when it does not parse as a number. */
const EXPIRY_STATUS_PATTERNS = [/^днейдоистечения$/, /^дней до истечения$/, /^годен$/, /^статус$/, /^days to expiry$/];

export function parseMonth(value: Cell, assumedYear?: number): YearMonth | null {
  const normalized = key(value);
  const bareMonth = normalized.match(/^(?:0?[1-9]|1[0-2])$/);
  if (bareMonth && assumedYear !== undefined && Number.isInteger(assumedYear)) {
    return `${assumedYear}-${String(Number(bareMonth[0])).padStart(2, "0")}` as YearMonth;
  }
  const yearMatch = normalized.match(/\b(20\d{2})\b/);
  if (!yearMatch) return null;
  const token = normalized.split(" ").find((part) => MONTHS[part] !== undefined);
  if (!token) return null;
  return `${+yearMatch[1]}-${String(MONTHS[token]).padStart(2, "0")}` as YearMonth;
}

export function parseSalesTransactions(input: XlsxInput, sheetName?: string): SalesTransaction[] {
  const rows = rowsFromWorkbook(input, sheetName);
  const headerIndex = findHeaderRow(rows, [combine(DATE_PATTERNS), combine(SKU_PATTERNS), combine(QUANTITY_PATTERNS)]);
  const header = rows[headerIndex];
  const date = requireColumn(header, DATE_PATTERNS, "Дата");
  const invoice = requireColumn(header, [/^номер$/, /^номер документа$/, /^invoice$/], "Номер");
  const document = findColumn(header, [/^документ$/]);
  const sku = requireColumn(header, SKU_PATTERNS, "Код");
  const product = requireColumn(header, PRODUCT_NAME_PATTERNS, "Номенклатура");
  const unit = findColumn(header, [/^ед$/, /^единица$/, /^ед изм$/, /^unit$/]);
  const warehouse = findColumn(header, [/^склад$/, /^warehouse$/]);
  const quantity = requireColumn(header, QUANTITY_PATTERNS, "Количество");

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

function parseMonthlyRows(rows: Rows, assumedYear?: number): MonthlyBase[] {
  const headerIndex = findHeaderRow(rows, [combine(PRODUCT_NAME_PATTERNS), combine(SKU_PATTERNS)]);
  const header = rows[headerIndex];
  const sku = requireColumn(header, [...SKU_PATTERNS, /номенклатурн.*код/], "SKU code");
  const product = requireColumn(header, PRODUCT_NAME_PATTERNS, "product name");
  const unit = findColumn(header, [/^ед$/, /^ед ед$/, /^единица$/, /^unit$/]);
  const rowMonth = findColumn(header, [/^месяц$/, /^month$/]);
  const rowQuantity = findColumn(header, QUANTITY_PATTERNS);

  // Some customer exports are in long form: one client/SKU/month per row rather than one month per
  // column. Aggregate them here because the calculation contract requires a single demand value per
  // SKU/month; treating client rows as consecutive months would distort seasonality and volatility.
  if (rowMonth >= 0 && rowQuantity >= 0) {
    const aggregated = new Map<string, MonthlyBase>();
    for (const row of rows.slice(headerIndex + 1)) {
      const month = parseMonth(row[rowMonth], assumedYear);
      const skuValue = text(row[sku]);
      if (!month || !skuValue) continue;
      const mapKey = `${skuValue}\u0000${month}`;
      const current = aggregated.get(mapKey);
      aggregated.set(mapKey, {
        sku: skuValue,
        productName: current?.productName || text(row[product]),
        ...(unit >= 0 && text(row[unit]) ? { unit: text(row[unit]) } : {}),
        month,
        value: (current?.value ?? 0) + (numberValue(row[rowQuantity]) ?? 0),
      });
    }
    if (!aggregated.size) throw new Error("No monthly columns were found.");
    return [...aggregated.values()];
  }

  const monthColumns = header.flatMap((cell, index) => {
    const month = parseMonth(cell, assumedYear);
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

function parseMonthly(input: XlsxInput, sheetName?: string, assumedYear?: number): MonthlyBase[] {
  const workbook = XLSX.read(input, { type: "array", cellDates: true });
  const candidates = sheetName ? [sheetName] : workbook.SheetNames;
  let candidateError: unknown;
  for (const candidate of candidates) {
    const worksheet = workbook.Sheets[candidate];
    if (!worksheet) {
      if (sheetName) throw new Error(`Worksheet not found: ${sheetName}`);
      continue;
    }
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: null }) as Rows;
    try {
      return parseMonthlyRows(rows, assumedYear);
    } catch (error) {
      if (sheetName) throw error;
      // A customer workbook may start with instructions or calculated output and keep raw monthly
      // data on a later sheet. Only structural mismatches are candidates for trying the next sheet.
      if (!isMissingColumnError(error) && !(error instanceof Error && error.message === "No monthly columns were found.")) throw error;
      candidateError = error;
    }
  }
  if (candidateError instanceof Error) throw candidateError;
  throw new Error("Required XLSX headers were not found.");
}

export function parseMonthlySales(input: XlsxInput, sheetName?: string, assumedYear?: number): MonthlySales[] {
  return parseMonthly(input, sheetName, assumedYear).map(({ value, ...row }) => ({ ...row, unitsSold: value }));
}

export function parseMonthlyOpeningStock(input: XlsxInput, sheetName?: string, assumedYear?: number): MonthlyOpeningStock[] {
  return parseMonthly(input, sheetName, assumedYear).map(({ value, ...row }) => ({ ...row, openingStock: value }));
}

/**
 * Parses a grouped 1C "gross profit" report as one month of SKU demand. Unlike the ordinary tabular
 * parsers this must retain worksheet outline and merge metadata, hence the direct SheetJS access and
 * `cellStyles: true` below.
 */
export function parseGroupedMonthlyReport(input: XlsxInput, sheetName?: string): MonthlySales[] {
  const workbook = XLSX.read(input, { type: "array", cellDates: true, cellStyles: true });
  const selected = sheetName ?? workbook.SheetNames[0];
  const worksheet = selected ? workbook.Sheets[selected] : undefined;
  if (!selected || !worksheet) throw new Error(`Worksheet not found: ${selected ?? "<first>"}`);

  const range = XLSX.utils.decode_range(worksheet["!ref"] ?? "A1:A1");
  const cellAt = (row: number, column: number): Cell => worksheet[XLSX.utils.encode_cell({ r: row, c: column })]?.v as Cell;
  const periodPattern = /период:?\s*(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(\d{2})\.(\d{2})\.(\d{4})/iu;
  let periodMatch: RegExpMatchArray | null = null;
  for (let row = range.s.r; row <= Math.min(range.e.r, 14) && !periodMatch; row += 1) {
    for (let column = range.s.c; column <= range.e.c && !periodMatch; column += 1) {
      periodMatch = text(cellAt(row, column)).match(periodPattern);
    }
  }
  if (!periodMatch) throw new Error("Не удалось найти период отчёта в первых 15 строках.");
  const [, , startMonth, startYear, , endMonth, endYear] = periodMatch;
  if (startMonth !== endMonth || startYear !== endYear) {
    throw new Error("Отчёт охватывает больше одного месяца, такой файл пока не поддерживается для этого источника.");
  }
  const monthNumber = Number(startMonth);
  if (monthNumber < 1 || monthNumber > 12) throw new Error("В периоде отчёта указан некорректный месяц.");
  const month = `${startYear}-${startMonth}` as YearMonth;

  // `!merges` is not guaranteed to be in document order — some reports repeat a "Количество" header
  // further down for a second sub-table (e.g. a by-product summary after the by-client breakdown).
  // Take the topmost (then leftmost) match, which is the real header for this report's main grouping.
  const quantityMerge = (worksheet["!merges"] ?? [])
    .filter((merge) => QUANTITY_PATTERNS.some((pattern) => pattern.test(key(cellAt(merge.s.r, merge.s.c)))))
    .sort((a, b) => a.s.r - b.s.r || a.s.c - b.s.c)[0];
  if (!quantityMerge) throw new Error("Не удалось найти объединённый заголовок колонки «Количество».");

  const rowMetadata = worksheet["!rows"];
  const dataStart = quantityMerge.e.r + 1;
  let leafLevel: number | undefined;
  for (let row = dataStart; row <= range.e.r; row += 1) {
    const level = rowMetadata?.[row]?.level;
    if (typeof level === "number" && (leafLevel === undefined || level > leafLevel)) leafLevel = level;
  }
  if (leafLevel === undefined) throw new Error("Не удалось определить уровни группировки строк отчёта.");

  const aggregated = new Map<string, MonthlySales>();
  for (let row = dataStart; row <= range.e.r; row += 1) {
    if (rowMetadata?.[row]?.level !== leafLevel) continue;
    let label = "";
    for (let column = range.s.c; column <= range.e.c && !label; column += 1) label = text(cellAt(row, column));
    const separator = label.lastIndexOf(",");
    if (separator < 0) continue;
    const productName = label.slice(0, separator).trim();
    const sku = label.slice(separator + 1).trim();
    const unitsSold = numberValue(cellAt(row, quantityMerge.s.c));
    if (!productName || !sku || unitsSold === null) continue;
    const current = aggregated.get(sku);
    aggregated.set(sku, {
      sku,
      productName: current?.productName || productName,
      month,
      unitsSold: (current?.unitsSold ?? 0) + unitsSold,
    });
  }
  return [...aggregated.values()];
}

function expectedDateFromHeader(header: Cell): string | null {
  const match = text(header).match(/поступлени[ея]\s+до\s+(\d{1,2})\.(\d{1,2})\.(\d{4})/iu);
  if (!match) return null;
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

export function parseInboundShipments(input: XlsxInput, sheetName?: string): InboundShipment[] {
  const rows = rowsFromWorkbook(input, sheetName);
  const headerIndex = findHeaderRow(rows, [combine(SKU_PATTERNS), combine(PRODUCT_NAME_PATTERNS)]);
  const header = rows[headerIndex];
  const sku = requireColumn(header, SKU_PATTERNS, "Код 1с");
  const product = requireColumn(header, PRODUCT_NAME_PATTERNS, "Наименование");
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
  const headerIndex = findHeaderRow(rows, [combine(SKU_PATTERNS), /кратность|мин разр к отгр|moq/]);
  const header = rows[headerIndex];
  const sku = requireColumn(header, [...SKU_PATTERNS, /номенклатурн.*код/], "SKU code");
  const product = requireColumn(header, PRODUCT_NAME_PATTERNS, "product name");
  const supplierArticle = findColumn(header, [/^артикул(?: поставщика)?$/]);
  const multiple = requireColumn(header, [/^кратность$/, /^мин разр к отгр$/, /^moq$/, /^кратность заказа$/], "MOQ/order multiple");

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

/**
 * Reads batch-level stock — one row per lot, optionally per warehouse and shelf-life status. Warehouse
 * and shelf-life columns are both optional (findColumn, not requireColumn): a file with neither is still
 * a useful flat stock source, just without the per-warehouse breakdown or expiry-based exclusion.
 *
 * Validity mirrors the source convention this was modelled on: an unparseable expiry-status cell (any
 * non-numeric "days remaining" value, e.g. a literal "expired" marker in whatever wording the company
 * uses) marks the batch unusable outright; otherwise a present shelf-life percentage below the caller's
 * threshold (applied later, in assemble.ts) excludes it; a batch with no shelf-life data at all is valid.
 */
export function parseSkuStockBatches(input: XlsxInput, sheetName?: string): SkuStockBatch[] {
  const rows = rowsFromWorkbook(input, sheetName);
  const headerIndex = findHeaderRow(rows, [combine(SKU_PATTERNS), combine(QUANTITY_PATTERNS)]);
  const header = rows[headerIndex];
  const sku = requireColumn(header, SKU_PATTERNS, "SKU code");
  const quantity = requireColumn(header, QUANTITY_PATTERNS, "Количество");
  const warehouse = findColumn(header, WAREHOUSE_PATTERNS);
  const shelfLifePercent = findColumn(header, SHELF_LIFE_REMAINING_PATTERNS);
  const expiryStatus = findColumn(header, EXPIRY_STATUS_PATTERNS);

  return rows.slice(headerIndex + 1).flatMap((row) => {
    const skuValue = text(row[sku]);
    const quantityValue = numberValue(row[quantity]);
    if (!skuValue || quantityValue === null || quantityValue <= 0) return [];
    const expired = expiryStatus >= 0 && numberValue(row[expiryStatus]) === null && text(row[expiryStatus]) !== "";
    const percentValue = shelfLifePercent >= 0 ? numberValue(row[shelfLifePercent]) : null;
    return [{
      sku: skuValue,
      ...(warehouse >= 0 && text(row[warehouse]) ? { warehouse: text(row[warehouse]) } : {}),
      quantity: quantityValue,
      ...(percentValue !== null ? { shelfLifeRemainingPercent: percentValue } : {}),
      ...(expired ? { expired: true } : {}),
    }];
  });
}
