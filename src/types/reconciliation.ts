export type ReconciliationKind = "contacts" | "calendar";
export type ReconciliationPlatform = "outlook" | "thunderbird";
export type ReconciliationStatus = "new" | "update" | "same" | "kept" | "deleted" | "review";
export interface ReconciliationPreview {
  token: string;
  counts: Partial<Record<ReconciliationStatus, number>>;
  warnings: string[];
  items: Array<{
    key: string; label: string; status: ReconciliationStatus; reason: string; selectable: boolean;
    differences: Array<{ field: string; current: unknown; incoming: unknown }>;
  }>;
}
export interface ReconciliationResult { added: number; updated: number; unchanged: number; review: number }
