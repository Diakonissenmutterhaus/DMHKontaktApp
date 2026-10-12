export type BulkKind = "calendar" | "contacts";
export interface BulkFilter {
  kind: BulkKind; search: string; exact: boolean; source: string; category: string;
  fromDate: string; toDate: string; company: string; group: string;
  sort: string; descending: boolean; offset: number;
}
export interface BulkItem {
  id: string; title: string; start: string; end: string; source: string; category: string;
  email: string; company: string; groups: string; series: boolean;
}
export interface BulkPage {
  items: BulkItem[]; total: number; sources: string[]; categories: string[]; companies: string[]; groups: string[];
}
export interface BulkSelection { filter: BulkFilter; allMatching: boolean; ids: string[]; excludedIds: string[]; }
export interface BulkPreview { selected: number; affected: number; series: number; revision: string; }
