import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { inlineMessage, publicNotification, reportDiagnostic } from "../utils/notificationPolicy";

export function useDiagnosticMessage(origin: string, placement: "inline" | "notification" = "notification"): [string, Dispatch<SetStateAction<string>>] {
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (message) void reportDiagnostic({ origin, operation: origin.split(":").pop(), level: /Error|error|fehler|fehlgeschlagen|konnte nicht|nicht gespeichert|HTTP \d|constraint failed/i.test(`${origin} ${message}`) ? "error" : "info", message });
  }, [message, origin]);
  return [placement === "inline" ? inlineMessage(message) : publicNotification(message) ?? "", setMessage];
}
