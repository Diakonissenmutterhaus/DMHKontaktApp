export interface AuditLogEntry {
  id: number;
  occurredAt: string;
  actor: string;
  source: "user" | "m365" | string;
  action: string;
  entityKind: string;
  entityId?: string | null;
  summary: string;
}

export interface AuditLogFilter {
  search?: string;
  action?: string;
  entityKind?: string;
  source?: string;
  fromAt?: string;
  beforeAt?: string;
  beforeId?: number;
  limit?: number;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  hasMore: boolean;
}
