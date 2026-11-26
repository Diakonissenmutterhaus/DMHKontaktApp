import { invokeWithDiagnostics as invoke } from "../utils/notificationPolicy";
import type { ReconciliationKind, ReconciliationPlatform, ReconciliationPreview, ReconciliationResult } from "../types/reconciliation";
export function previewReconciliation(kind: ReconciliationKind, platform: ReconciliationPlatform) {
  return invoke<ReconciliationPreview>("preview_reconciliation", { kind, platform });
}
export function applyReconciliation(token: string, selected: string[]) {
  return invoke<ReconciliationResult>("apply_reconciliation", { token, selected });
}
