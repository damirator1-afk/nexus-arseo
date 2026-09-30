import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  isMissingColumnError,
  parseInboundShipments,
  parseMonthlyOpeningStock,
  parseMonthlySales,
  parseMinimumOrderQuantities,
  parseSalesTransactions,
  parseSkuCostPrices,
  parseSkuCurrentStocks,
  parseSkuReservations,
} from "./xlsxParsers.ts";

function workbookBytes(rows: unknown[][], sheetName = "Лист_1"): Uint8Array {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
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
