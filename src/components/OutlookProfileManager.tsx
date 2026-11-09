import { useEffect, useState, type FormEvent } from "react";
import { OutlookProfilePropertiesDialog } from "./OutlookProfilePropertiesDialog";
import { FolderOpen, RefreshCw, Plus, Trash2 } from "lucide-react";
import { getOutlookProfileCatalog, setOutlookDefaultProfile, openOutlookProfile, createOutlookProfile, removeOutlookProfile } from "../services/db";
import type { OutlookProfileCatalog } from "../types/outlookExchange";
import { m365SafeImportTestMode } from "../utils/automaticCalendarSync";

export function OutlookProfileManager({ onDefaultChanged }: { onDefaultChanged: (profile: string) => void }) {
  const [catalog, setCatalog] = useState<OutlookProfileCatalog | null>(null);
  const [selected, setSelected] = useState("");
  const [startupProfile, setStartupProfile] = useState("");
  const [showProperties, setShowProperties] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(false);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [removing, setRemoving] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setRemoving(false);
    void getOutlookProfileCatalog().then((next) => {
      if (cancelled) return;
      setCatalog(next);
      setStartupProfile(next.defaultProfile);
      setSelected((current) => next.profiles.some((profile) => profile.name === current) ? current : next.defaultProfile || next.profiles[0]?.name || "");
    }).catch(() => {
      if (!cancelled) setError("Outlook-Profile konnten nicht gelesen werden. Bitte erneut aktualisieren.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refresh]);

  const save = async (profile = startupProfile) => {
    if (!profile || saving || loading) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await setOutlookDefaultProfile(profile);
      setCatalog((current) => current ? { ...current, defaultProfile: result.defaultProfile } : current);
      setStartupProfile(result.defaultProfile);
      onDefaultChanged(result.defaultProfile);
      setMessage(`Standardprofil gespeichert: ${result.defaultProfile}. Gilt für die nächste Outlook-Öffnung.`);
    } catch (cause) {
      setError(`Standardprofil konnte nicht geändert werden: ${String(cause)}`);
    } finally { setSaving(false); }
  };

  const openSelected = async () => {
    if (!selected || loading || saving || opening) return;
    setOpening(true);
    setError("");
    setMessage("");
    try {
      const result = await openOutlookProfile(selected);
      setMessage(result.message);
      setRefresh((value) => value + 1);
    } catch (cause) { setError(`Outlook konnte nicht geöffnet werden: ${String(cause)}`); }
    finally { setOpening(false); }
  };

  const detail = catalog?.profiles.find((profile) => profile.name === selected);
  const busy = loading || saving || opening || editing;
  const selectProfile = (name: string) => { if (!busy) { setSelected(name); setRemoving(false); } };

  const addProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !newName.trim()) return;
    setEditing(true); setError(""); setMessage("");
    try {
      const result = await createOutlookProfile(newName.trim());
      setSelected(result.profile);
      setNewName(""); setAdding(false);
      setMessage(`Profil „${result.profile}“ erstellt. Über „Öffnen“ das Konto einrichten.`);
      setRefresh((value) => value + 1);
    } catch (cause) { setError(`Profil konnte nicht erstellt werden: ${String(cause)}`); }
    finally { setEditing(false); }
  };

  const confirmRemoval = async () => {
    if (busy || !selected || !removing || catalog?.activeProfile) return;
    const isDefault = selected === catalog?.defaultProfile;
    if (isDefault && (catalog?.profiles.length ?? 0) > 1 && !replacement) return;
    setEditing(true); setError(""); setMessage("");
    try {
      const result = await removeOutlookProfile(selected, isDefault ? replacement || null : null);
      setRemoving(false);
      setMessage(`Profil „${selected}“ entfernt.`);
      setSelected(result.defaultProfile);
      onDefaultChanged(result.defaultProfile);
      setRefresh((value) => value + 1);
    } catch (cause) { setError(`Profil konnte nicht entfernt werden: ${String(cause)}`); }
    finally { setEditing(false); }
  };
  return (
    <section className="outlook-profile-manager" aria-label="Outlook-Profile verwalten" aria-busy={busy}>
      <div className="outlook-profile-general">
        <label htmlFor="outlook-profile-list">Eingerichtete Profile</label>
        <select id="outlook-profile-list" className="outlook-profile-system-list" aria-label="Eingerichtete Profile" size={5} value={selected} disabled={busy} onChange={(event) => selectProfile(event.target.value)}>
          {catalog?.profiles.map((profile) => <option key={profile.name} value={profile.name}>{profile.name}{profile.name === catalog.defaultProfile ? " (Standard)" : ""}{profile.name === catalog.activeProfile ? " · geöffnet" : ""}</option>)}
        </select>
        {catalog && !catalog.profiles.length && <p>Keine eingerichteten Profile gefunden.</p>}
        <div className="outlook-profile-buttons">
          <button type="button" disabled={busy || m365SafeImportTestMode} onClick={() => { setAdding((value) => !value); setRemoving(false); }}><Plus size={14} /> Hinzufügen…</button>
          <button type="button" disabled={busy || m365SafeImportTestMode || !selected} onClick={() => { setRemoving(true); setAdding(false); setReplacement(""); }}><Trash2 size={14} /> Entfernen</button>
          <button type="button" disabled={busy || !selected} aria-haspopup="dialog" onClick={() => { setError(""); setMessage(""); setShowProperties(true); }}>Eigenschaften</button>
          <button type="button" disabled={busy || !selected} onClick={() => void openSelected()} title={`Profil „${selected}“ öffnen, ohne den Standard zu ändern`}><FolderOpen size={14} />{opening ? "Wird geöffnet …" : "Öffnen"}</button>
          <button type="button" aria-label="Aktualisieren" title="Profile aktualisieren" disabled={busy} onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={14} /></button>
        </div>
      </div>
      {adding && <form className="outlook-profile-inline-form" onSubmit={(event) => void addProfile(event)}>
        <label htmlFor="outlook-new-profile-name">Neues Profil</label>
        <input id="outlook-new-profile-name" maxLength={64} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Profilname" disabled={busy} autoFocus required />
        <button type="submit" disabled={busy || !newName.trim()}>Profil erstellen</button>
        <button type="button" disabled={busy} onClick={() => setAdding(false)}>Abbrechen</button>
      </form>}
      {removing && catalog && <div className="outlook-profile-remove-confirmation" role="group" aria-label="Profilentfernung bestätigen">
        <strong>Profil „{selected}“ entfernen?</strong>
        <p>Kontoeinstellungen und Offline-Cache können entfernt werden. PST-Dateien und Daten auf dem Mailserver bleiben erhalten. Noch nicht synchronisierte lokale Daten vorher sichern.</p>
        {selected === catalog.defaultProfile && catalog.profiles.length > 1 && <label>Neues Standardprofil <select aria-label="Neues Standardprofil" value={replacement} onChange={(event) => setReplacement(event.target.value)} disabled={busy}>
          <option value="">Bitte auswählen …</option>{catalog.profiles.filter((profile) => profile.name !== selected).map((profile) => <option key={profile.name} value={profile.name}>{profile.name}</option>)}
        </select></label>}
        {catalog.profiles.length === 1 && <p>Danach ist kein Outlook-Profil mehr eingerichtet.</p>}
        {catalog.activeProfile && <p>Bitte Outlook vor dem Entfernen vollständig schließen und die Liste aktualisieren.</p>}
        <div className="outlook-profile-buttons">
          <button className="danger-button" type="button" disabled={busy || Boolean(catalog.activeProfile) || (selected === catalog.defaultProfile && catalog.profiles.length > 1 && !replacement)} onClick={() => void confirmRemoval()}>Profil endgültig entfernen</button>
          <button type="button" disabled={busy} onClick={() => setRemoving(false)}>Abbrechen</button>
        </div>
      </div>}
      {error && !showProperties && <p role="alert">{error}</p>}
      {message && !showProperties && <p role="status">{message}</p>}
      {loading && !catalog && <p>Profile werden gelesen …</p>}
      {catalog && <>
        {showProperties && detail && <OutlookProfilePropertiesDialog profile={detail} isDefault={detail.name === catalog.defaultProfile} busy={busy} error={error} message={message} onClose={() => setShowProperties(false)} onOpen={() => void openSelected()} onSetDefault={() => void save(detail.name)} />}
        <fieldset className="outlook-profile-startup">
          <legend>Outlook-Start</legend>
          <label htmlFor="outlook-startup-profile">Standardprofil</label>
          <div>
            <select id="outlook-startup-profile" value={startupProfile} disabled={busy || m365SafeImportTestMode || !catalog.profiles.length} onChange={(event) => setStartupProfile(event.target.value)}>
              {!startupProfile && <option value="">Nicht festgelegt</option>}
              {catalog.profiles.map((profile) => <option key={profile.name} value={profile.name}>{profile.name}</option>)}
            </select>
            <button type="button" disabled={busy || m365SafeImportTestMode || !startupProfile || startupProfile === catalog.defaultProfile} onClick={() => void save()}>{saving ? "Wird gespeichert …" : "Übernehmen"}</button>
          </div>
          {catalog.promptForProfile && <small>Die Profilauswahl beim Outlook-Start ist aktiviert.</small>}
        </fieldset>
      </>}
    </section>
  );
}
