export interface OutlookExchangeSetupStatus {
  stage: "ready" | "outlook_open" | "awaiting_login" | "awaiting_close" | "connected" | "complete" | "unavailable";
  email: string;
  previousProfile: string | null;
  exchangeProfile: string;
  imapProfile: string | null;
  message: string;
}

export interface OutlookOfficeAccountCheck {
  dmhEmail: string;
  dmhEmails: string[];
  accounts: Array<{ email: string; displayName: string }>;
  suggestedEmail: string;
  readSucceeded: boolean;
  sources?: Array<{ version: string; view: string; state: string; identityCount: number }>;
}

export interface OutlookAccountConfiguration {
  defaultProfile?: string;
  activeProfile?: string;
  promptForProfile?: boolean;
  email: string;
  profile: string;
  source: "active" | "default" | "unavailable";
  accounts: Array<{ accountType: "IMAP" | "Exchange" | "POP3" | "Other"; server: string }>;
  message: string;
}

export interface OutlookProfileCatalog {
  defaultProfile: string;
  activeProfile: string;
  promptForProfile: boolean;
  profiles: Array<{
    name: string;
    source: "active" | "registered";
    accounts: Array<{ email: string; user: string; name: string; accountType: string; server: string }>;
    stores: Array<{ name: string; kind: string; path: string; inbox: string }>;
    note: string;
  }>;
}
