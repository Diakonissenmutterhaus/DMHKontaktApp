export interface OutlookExchangeSetupStatus {
  stage: "ready" | "outlook_open" | "awaiting_login" | "connected" | "complete" | "unavailable";
  email: string;
  previousProfile: string | null;
  exchangeProfile: string;
  imapProfile: string | null;
  message: string;
}
