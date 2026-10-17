import type { Metadata } from "next";
import { HistoryList } from "@/components/compiler/history-list";

export const metadata: Metadata = { title: "Query History" };

export default function HistoryPage() {
  return <HistoryList />;
}
