import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  isMissingColumnError,
  parseGroupedMonthlyReport,
  parseGroupedMonthlyReportRows,
  parseInboundShipments,
  parseMonth,
  parseMonthlyOpeningStock,
  parseMonthlySales,
  parseMinimumOrderQuantities,
  parseSalesTransactions,
  parseSkuCostPrices,
  parseSkuCurrentStocks,
  parseSkuReservations,
  parseSkuStockBatches,
} from "./xlsxParsers.ts";

function workbookBytes(rows: unknown[][], sheetName = "Лист_1"): Uint8Array {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function groupedReportBytes(period = "Период: 01.09.2026 - 30.09.2026"): Uint8Array {
  const rows: unknown[][] = [
    [null, null, null, period],
    [],
    ["Подразделение", null, null, null, null, null, null, "Выручка", null, null, "Валовая прибыль", null, "Количество"],
    ["Клиент.Адрес"],
    ["Клиент"],
    ["Номенклатура, Артикул"],
    ["Клиент Альфа", null, null, null, null, null, null, null, null, null, null, null, 100],
    ["Ирис, карамельный DUMLE, SKU-1", null, null, null, null, null, null, null, null, null, null, null, 10],
    ["Шоколад, SKU-2", null, null, null, null, null, null, null, null, null, null, null, -2],
    ["Клиент Бета", null, null, null, null, null, null, null, null, null, null, null, 50],
    ["Ирис, карамельный DUMLE, SKU-1", null, null, null, null, null, null, null, null, null, null, null, 5],
    ["Вафли, SKU-3", null, null, null, null, null, null, null, null, null, null, null, 7],
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!rows"] = rows.map((_, index) => (
    index === 6 || index === 9 ? { level: 2 } : index >= 7 ? { level: 3 } : {}
  ));
  worksheet["!merges"] = [
    { s: { r: 2, c: 12 }, e: { r: 5, c: 13 } },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Отчёт");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", cellStyles: true });
}

function uncodedGroupedReportBytes(): Uint8Array {
  const rows: unknown[][] = [
    ["Продажи"],
    [],
    ["Покупатель", null, null, "март 2026", null, null, "Итого"],
    ["Номенклатура", null, null, "Выручка,", "Количество", "Себестоимость,", "Выручка,", "Количество", "Себестоимость,"],
    ["Клиент Альфа", null, null, 1_000, 4, 800, 1_000, 4, 800],
    ["Товар А, 150 г", null, null, 1_000, 4, 800, 1_000, 4, 800],
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!rows"] = rows.map((_, index) => index === 5 ? { level: 1 } : {});
  worksheet["!merges"] = [
    { s: { r: 2, c: 0 }, e: { r: 2, c: 2 } },
    { s: { r: 2, c: 3 }, e: { r: 2, c: 5 } },
    { s: { r: 2, c: 6 }, e: { r: 2, c: 8 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: 2 } },
    { s: { r: 4, c: 0 }, e: { r: 4, c: 2 } },
    { s: { r: 5, c: 0 }, e: { r: 5, c: 2 } },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Отчёт");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", cellStyles: true });
}

test("missing-column classifier recognizes only the two intentional parser signals", () => {
  assert.equal(isMissingColumnError(new Error("Required XLSX headers were not found.")), true);
  assert.equal(isMissingColumnError(new Error("Required column was not found: Остаток")), true);
  assert.equal(isMissingColumnError(new Error("No monthly columns were found.")), false);
  assert.equal(isMissingColumnError(new Error("Worksheet not found: Лист_2")), false);
  assert.equal(isMissingColumnError("Required XLSX headers were not found."), false);
});

test("transaction parser normalizes both historical sign conventions and excludes non-sale documents", () => {
  const bytes = workbookBytes([
    ["Дата", "Номер", "Документ", "Код", "Номенклатура", "Ед.", "Склад", "Количество"],
    ["05.09.2026 14:30:00", "INV-1", "Продажа INV-1", "SKU-1", "Автомат", "шт", "Основной", -12],
    [new Date("2026-09-06T10:00:00Z"), "INV-2", "Продажа INV-2", "SKU-2", "Кабель", "м", "Основной", -3],
    [new Date("2026-09-07T10:00:00Z"), "INV-3", "Расходная накладная INV-3", "SKU-3", "Реле", "шт", "Основной", 4],
    [new Date("2026-09-08T10:00:00Z"), "INV-4", "Приходная накладная INV-4", "SKU-4", "Возврат", "шт", "Основной", 8],
  ]);

  const parsed = parseSalesTransactions(bytes);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].unitsSold, 12);
  assert.equal(parsed[0].sourceQuantity, -12);
  assert.equal(parsed[0].sku, "SKU-1");
  assert.match(parsed[0].occurredAt, /^2026-09-05T14:30:00/);
  assert.equal(parsed[2].unitsSold, 4);
  assert.equal(parsed[2].sourceQuantity, 4);
});

test("monthly sales parser understands two-level headers and normalizes blank/NaN cells to zero", () => {
  const bytes = workbookBytes([
    ["Номенклатура", "Ед.", "Номенклатурн.код", "янв. 2026", "фев. 2026", "Итого"],
    [null, null, null, "Количество", "Количество", "Количество"],
    ["Автомат", "шт", "SKU-1", 10, null, 10],
    ["Кабель", "м", "SKU-2", Number.NaN, 7, 7],
  ]);

  const parsed = parseMonthlySales(bytes);
  assert.deepEqual(parsed.filter((row) => row.sku === "SKU-1").map((row) => [row.month, row.unitsSold]), [["2026-01", 10], ["2026-02", 0]]);
  assert.deepEqual(parsed.filter((row) => row.sku === "SKU-2").map((row) => [row.month, row.unitsSold]), [["2026-01", 0], ["2026-02", 7]]);
});

test("grouped 1C report parser uses outline levels, keeps returns signed and sums a SKU across clients", () => {
  assert.deepEqual(parseGroupedMonthlyReport(groupedReportBytes()), [
    { sku: "SKU-1", productName: "Ирис, карамельный DUMLE", month: "2026-09", unitsSold: 15 },
    { sku: "SKU-2", productName: "Шоколад", month: "2026-09", unitsSold: -2 },
    { sku: "SKU-3", productName: "Вафли", month: "2026-09", unitsSold: 7 },
  ]);
});

test("grouped 1C report rejects a period spanning more than one calendar month", () => {
  assert.throws(
    () => parseGroupedMonthlyReport(groupedReportBytes("Период: 25.09.2026 - 02.10.2026")),
    /отчёт охватывает больше одного месяца/iu,
  );
});

test("grouped no-SKU report reads 'month year' header and keeps the full product name as an unmatched row", () => {
  const bytes = uncodedGroupedReportBytes();
  assert.deepEqual(parseGroupedMonthlyReportRows(bytes), [
    { sku: null, productName: "Товар А, 150 г", month: "2026-03", unitsSold: 4 },
  ]);
  // Backwards-compatible wrapper cannot safely invent an SKU and therefore still emits no row.
  assert.deepEqual(parseGroupedMonthlyReport(bytes), []);
});

test("grouped 1C report finds the real header even when a second 'Количество' block sits lower in the sheet and earlier in !merges", () => {
  // Regression test: a real partner export repeated "Количество" for a second, unrelated by-product
  // summary further down the sheet. !merges is not guaranteed to be in document order, so the decoy
  // (listed first in !merges, but on a later row) must not be picked over the real header above the data.
  const rows: unknown[][] = [
    [null, null, null, "Период: 01.09.2026 - 30.09.2026"],
    [],
    ["Подразделение", null, null, null, null, null, null, "Выручка", null, null, "Валовая прибыль", null, "Количество"],
    ["Клиент.Адрес"],
    ["Клиент"],
    ["Номенклатура, Артикул"],
    ["Клиент Альфа", null, null, null, null, null, null, null, null, null, null, null, 100],
    ["Ирис, карамельный DUMLE, SKU-1", null, null, null, null, null, null, null, null, null, null, null, 10],
    [],
    ["По товарам (итого)"],
    ["Номенклатура", null, null, null, null, null, null, null, null, null, null, null, null, null, "Количество"],
    ["Ирис, карамельный DUMLE", null, null, null, null, null, null, null, null, null, null, null, null, null, 999],
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!rows"] = rows.map((_, index) => (index === 6 ? { level: 2 } : index === 7 ? { level: 3 } : {}));
  worksheet["!merges"] = [
    // Decoy header listed first in the array, even though it sits on a later row.
    { s: { r: 9, c: 14 }, e: { r: 9, c: 14 } },
    { s: { r: 2, c: 12 }, e: { r: 5, c: 13 } },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Отчёт");
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", cellStyles: true });

  assert.deepEqual(parseGroupedMonthlyReport(bytes), [
    { sku: "SKU-1", productName: "Ирис, карамельный DUMLE", month: "2026-09", unitsSold: 10 },
  ]);
});

test("bare month needs an explicit assumed year", () => {
  assert.equal(parseMonth("07"), null);
  assert.equal(parseMonth("07", 2026), "2026-07");
});

test("long-form monthly sales with bare months aggregate client rows by SKU and month", () => {
  const bytes = workbookBytes([
    ["Месяц", "Клиент", "Артикул", "Номенклатура", "Кол-во"],
    ["07", "Клиент Альфа", "SKU-1", "Товар один", 10],
    ["07", "Клиент Бета", "SKU-1", "Товар один", -2],
    ["08", "Клиент Альфа", "SKU-2", "Товар два", 5],
  ]);
  assert.deepEqual(parseMonthlySales(bytes, undefined, 2026), [
    { sku: "SKU-1", productName: "Товар один", month: "2026-07", unitsSold: 8 },
    { sku: "SKU-2", productName: "Товар два", month: "2026-08", unitsSold: 5 },
  ]);
});

test("monthly parser finds long-form data on a later workbook sheet", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Инструкция"], ["Заполните параметры"]]), "Инструкция");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Месяц", "Клиент", "Артикул", "Номенклатура", "Кол-во"],
    ["07", "Клиент Альфа", "SKU-1", "Товар один", 10],
  ]), "Данные_Продажи");
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  assert.deepEqual(parseMonthlySales(bytes, undefined, 2026), [
    { sku: "SKU-1", productName: "Товар один", month: "2026-07", unitsSold: 10 },
  ]);
});

test("wide monthly files also accept a bare month header only when a year is supplied", () => {
  const bytes = workbookBytes([
    ["Номенклатура", "Артикул", "07"],
    ["Товар один", "SKU-1", 12],
  ]);
  assert.throws(() => parseMonthlySales(bytes), /No monthly columns were found/u);
  assert.deepEqual(parseMonthlySales(bytes, undefined, 2026), [
    { sku: "SKU-1", productName: "Товар один", month: "2026-07", unitsSold: 12 },
  ]);
});

test("opening-stock parser skips qualifier rows and emits one record per available month column", () => {
  const bytes = workbookBytes([
    ["Номенклатура", "Ед.", "Номенклатурн.код", "авг. 2026", "сент. 2026"],
    [null, null, null, "Количество", "Количество"],
    [null, null, null, "нач. остаток", "нач. остаток"],
    ["Автомат", "шт", "SKU-1", 21, null],
    ["Кабель", "м", "SKU-2", 100, 80],
  ]);

  assert.deepEqual(parseMonthlyOpeningStock(bytes).filter((row) => row.sku === "SKU-1"), [
    { sku: "SKU-1", productName: "Автомат", unit: "шт", month: "2026-08", openingStock: 21 },
    { sku: "SKU-1", productName: "Автомат", unit: "шт", month: "2026-09", openingStock: 0 },
  ]);
});

test("IEK inbound parser expands dated shipment columns", () => {
  const bytes = workbookBytes([
    ["Код 1с", "Артикул ИЭК", "Наименование", "УТ-8231 (поступление до 30.09.2026)", "УТ-8234 (поступление до 15.10.2026)"],
    ["SKU-1", "ART-1", "Автомат", 20, 30],
    ["SKU-2", "ART-2", "Кабель", null, 5],
  ]);

  const parsed = parseInboundShipments(bytes);
  assert.equal(parsed.length, 3);
  assert.deepEqual(parsed[0], {
    sku: "SKU-1", supplierArticle: "ART-1", productName: "Автомат",
    shipmentId: "УТ-8231 (поступление до 30.09.2026)", expectedDate: "2026-09-30", quantity: 20,
  });
});

test("Systeme Electric inbound parser selects only the aggregate in-transit column from a dashboard", () => {
  const bytes = workbookBytes([
    [null, null, null, null, "СКЛАДЫ"],
    ["№", "Артикул поставщика", "Код 1с", "Наименование", "Кэф. Роста", "Кэф. Сез-ти", "Остаток", "СЭ в пути 24.09"],
    [1, "ART-1", "SKU-1", "Автомат", 1.4, 0.8, 11, 40],
    [2, "ART-2", "SKU-2", "Кабель", 9.9, 9.9, 20, 0],
  ]);

  assert.deepEqual(parseInboundShipments(bytes), [{
    sku: "SKU-1", supplierArticle: "ART-1", productName: "Автомат",
    shipmentId: "СЭ в пути 24.09", expectedDate: null, quantity: 40,
  }]);
});

test("MOQ parser normalizes both partner header variants", () => {
  const iek = workbookBytes([
    ["№", "Код 1с", "Артикул поставщика", "Наименование", "Мин. разр. к отгр."],
    [1, "SKU-1", "ART-1", "Автомат", 12],
  ]);
  const systeme = workbookBytes([
    ["№", "Номенклатура", "Номенклатура.Код", "Артикул", "Кратность"],
    [null, null, null, null, null],
    [1, "Кабель", "SKU-2", "ART-2", 5],
  ]);
  assert.deepEqual(parseMinimumOrderQuantities(iek), [{ sku: "SKU-1", supplierArticle: "ART-1", productName: "Автомат", multiple: 12 }]);
  assert.deepEqual(parseMinimumOrderQuantities(systeme), [{ sku: "SKU-2", supplierArticle: "ART-2", productName: "Кабель", multiple: 5 }]);
});

test("reservation parser reads reserved customer stock and clamps negative values to zero", () => {
  const bytes = workbookBytes([
    [null, null, null, null],
    ["№", "Код 1с", "Наименование", "Остаток", "Зарезервировано", "Свободный остаток"],
    [1, "SKU-1", "Автомат", 20, 7, 13],
    [2, "SKU-2", "Кабель", 10, -2, 12],
  ]);
  assert.deepEqual(parseSkuReservations(bytes), [
    { sku: "SKU-1", reservedStock: 7 },
    { sku: "SKU-2", reservedStock: 0 },
  ]);
});

test("current-stock parser selects the exact dashboard stock column", () => {
  const bytes = workbookBytes([
    [null, null, null, null],
    ["№", "Код 1с", "Наименование", "Остаток ТЗ", "Остаток", "Зарезервировано", "Свободный остаток"],
    [1, "SKU-1", "Автомат", 99, 20, 7, 13],
    [2, "SKU-2", "Кабель", 88, -4, 0, 0],
  ]);
  assert.deepEqual(parseSkuCurrentStocks(bytes), [
    { sku: "SKU-1", currentStock: 20 },
    { sku: "SKU-2", currentStock: 0 },
  ]);
});

test("cost-price parser reads the dashboard's real-cost column and drops zero/missing prices", () => {
  const bytes = workbookBytes([
    [null, null, null, null],
    ["№", "Код 1с", "Наименование", "СС реал", "Остаток"],
    [1, "SKU-1", "Автомат", 1050.61, 20],
    [2, "SKU-2", "Кабель без продаж", 0, 0],
    [3, "SKU-3", "Реле", "899,75", 4],
  ]);
  assert.deepEqual(parseSkuCostPrices(bytes), [
    { sku: "SKU-1", costPrice: 1050.61 },
    { sku: "SKU-3", costPrice: 899.75 },
  ]);
});

test("stock-batch parser reads warehouse and shelf-life columns, both optional", () => {
  const bytes = workbookBytes([
    ["Склад", "Артикул", "Номенклатура", "Годен_до", "Кол-во", "ДнейДоИстечения", "ОСГ_%"],
    ["Алматы", "SKU-1", "Батончик", "13.01.27", 56, 155, 51],
    ["Алматы", "SKU-2", "Вафли", "22.07.26", 2, "Не годен", null],
    ["Астана", "SKU-1", "Батончик", "05.07.26", 18, 98, 12],
  ]);
  assert.deepEqual(parseSkuStockBatches(bytes), [
    { sku: "SKU-1", warehouse: "Алматы", quantity: 56, shelfLifeRemainingPercent: 51 },
    { sku: "SKU-2", warehouse: "Алматы", quantity: 2, expired: true },
    { sku: "SKU-1", warehouse: "Астана", quantity: 18, shelfLifeRemainingPercent: 12 },
  ]);
});

test("stock-batch parser treats a batch with no shelf-life columns at all as valid, unlabeled quantity", () => {
  const bytes = workbookBytes([
    ["Артикул", "Кол-во"],
    ["SKU-1", 40],
  ]);
  assert.deepEqual(parseSkuStockBatches(bytes), [{ sku: "SKU-1", quantity: 40 }]);
});

test("stock-batch parser expands a real-style warehouse matrix and normalizes Excel percentages", () => {
  const bytes = workbookBytes([
    ["Артикул", "Номенклатура", "Срок годности", "Остаток срока годности, %", "Основной склад", "Склад Алматы", "Склад Астана"],
    ["SKU-1", "Товар один", "31.12.2099", 0.51, 5, 7, null],
    ["SKU-2", "Товар два", "01.01.2000", null, null, null, 3],
  ]);

  assert.deepEqual(parseSkuStockBatches(bytes), [
    { sku: "SKU-1", warehouse: "Основной склад", quantity: 5, shelfLifeRemainingPercent: 51 },
    { sku: "SKU-1", warehouse: "Склад Алматы", quantity: 7, shelfLifeRemainingPercent: 51 },
    { sku: "SKU-2", warehouse: "Склад Астана", quantity: 3, expired: true },
  ]);
});
