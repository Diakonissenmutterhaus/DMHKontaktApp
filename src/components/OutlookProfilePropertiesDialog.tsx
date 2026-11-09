import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { OutlookProfileCatalog } from "../types/outlookExchange";
import { m365SafeImportTestMode } from "../utils/automaticCalendarSync";
import "./OutlookProfilePropertiesDialog.css";

interface Props {
  profile: OutlookProfileCatalog["profiles"][number];
  isDefault: boolean;
  busy: boolean;
  error: string;
  message: string;
  onClose: () => void;
  onOpen: () => void;
  onSetDefault: () => void;
}

export function OutlookProfilePropertiesDialog({ profile, isDefault, busy, error, message, onClose, onOpen, onSetDefault }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previousFocus = document.activeElement;
    const element = dialog.current;
    if (element?.showModal) element.showModal();
    else element?.setAttribute("open", "");
    return () => { if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); };
  }, []);

  return createPortal(
    <dialog ref={dialog} className="outlook-profile-properties-dialog" aria-labelledby={titleId} aria-modal="true" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <header><h3 id={titleId}>Eigenschaften von {profile.name}</h3><button type="button" aria-label="Eigenschaften schließen" disabled={busy} onClick={onClose}>×</button></header>
      <div className="outlook-profile-properties-content">
        <dl className="outlook-profile-properties-summary"><div><dt>Standardprofil</dt><dd>{isDefault ? "Ja" : "Nein"}</dd></div><div><dt>Status</dt><dd>{profile.source === "active" ? "Geöffnet" : "Gespeichert"}</dd></div></dl>
        <fieldset><legend>Konten und Benutzer ({profile.accounts.length})</legend>
          <div className="outlook-profile-properties-table"><table aria-label="Konten des gewählten Profils"><thead><tr><th>Konto / E-Mail</th><th>Benutzer</th><th>Typ</th><th>Server</th></tr></thead><tbody>
            {profile.accounts.map((account, index) => <tr key={`${account.email}:${index}`}><td>{account.email || "—"}{account.name && account.name !== account.email && <small>{account.name}</small>}</td><td>{account.user || "—"}</td><td>{account.accountType === "Other" ? "Andere" : account.accountType}</td><td>{account.server || "—"}</td></tr>)}
          </tbody></table></div>
          {!profile.accounts.length && <p>Keine Konten auslesbar.</p>}
        </fieldset>
        <fieldset><legend>Postfächer und Datendateien ({profile.stores.length})</legend>
          <div className="outlook-profile-properties-table"><table aria-label="Postfächer und Datendateien des gewählten Profils"><thead><tr><th>Name</th><th>Typ</th><th>Posteingang / Dateipfad</th></tr></thead><tbody>
            {profile.stores.map((store, index) => <tr key={`${store.path}:${index}`}><td>{store.name || "—"}</td><td>{store.kind || "—"}</td><td>{store.inbox && <span>{store.inbox}</span>}{store.path && <span>{store.path}</span>}{!store.inbox && !store.path && "—"}</td></tr>)}
          </tbody></table></div>
          {!profile.stores.length && <p>Keine Datendateien oder Postfächer auslesbar.</p>}
        </fieldset>
        {profile.note && <p className="outlook-profile-properties-note">{profile.note}</p>}
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
      </div>
      <footer><button type="button" disabled={busy} onClick={onOpen}>Mit diesem Profil öffnen</button><button type="button" disabled={busy || isDefault || m365SafeImportTestMode} onClick={onSetDefault}>Als Standard verwenden</button><button type="button" disabled={busy} onClick={onClose}>Schließen</button></footer>
    </dialog>, document.body
  );
}
