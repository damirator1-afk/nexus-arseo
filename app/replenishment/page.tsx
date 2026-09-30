import type { Metadata } from "next";
import { ReplenishmentWorkspace } from "@/components/replenishment/ReplenishmentWorkspace";

export const metadata: Metadata = {
  title: "Расчёт пополнения склада | Nexus",
  description: "Детерминированный расчёт заказов поставщикам по загруженным XLSX-файлам.",
};

export default function ReplenishmentPage() {
  return <ReplenishmentWorkspace />;
}
