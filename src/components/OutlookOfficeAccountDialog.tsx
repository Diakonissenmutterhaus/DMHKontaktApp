import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { connectMicrosoft365Interactively, getAppSetting, setAppSetting } from "../services/db";
import type { Microsoft365Account } from "../types/m365";
import type { OutlookOfficeAccountCheck } from "../types/outlookExchange";
import { parseSyncConfig } from "../types/sync";
import { synchronizationConfigKey } from "../utils/automaticCalendarSync";
import { completeAutomaticSyncInitializedKey } from "../utils/microsoft365SyncConfig";
import "./OutlookOfficeAccountDialog.css";
import { M365Loading } from "./M365Loading";

interface Props {
  check: OutlookOfficeAccountCheck;
  onContinue: (email: string) => void;
  onAccountChanged?: (account: Microsoft365Account) => void;
  onClose: () => void;
}

export function OutlookOfficeAccountDialog({ check, onContinue, onAccountChanged, onClose }: Props) {
  const [selected, setSelected] = useState(check.suggestedEmail || (check.accounts.length === 1 ? check.accounts[0].email : ""));
  const [manual, setManual] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const selectId = useId();
  const email = (selected === "__manual__" || !check.accounts.length ? manual : selected).trim();
  const valid = /^[^\s@]+@[^\s@]+$/.test(email);
  const matches = valid && check.dmhEmails.some((alias) => alias.toLowerCase() === email.toLowerCase());
  useEffect(() => {
    const previous = document.activeElement;
    if (dialog.current?.showModal) dialog.current.showModal();
    else dialog.current?.setAttribute("open", "");
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  const switchAccount = async () => {
    if (!confirmed || !valid || busy) return;
    setBusy(true); setError("");
    let paused = false;
    try {
      const config = parseSyncConfig(await getAppSetting(synchronizationConfigKey));
      await setAppSetting(synchronizationConfigKey, JSON.stringify({ ...config, paused: true }));
      paused = true;
      await setAppSetting(completeAutomaticSyncInitializedKey, "true");
      const account = await connectMicrosoft365Interactively(email);
      if (![account.email, account.userPrincipalName].some((alias) => alias.toLowerCase() === email.toLowerCase())) throw new Error("wrong_account");
      onAccountChanged?.(account);
      onClose();
    } catch {
      setError(`Das bestätigte Excel-Konto wurde nicht verbunden. Bitte bei Microsoft genau dieses Konto auswählen.${paused ? " Die Synchronisierung bleibt pausiert." : ""} Es wurde kein Outlook-Profil eingerichtet.`);
    } finally { setBusy(false); }
  };

  return createPortal(<dialog ref={dialog} className="outlook-office-account-dialog" aria-labelledby={titleId} aria-modal="true" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <M365Loading active={busy} message="Microsoft-Konto wird verbunden. Bitte warten …" />
    <header><h3 id={titleId}>Excel-Konto prüfen</h3></header>
    <div className="outlook-office-account-content">
      <p><strong>Outlook muss mit demselben Konto wie Excel eingerichtet werden.</strong> Prüfen Sie die E-Mail-Adresse in Excel unter <strong>Datei → Konto</strong>.</p>
      <p className="outlook-office-account-note">Für die Einrichtung wird Outlook automatisch geschlossen und im Hintergrund konfiguriert. Offene Entwürfe bitte vorher speichern.</p>
      <dl><dt>In DMH angemeldet</dt><dd>{check.dmhEmail}</dd></dl>
      {check.accounts.length > 0 ? <><label htmlFor={selectId}>Im Office gespeicherte Konten</label><select id={selectId} disabled={busy} value={selected} onChange={(event) => { setSelected(event.target.value); setConfirmed(false); setError(""); }}><option value="">Excel-Konto auswählen …</option>{check.accounts.map((account) => <option key={account.email} value={account.email}>{account.email}{account.displayName ? ` · ${account.displayName}` : ""}</option>)}<option value="__manual__">Andere E-Mail-Adresse …</option></select><p className="outlook-office-account-note">Gespeicherte Konten bestätigen nicht, welches Konto gerade in Excel aktiv ist.</p></> : <p>Das aktive Excel-Konto konnte nicht automatisch ermittelt werden. Übernehmen Sie die Adresse aus Excel → Datei → Konto.</p>}
      {(selected === "__manual__" || !check.accounts.length) && <label>Excel-E-Mail-Adresse<input type="email" disabled={busy} maxLength={254} value={manual} onChange={(event) => { setManual(event.target.value); setConfirmed(false); setError(""); }} /></label>}
      {valid && !matches && <p className="outlook-office-account-warning" role="alert">Die Konten unterscheiden sich. Verbinden Sie DMH zuerst mit <strong>{email}</strong>. Die Exchange-Einrichtung ist bis dahin gesperrt.</p>}
      <label className="outlook-office-account-confirm"><input type="checkbox" checked={confirmed} disabled={busy || !valid} onChange={(event) => setConfirmed(event.target.checked)} />Ich habe in Excel → Datei → Konto geprüft: Dort ist {email || "dieses Konto"} angemeldet.</label>
      {!matches && <p className="outlook-office-account-note">Beim Kontowechsel wird die automatische Synchronisierung pausiert. Excel selbst wird nicht verändert.</p>}
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Bitte das bestätigte Excel-Konto in der Microsoft-Anmeldung auswählen …</p>}
    </div>
    <footer><button type="button" disabled={busy} onClick={onClose}>Abbrechen</button>{matches ? <button type="button" className="primary" disabled={!confirmed || busy} onClick={() => onContinue(email)}>Exchange einrichten</button> : <button type="button" className="primary" disabled={!confirmed || !valid || busy || !onAccountChanged} onClick={() => void switchAccount()}>{busy ? "Anmeldung läuft …" : "DMH mit Excel-Konto verbinden"}</button>}</footer>
  </dialog>, document.body);
}
