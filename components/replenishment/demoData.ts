import type { FileKind, SupplierKey } from "./shared";

/**
 * Static copies of the real partner XLSX files under `public/`, so the workspace can open with a
 * real, already-computed result instead of requiring a manual 10-file upload first. The canonical
 * reproducibility dataset stays at `demo/data/replenishment/` (documented in README.md); these are
 * plain byte-identical copies made servable by Next.js.
 */
const DEMO_DIR: Record<SupplierKey, string> = { iek: "iek", systeme: "systeme-electric" };
const DEMO_FILENAMES: Record<SupplierKey, Record<FileKind, string>> = {
  iek: {
    transactions: "sales_transactions.xlsx",
    monthlySales: "monthly_sales.xlsx",
    openingStocks: "monthly_stock.xlsx",
    inbound: "inbound_shipments.xlsx",
    moq: "moq.xlsx",
  },
  systeme: {
    transactions: "sales_transactions.xlsx",
    monthlySales: "monthly_sales.xlsx",
    openingStocks: "monthly_stock.xlsx",
    inbound: "inbound_dashboard.xlsx",
    moq: "moq.xlsx",
  },
};

export async function fetchDemoSupplierBuffers(key: SupplierKey): Promise<Record<FileKind, Uint8Array>> {
  const entries = await Promise.all(
    Object.entries(DEMO_FILENAMES[key]).map(async ([kind, filename]) => {
      const path = `/demo/replenishment/${DEMO_DIR[key]}/${filename}`;
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Не удалось загрузить демо-файл ${filename} (HTTP ${response.status}).`);
      return [kind as FileKind, new Uint8Array(await response.arrayBuffer())] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<FileKind, Uint8Array>;
}
