export interface LocalEmailSource { id: string; name: string; kind: string; path: string; accountKind?: string }
export interface LocalEmailScan { sources: LocalEmailSource[]; issues: string[]; folders?: EmailSourceFolder[]; archivePath?: string }
export interface EmailSourceFolder { id: string; sourceId: string; name: string; path: string; source: string; importedOrder?: number | null; sortKey?: string | null; accountKind?: string }
export interface EmailArchiveFolder { id: string; name: string; path: string; source: string; sourceId?: string; count: number; importedOrder?: number | null; sortKey?: string | null; accountKind?: string }
export type EmailFolderPreferences = Record<string, string[]>;
export interface ArchivedEmail {
  id: string; folderId: string; subject: string; sender: string; recipient: string; cc: string;
  date: string; body: string; html: string; attachments: string[]; large: boolean;
  category?: string; categoryColor?: string; deleted?: boolean;
}
export interface EmailArchivePage { items: ArchivedEmail[]; total: number }
export type EmailArchiveSort = "newest" | "oldest" | "subject" | "subjectDesc" | "sender" | "senderDesc";
export interface EmailArchiveQuery {
  folderId: string | null; search: string; offset: number;
  fromAt: string | null; beforeAt: string | null; attachmentsOnly: boolean; sort: EmailArchiveSort;
  includeDeleted?: boolean; category?: string | null;
}
export interface EmailArchiveCategory { name:string; color:string }
export interface EmailMessageEdit { id:string; action:"move" | "trash" | "restore" | "category"; folderId?:string; category?:string; color?:string; title?:string; startsAt?:string }
export interface EmailCopyResult { copied: number; folders: number; issues: string[]; completedAt: string }
export interface EmailCopyStatus { running: boolean; progress: string; result: EmailCopyResult | null; failed: boolean }
export interface EmailAttachment { index: number; name: string; size: number; mimeType: string; preview: "pdf" | "image" | "none"; available: boolean }
export interface EmailAttachmentData { attachment: EmailAttachment; base64: string }
export interface EmailArchiveTarget { source: string; sourceId: string; path: string }
export interface EmailRemovalPreview { target: EmailArchiveTarget; name: string; folders: number; messages: number; token: string }
