export interface AuditLogEntry {
  id: number;
  occurredAt: string;
  actor: string;
  action: string;
  entityKind: string;
  entityId?: string | null;
  summary: string;
}
