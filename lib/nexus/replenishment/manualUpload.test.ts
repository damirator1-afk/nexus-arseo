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

function uncodedGroupedMonthlyReportBytes(productName: string, unitsSold: number): Uint8Array {
  const rows: unknown[][] = [
    ["Продажи"],
    [],
    ["Покупатель", null, null, "март 2026", null, null, "Итого"],
    ["Номенклатура", null, null, "Выручка,", "Количество", "Себестоимость,", "Выручка,", "Количество", "Себестоимость,"],
    ["Клиент Альфа", null, null, 1_000, unitsSold, 800, 1_000, unitsSold, 800],
    [productName, null, null, 1_000, unitsSold, 800, 1_000, unitsSold, 800],
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

test("manual supplier slug is derived from its name and remains unique", () => {
  assert.equal(supplierKeyFromName("Новый Поставщик", []), "novyy-postavschik");
  assert.equal(supplierKeyFromName("Новый Поставщик", ["novyy-postavschik"]), "novyy-postavschik-2");
});

test("three of six supplier files parse and disclose missing inbound, MOQ and batch stock", async () => {
  const parsed = await buildSupplierParsedData({ key: "alpha", name: "Альфа" }, {
    transactions: [workbookBytes([
      ["Дата", "Номер", "Документ", "Код", "Номенклатура", "Количество"],
      ["01.09.2026", "INV-1", "Продажа", "SKU-1", "Автомат", -5],
    ])],
    monthlySales: [workbookBytes([
      ["Номенклатура", "Номенклатурн.код", "сент. 2026"],
      [null, null, "Количество"],
      ["Автомат", "SKU-1", 5],
    ])],
    openingStocks: [workbookBytes([
      ["Номенклатура", "Номенклатурн.код", "сент. 2026"],
      [null, null, "нач. остаток"],
      ["Автомат", "SKU-1", 12],
    ])],
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
    inbound: [workbookBytes([
      ["Код 1с", "Наименование", "Категория 2026", "Остаток", "Зарезервировано", "СЭ в пути 30.09"],
      ["SKU-1", "Автомат", "A", 20, 3, 0],
    ])],
  });

  assert.deepEqual(parsed.currentStocks, [{ sku: "SKU-1", currentStock: 20 }]);
  assert.deepEqual(parsed.reservations, [{ sku: "SKU-1", reservedStock: 3 }]);
  assert.deepEqual(parsed.categories, [{ sku: "SKU-1", category: "A" }]);
  assert.ok(parsed.missingSources?.includes("openingStocks"));
});

test("manual monthly-sales upload falls back automatically to a grouped 1C report", async () => {
  const parsed = await buildSupplierParsedData({ key: "grouped", name: "Группированный" }, {
    monthlySales: [groupedMonthlyReportBytes()],
    openingStocks: [workbookBytes([
      ["Номенклатура", "Артикул", "сент. 2026"],
      [null, null, "нач. остаток"],
      ["Автомат", "SKU-1", 25],
    ])],
  });

  assert.deepEqual(parsed.monthlySales, [
    { sku: "SKU-1", productName: "Автомат", month: "2026-09", unitsSold: 12 },
  ]);
});

test("supplier without opening or current stock fails with a targeted validation error", async () => {
  await assert.rejects(
    buildSupplierParsedData({ key: "gamma", name: "Гамма" }, {
      monthlySales: [workbookBytes([
        ["Номенклатура", "Номенклатурн.код", "сент. 2026"],
        [null, null, "Количество"],
        ["Автомат", "SKU-1", 5],
      ])],
    }),
    (error: unknown) => error instanceof MissingStockSourceError
      && error.supplierKey === "gamma"
      && /нужен хотя бы один источник остатка/u.test(error.message),
  );
});

test("multiple monthly-sales files preserve the same SKU in different months", async () => {
  const parsed = await buildSupplierParsedData({ key: "multi-month", name: "Несколько месяцев" }, {
    monthlySales: [
      workbookBytes([
        ["Номенклатура", "Артикул", "янв. 2026"],
        [null, null, "Количество"],
        ["Автомат", "SKU-1", 5],
      ]),
      workbookBytes([
        ["Номенклатура", "Артикул", "февр. 2026"],
        [null, null, "Количество"],
        ["Автомат", "SKU-1", 7],
      ]),
    ],
    openingStocks: [workbookBytes([
      ["Номенклатура", "Артикул", "февр. 2026"],
      [null, null, "нач. остаток"],
      ["Автомат", "SKU-1", 20],
    ])],
  });

  assert.deepEqual(parsed.monthlySales, [
    { sku: "SKU-1", productName: "Автомат", month: "2026-01", unitsSold: 5 },
    { sku: "SKU-1", productName: "Автомат", month: "2026-02", unitsSold: 7 },
  ]);
});

test("duplicate SKU-month rows from separate sales and stock files are summed exactly once", async () => {
  const monthlyFile = (units: number) => workbookBytes([
    ["Номенклатура", "Артикул", "март 2026"],
    [null, null, "Количество"],
    ["Автомат", "SKU-1", units],
  ]);
  const stockFile = (stock: number) => workbookBytes([
    ["Номенклатура", "Артикул", "март 2026"],
    [null, null, "нач. остаток"],
    ["Автомат", "SKU-1", stock],
  ]);
  const parsed = await buildSupplierParsedData({ key: "overlap", name: "Пересечение" }, {
    monthlySales: [monthlyFile(5), monthlyFile(7)],
    openingStocks: [stockFile(10), stockFile(4)],
  });

  assert.deepEqual(parsed.monthlySales, [
    { sku: "SKU-1", productName: "Автомат", month: "2026-03", unitsSold: 12 },
  ]);
  assert.deepEqual(parsed.openingStocks, [
    { sku: "SKU-1", productName: "Автомат", month: "2026-03", openingStock: 14 },
  ]);
});

test("exact normalized product name links an uncoded grouped row to a coded file of the same supplier", async () => {
  const parsed = await buildSupplierParsedData({ key: "name-match", name: "Сопоставление" }, {
    monthlySales: [
      workbookBytes([
        ["Номенклатура", "Артикул", "март 2026"],
        [null, null, "Количество"],
        ["Товар А", "SKU-1", 5],
      ]),
      uncodedGroupedMonthlyReportBytes("товар   а", 7),
    ],
    openingStocks: [workbookBytes([
      ["Номенклатура", "Артикул", "март 2026"],
      [null, null, "нач. остаток"],
      ["Товар А", "SKU-1", 20],
    ])],
  });

  assert.deepEqual(parsed.monthlySales, [
    { sku: "SKU-1", productName: "Товар А", month: "2026-03", unitsSold: 12 },
  ]);
  assert.equal(parsed.unmatchedProductNames, undefined);
});

test("reordered product words link an uncoded report row to one authoritative SKU", async () => {
  const parsed = await buildSupplierParsedData({ key: "word-order", name: "Word order" }, {
    monthlySales: [uncodedGroupedMonthlyReportBytes("FAZER Rye crispbread rosemary 200g", 9)],
    openingStocks: [workbookBytes([
      ["Номенклатура", "Артикул", "март 2026"],
      [null, null, "нач. остаток"],
      ["Rye crispbread rosemary FAZER 200g", "SKU-200", 20],
    ])],
  });

  assert.deepEqual(parsed.monthlySales, [
    { sku: "SKU-200", productName: "FAZER Rye crispbread rosemary 200g", month: "2026-03", unitsSold: 9 },
  ]);
  assert.equal(parsed.unmatchedProductNames, undefined);
});

test("small spelling mistakes link only when one authoritative SKU is clearly closest", async () => {
  const parsed = await buildSupplierParsedData({ key: "small-typo", name: "Small typo" }, {
    monthlySales: [uncodedGroupedMonthlyReportBytes("Premium chocolate cookie without palm oill galbusero 220g", 7)],
    openingStocks: [workbookBytes([
      ["Номенклатура", "Артикул", "март 2026"],
      [null, null, "нач. остаток"],
      ["PREMIUM CHOCOLATE COOKIE WITHOUT PALM OIL GALBUSERA 220g", "SKU-220", 15],
      ["PREMIUM HONEY COOKIE WITHOUT PALM OIL GALBUSERA 220g", "SKU-HONEY", 15],
    ])],
  });

  assert.deepEqual(parsed.monthlySales, [
    { sku: "SKU-220", productName: "Premium chocolate cookie without palm oill galbusero 220g", month: "2026-03", unitsSold: 7 },
  ]);
  assert.equal(parsed.unmatchedProductNames, undefined);
});

test("name matching never guesses across pack sizes or ambiguous authoritative SKUs", async () => {
  const packMismatch = "FAZER Rye crispbread rosemary 330g";
  const ambiguousName = "FAZER Rye crispbread 200g";
  const parsed = await buildSupplierParsedData({ key: "blocked-match", name: "Blocked match" }, {
    monthlySales: [
      uncodedGroupedMonthlyReportBytes(packMismatch, 5),
      uncodedGroupedMonthlyReportBytes(ambiguousName, 6),
    ],
    openingStocks: [workbookBytes([
      ["Номенклатура", "Артикул", "март 2026"],
      [null, null, "нач. остаток"],
      ["Rye crispbread rosemary FAZER 200g", "SKU-200", 20],
      ["Rye crispbread FAZER 200g", "SKU-A", 20],
      ["Rye FAZER crispbread 200g", "SKU-B", 20],
    ])],
  });

  assert.deepEqual(parsed.monthlySales, []);
  assert.deepEqual(parsed.unmatchedProductNames, [packMismatch, ambiguousName]);
});

test("unknown no-SKU product is excluded from demand and disclosed explicitly", async () => {
  const parsed = await buildSupplierParsedData({ key: "name-miss", name: "Без пары" }, {
    monthlySales: [
      workbookBytes([
        ["Номенклатура", "Артикул", "март 2026"],
        [null, null, "Количество"],
        ["Товар А", "SKU-1", 5],
      ]),
      uncodedGroupedMonthlyReportBytes("Неизвестный товар", 9),
    ],
    openingStocks: [workbookBytes([
      ["Номенклатура", "Артикул", "март 2026"],
      [null, null, "нач. остаток"],
      ["Товар А", "SKU-1", 20],
    ])],
  });

  assert.deepEqual(parsed.monthlySales, [
    { sku: "SKU-1", productName: "Товар А", month: "2026-03", unitsSold: 5 },
  ]);
  assert.deepEqual(parsed.unmatchedProductNames, ["Неизвестный товар"]);
});

test("warehouse-matrix stock uploaded in the monthly-stock field is recognized as batch stock", async () => {
  const parsed = await buildSupplierParsedData({ key: "matrix-stock", name: "Матрица складов" }, {
    monthlySales: [
      uncodedGroupedMonthlyReportBytes("товар   один", 5),
      workbookBytes([
        ["Номенклатура", "Артикул", "март 2026"],
        [null, null, "Количество"],
        ["ТОВАР ОДИН", "EAN-0001", 3],
      ]),
    ],
    openingStocks: [workbookBytes([
      ["Артикул", "Номенклатура", "Срок годности", "Остаток срока годности, %", "Основной склад", "Склад Алматы", "Склад Астана"],
      ["SKU-1", "Товар один", "31.12.2099", 0.45, null, 10, 4],
    ])],
  });

  assert.deepEqual(parsed.openingStocks, []);
  assert.deepEqual(parsed.monthlySales, [
    { sku: "SKU-1", productName: "товар   один", month: "2026-03", unitsSold: 8 },
  ]);
  assert.equal(parsed.unmatchedProductNames, undefined);
  assert.deepEqual(parsed.stockBatches, [
    { sku: "SKU-1", productName: "Товар один", warehouse: "Склад Алматы", quantity: 10, shelfLifeRemainingPercent: 45 },
    { sku: "SKU-1", productName: "Товар один", warehouse: "Склад Астана", quantity: 4, shelfLifeRemainingPercent: 45 },
  ]);
});
