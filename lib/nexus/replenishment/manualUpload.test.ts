import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  buildSupplierParsedData,
  MissingStockSourceError,
  supplierKeyFromName,
} from "../../../components/replenishment/shared.ts";

function workbookBytes(rows: unknown[][]): Uint8Array {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Лист_1");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function groupedMonthlyReportBytes(): Uint8Array {
  const rows: unknown[][] = [
    [null, null, null, "Период: 01.09.2026 - 30.09.2026"],
    [],
    ["Подразделение", null, null, null, null, null, null, null, null, null, null, null, "Количество"],
    ["Клиент.Адрес"],
    ["Клиент"],
    ["Номенклатура, Артикул"],
    ["Клиент Альфа", null, null, null, null, null, null, null, null, null, null, null, 20],
    ["Автомат, SKU-1", null, null, null, null, null, null, null, null, null, null, null, 12],
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!rows"] = rows.map((_, index) => index === 6 ? { level: 2 } : index === 7 ? { level: 3 } : {});
  worksheet["!merges"] = [{ s: { r: 2, c: 12 }, e: { r: 5, c: 13 } }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Отчёт");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", cellStyles: true });
}

test("manual supplier slug is derived from its name and remains unique", () => {
  assert.equal(supplierKeyFromName("Новый Поставщик", []), "novyy-postavschik");
  assert.equal(supplierKeyFromName("Новый Поставщик", ["novyy-postavschik"]), "novyy-postavschik-2");
});

test("three of six supplier files parse and disclose missing inbound, MOQ and batch stock", async () => {
  const parsed = await buildSupplierParsedData({ key: "alpha", name: "Альфа" }, {
    transactions: workbookBytes([
      ["Дата", "Номер", "Документ", "Код", "Номенклатура", "Количество"],
      ["01.09.2026", "INV-1", "Продажа", "SKU-1", "Автомат", -5],
    ]),
    monthlySales: workbookBytes([
      ["Номенклатура", "Номенклатурн.код", "сент. 2026"],
      [null, null, "Количество"],
      ["Автомат", "SKU-1", 5],
    ]),
    openingStocks: workbookBytes([
      ["Номенклатура", "Номенклатурн.код", "сент. 2026"],
      [null, null, "нач. остаток"],
      ["Автомат", "SKU-1", 12],
    ]),
  });

  assert.equal(parsed.supplier, "Альфа");
  assert.equal(parsed.monthlySales.length, 1);
  assert.equal(parsed.openingStocks.length, 1);
  assert.deepEqual(parsed.inboundShipments, []);
  assert.deepEqual(parsed.minimumOrderQuantities, []);
  assert.deepEqual(parsed.missingSources, ["inbound", "moq", "stockBatches"]);
});

test("current stock embedded in an arbitrary supplier dashboard satisfies the stock-source rule", async () => {
  const parsed = await buildSupplierParsedData({ key: "beta", name: "Бета" }, {
    inbound: workbookBytes([
      ["Код 1с", "Наименование", "Категория 2026", "Остаток", "Зарезервировано", "СЭ в пути 30.09"],
      ["SKU-1", "Автомат", "A", 20, 3, 0],
    ]),
  });

  assert.deepEqual(parsed.currentStocks, [{ sku: "SKU-1", currentStock: 20 }]);
  assert.deepEqual(parsed.reservations, [{ sku: "SKU-1", reservedStock: 3 }]);
  assert.deepEqual(parsed.categories, [{ sku: "SKU-1", category: "A" }]);
  assert.ok(parsed.missingSources?.includes("openingStocks"));
});

test("manual monthly-sales upload falls back automatically to a grouped 1C report", async () => {
  const parsed = await buildSupplierParsedData({ key: "grouped", name: "Группированный" }, {
    monthlySales: groupedMonthlyReportBytes(),
    openingStocks: workbookBytes([
      ["Номенклатура", "Артикул", "сент. 2026"],
      [null, null, "нач. остаток"],
      ["Автомат", "SKU-1", 25],
    ]),
  });

  assert.deepEqual(parsed.monthlySales, [
    { sku: "SKU-1", productName: "Автомат", month: "2026-09", unitsSold: 12 },
  ]);
});

test("supplier without opening or current stock fails with a targeted validation error", async () => {
  await assert.rejects(
    buildSupplierParsedData({ key: "gamma", name: "Гамма" }, {
      monthlySales: workbookBytes([
        ["Номенклатура", "Номенклатурн.код", "сент. 2026"],
        [null, null, "Количество"],
        ["Автомат", "SKU-1", 5],
      ]),
    }),
    (error: unknown) => error instanceof MissingStockSourceError
      && error.supplierKey === "gamma"
      && /нужен хотя бы один источник остатка/u.test(error.message),
  );
});
