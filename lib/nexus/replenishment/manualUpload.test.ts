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

test("manual supplier slug is derived from its name and remains unique", () => {
  assert.equal(supplierKeyFromName("Новый Поставщик", []), "novyy-postavschik");
  assert.equal(supplierKeyFromName("Новый Поставщик", ["novyy-postavschik"]), "novyy-postavschik-2");
});

test("three of five supplier files parse and disclose missing inbound and MOQ", async () => {
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
  assert.deepEqual(parsed.missingSources, ["inbound", "moq"]);
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
