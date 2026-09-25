export type YearMonth = `${number}-${string}`;

export interface SalesTransaction {
  /** Added by the assembly layer so identical SKU codes from different suppliers cannot collide. */
  supplier?: string;
  occurredAt: string;
  invoiceNumber: string;
  document?: string;
  sku: string;
  productName: string;
  unit?: string;
  warehouse?: string;
  /** Absolute quantity sold. Partner exports switch sign convention between years. */
  unitsSold: number;
  /** Original signed value retained for auditability. */
  sourceQuantity: number;
}

export interface MonthlySales {
  supplier?: string;
  sku: string;
  productName: string;
  unit?: string;
  month: YearMonth;
  unitsSold: number;
}

export interface MonthlyOpeningStock {
  supplier?: string;
  sku: string;
  productName: string;
  unit?: string;
  month: YearMonth;
  openingStock: number;
}

export interface InboundShipment {
  supplier?: string;
  sku: string;
  supplierArticle?: string;
  productName: string;
  /** Original supply-column label, used as a stable, auditable shipment identifier. */
  shipmentId: string;
  /** Present only when the column explicitly states a full expected-arrival date. */
  expectedDate: string | null;
  quantity: number;
}

export interface MinimumOrderQuantity {
  supplier?: string;
  sku: string;
  supplierArticle?: string;
  productName: string;
  /** Smallest permitted order multiple. */
  multiple: number;
}

export interface SkuCategory {
  supplier?: string;
  sku: string;
  category: string;
}

export interface SkuReservation {
  supplier?: string;
  sku: string;
  reservedStock: number;
}

export interface SkuCurrentStock {
  supplier?: string;
  sku: string;
  /** Current physical stock snapshot from a supplier dashboard. */
  currentStock: number;
}

export interface SkuCostPrice {
  supplier?: string;
  sku: string;
  /**
   * Per-unit cost price ("СС реал"), currently only exposed by Systeme Electric's dashboard
   * export (724 of 3017 combined SKUs). IEK's source files carry no price field at all —
   * this is presentation-only data (order sums for display), never used by the replenishment
   * calculation itself, so its absence for most SKUs never blocks or skews a recommendation.
   */
  costPrice: number;
}

export type XlsxInput = ArrayBuffer | Uint8Array;
