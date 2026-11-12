import { invokeWithDiagnostics as invoke } from "../utils/notificationPolicy";

export interface KiConfig {
  revision: string;
  title: string;
  version: string;
  body: string;
  trainingUrl: string;
  published: boolean;
  pdfSha256?: string;
  pdfName?: string;
}
export interface KiSubmission {
  revision: string;
  fullName: string;
  email: string;
  department: string;
  readConfirmed: boolean;
  trainingConfirmed: boolean;
  trainingMode: "onsite" | "online";
  trainingDate: string;
  signatureMethod: "draw" | "typed" | "import";
  signaturePng: string;
}
export interface KiReceipt extends KiSubmission {
  id: string;
  submittedAt: string;
  policySha256: string;
  policy: KiConfig;
}
export const getKiConfig = () => invoke<KiConfig>("get_ki_config");
export const saveKiConfig = (config: KiConfig) => invoke<KiConfig>("save_ki_config", { config });
export const submitKiAcknowledgement = (submission: KiSubmission) => invoke<KiReceipt>("submit_ki_acknowledgement", { submission });
export const listKiAcknowledgements = () => invoke<KiReceipt[]>("list_ki_acknowledgements");
export const listMyKiAcknowledgements = () => invoke<KiReceipt[]>("list_my_ki_acknowledgements");
export const getKiPdf = (sha256: string) => invoke<string>("get_ki_pdf", { sha256 });
export const importKiPdf = (name: string, base64: string) => invoke<{ sha256: string; name: string }>("import_ki_pdf", { name, base64 });
export interface KiAccessInput { fullName: string; email: string; department: string; tool: string; purpose: string }
export interface KiAccessRequest extends KiAccessInput { id: string; createdAt: string; status: "prepared" }
export const saveKiAccessRequest = (input: KiAccessInput) => invoke<KiAccessRequest>("save_ki_access_request", { input });
export const listKiAccessRequests = () => invoke<KiAccessRequest[]>("list_ki_access_requests");
export interface KiNews { id: string; date: string; title: string; summary: string; body: string; category: "Mitteilung" | "Richtlinie" | "Schulung" | "KI-Neuigkeit"; published: boolean; sourceUrl: string; updatedAt: string }
export const listKiNews = (includeDrafts = false) => invoke<KiNews[]>("list_ki_news", { includeDrafts });
export const saveKiNews = (article: KiNews) => invoke<KiNews>("save_ki_news", { article });
