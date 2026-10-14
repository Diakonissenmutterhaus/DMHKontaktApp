import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ChevronLeft, ChevronRight, Columns2, Download, LoaderCircle, LockKeyhole, Mail, PanelLeftClose, PanelLeftOpen, PanelsTopLeft, Paperclip, RefreshCw, Search, SlidersHorizontal, X, Trash2, Undo2, ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invokeWithDiagnostics as invoke } from "../utils/notificationPolicy";
import type { ArchivedEmail, EmailArchiveFolder, EmailArchivePage, EmailArchiveQuery, EmailArchiveSort, EmailCopyResult, EmailCopyStatus, EmailRemovalPreview, EmailFolderPreferences, EmailArchiveCategory, EmailMessageEdit, LocalEmailScan } from "../types/emailArchive";
import { EmailFolderTree } from "../components/EmailFolderTree";
import { EmailArchiveReader } from "../components/EmailArchiveReader";
import { EmailMessageActions, type EmailMessageContext } from "../components/EmailMessageActions";
import { buildEmailFolderTree, type EmailFolderNode } from "../utils/emailFolderTree";
import { emailDateBounds, emailDatePreset, type EmailDatePreset } from "../utils/emailArchiveFilters";
import "./EmailSavePage.css";

export { emailHtmlAsText } from '../utils/emailContent';
import { emailDateLabel as dateLabel } from '../utils/emailContent';

export function EmailSavePage() {
  const [tab, setTab] = useState<"import" | "read">(() => {
    try { return localStorage.getItem("dmh-email-archive-tab") === "read" ? "read" : "import"; } catch { return "import"; }
  });
  const [readerLayout, setReaderLayout] = useState<"bottom" | "right">("bottom");
  const [foldersVisible, setFoldersVisible] = useState(true);
  const [readerExpanded, setReaderExpanded] = useState(false);
  const [messageContext, setMessageContext] = useState<EmailMessageContext | null>(null);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [emailCategories, setEmailCategories] = useState<EmailArchiveCategory[]>([]);
  const [scan, setScan] = useState<LocalEmailScan>({ sources: [], issues: [] });
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(true);
  const [copying, setCopying] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<EmailCopyResult | null>(null);
  const [folders, setFolders] = useState<EmailArchiveFolder[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<EmailArchiveSort>("newest");
  const [searchScope, setSearchScope] = useState<"folder" | "all">("folder");
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [datePreset, setDatePreset] = useState<EmailDatePreset>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [attachmentsOnly, setAttachmentsOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [emails, setEmails] = useState<EmailArchivePage>({ items: [], total: 0 });
  const [listing, setListing] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [email, setEmail] = useState<ArchivedEmail | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [removalPreview, setRemovalPreview] = useState<EmailRemovalPreview | null>(null);
  const [managingArchive, setManagingArchive] = useState(false);
  const [removedCount, setRemovedCount] = useState(0);
  const [folderPreferences, setFolderPreferences] = useState<EmailFolderPreferences>({});
  const [orderingFolders, setOrderingFolders] = useState(false);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const removalDialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const firstScan = useRef(true);
  const scanRequest = useRef(0);
  const latestCompletion = useRef("");
  const copyPending = useRef(false);
  const dateBounds = emailDateBounds(fromDate, toDate);
  const queryFolderId = searchScope === "all" ? null : folderId;
  const extraFilterCount = Number(!!fromDate || !!toDate) + Number(attachmentsOnly);
  const hasFilters = !!search || !!categoryFilter || extraFilterCount > 0 || sort !== "newest" || searchScope !== "folder";
  const resetMessageList = () => { setOffset(0); setSelectedId(null); };
  const changeSort = (next: EmailArchiveSort) => { setSort(next); setOffset(0); };
  const selectedOnPage = emails.items.some(item => item.id === selectedId);
  const sortHeader = (label: string, ascending: EmailArchiveSort, descending: EmailArchiveSort, alpha = true) => {
    const active = sort === ascending || sort === descending;
    const isAscending = sort === ascending;
    const next = active ? (isAscending ? descending : ascending) : alpha ? ascending : descending;
    const order = alpha ? (isAscending ? "A–Z" : "Z–A") : (isAscending ? "Älteste zuerst" : "Neueste zuerst");
    const nextOrder = alpha ? (next === ascending ? "A–Z" : "Z–A") : (next === ascending ? "Älteste zuerst" : "Neueste zuerst");
    return <button type="button" aria-label={`Nach ${label} sortieren`} aria-pressed={active} title={`${active ? `Aktuell: ${order}. ` : ""}${nextOrder}`} onClick={() => changeSort(next)}><span>{label}</span>{active ? isAscending ? <ArrowUp size={13} aria-label={order} /> : <ArrowDown size={13} aria-label={order} /> : <ArrowUpDown size={13} aria-hidden="true" />}</button>;
  };

  const refreshSources = async () => {
    const request = ++scanRequest.current;
    setScanning(true);
    try {
      const next = await invoke<LocalEmailScan>("scan_local_email_sources");
      if (!mounted.current || request !== scanRequest.current) return;
      setScan(next);
      setRevision(current => current + 1);
      const selectAll = firstScan.current;
      setSelectedSources(current => new Set(next.sources.filter(source => selectAll || current.has(source.id)).map(source => source.id)));
      firstScan.current = false;
    } catch { if (mounted.current && request === scanRequest.current) setError("E-Mail-Quellen konnten nicht geprüft werden. Bitte Outlook Classic öffnen und erneut prüfen."); }
    finally { if (mounted.current && request === scanRequest.current) setScanning(false); }
  };

  useEffect(() => {
    mounted.current = true;
    void refreshSources();
    let dispose: (() => void) | undefined;
    void listen<string>("local-email-copy-progress", event => { if (mounted.current) setProgress(event.payload); })
      .then(unlisten => { if (mounted.current) dispose = unlisten; else unlisten(); }).catch(() => undefined);
    return () => { mounted.current = false; dispose?.(); };
  }, []);

  useEffect(() => {
    let active = true;
    const checkStatus = async () => {
      try {
        const status = await invoke<EmailCopyStatus | null>("get_local_email_copy_status");
        if (!active || !status) return;
        setCopying(status.running || copyPending.current);
        if (status.running) setProgress(status.progress);
        if (status.result && status.result.completedAt !== latestCompletion.current) {
          latestCompletion.current = status.result.completedAt;
          setResult(status.result); setRevision(current => current + 1);
        }
        if (status.failed && !copyPending.current) setError("Die letzte E-Mail-Kopie wurde nicht vollständig erstellt. Bitte die Quellen prüfen und erneut kopieren. Vorhandene Archivkopien bleiben erhalten.");
      } catch { /* The existing archive remains readable if status is temporarily unavailable. */ }
    };
    void checkStatus();
    const timer = window.setInterval(() => void checkStatus(), 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let active = true;
    void invoke<EmailArchiveFolder[]>("list_email_archive_folders")
      .then(next => { if (active) setFolders(next); })
      .catch(() => { if (active) setError("Das lokale E-Mail-Archiv konnte nicht geöffnet werden. Bitte die EDV um Prüfung bitten."); });
    return () => { active = false; };
  }, [revision]);

  useEffect(() => {
    let active = true;
    void invoke<number>("count_email_archive_removals").then(count => { if (active) setRemovedCount(typeof count === "number" ? count : 0); }).catch(() => undefined);
    return () => { active = false; };
  }, [revision]);

  useEffect(() => {
    if (removalPreview && removalDialog.current && !removalDialog.current.open) removalDialog.current.showModal();
  }, [removalPreview]);
  useEffect(() => {
    let active=true; void invoke<EmailArchiveCategory[]>("list_email_archive_categories").then(items => { if (active) setEmailCategories(Array.isArray(items) ? items : []); }).catch(() => undefined);
    return () => { active=false; };
  },[revision]);
  useEffect(() => { setMessageContext(null); },[folderId,search,sort,revision,includeDeleted,categoryFilter]);
  const messageEdited = (edit:EmailMessageEdit) => {
    if (!mounted.current) return;
    setError(""); setMessageContext(null); setOffset(0);
    if (edit.action!=="category") setSelectedId(null);
    setRevision(current => current+1);
  };
  const contextForMessage = (item:ArchivedEmail, trigger:HTMLElement, x?:number, y?:number) => {
    chooseMessage(item.id); const rect=trigger.getBoundingClientRect();
    setMessageContext({ email:item,trigger,x:x ?? rect.left+30,y:y ?? rect.bottom });
  };

  useEffect(() => {
    let active = true;
    void invoke<EmailFolderPreferences>("get_email_archive_folder_preferences")
      .then(next => { if (active) { setFolderPreferences(next && typeof next === "object" && !Array.isArray(next) ? next : {}); setPreferencesLoaded(true); } })
      .catch(() => { if (active) setError("Die persönliche Ordnerreihenfolge konnte nicht geladen werden. Bitte die E-Mail-Seite erneut öffnen."); });
    return () => { active = false; };
  }, []);
  const saveFolderOrder = async (scope: string, keys: string[] | null) => {
    if (orderingFolders || !preferencesLoaded) return false;
    setOrderingFolders(true); setError("");
    try {
      await invoke("set_email_archive_folder_preferences", { scope, keys });
      if (!mounted.current) return false;
      setFolderPreferences(current => { const next = { ...current }; if (keys) next[scope] = keys; else delete next[scope]; return next; });
      return true;
    } catch { if (mounted.current) setError("Die Ordnerreihenfolge konnte nicht gespeichert werden. Bitte erneut versuchen. Die bisherige Reihenfolge bleibt erhalten."); return false; }
    finally { if (mounted.current) setOrderingFolders(false); }
  };

  const requestRemoval = async (node: EmailFolderNode) => {
    if (copying || managingArchive) return;
    setManagingArchive(true); setError("");
    try {
      const preview = await invoke<EmailRemovalPreview>("preview_email_archive_removal", { target:{ source:node.source, sourceId:node.sourceId, path:node.path } });
      if (mounted.current) setRemovalPreview(preview);
    } catch { if (mounted.current) setError("Die Entfernung konnte nicht vorbereitet werden. Bitte eine laufende Kopie abwarten und das Menü erneut öffnen."); }
    finally { if (mounted.current) setManagingArchive(false); }
  };
  const removeFromArchive = async () => {
    if (!removalPreview || managingArchive || copying) return;
    setManagingArchive(true);
    try {
      await invoke("remove_email_archive_folder", { preview:removalPreview });
      if (mounted.current) { setFolderId(null); setSearchScope("folder"); resetMessageList(); setRevision(current => current + 1); }
    } catch { if (mounted.current) setError("Die Archivansicht wurde nicht geändert. Bitte eine laufende Kopie abwarten und die Entfernung über das Menü erneut prüfen und bestätigen."); }
    finally { if (mounted.current) { setManagingArchive(false); setRemovalPreview(null); searchInput.current?.focus(); } }
  };
  const restoreArchiveFolders = async () => {
    if (copying || managingArchive) return;
    setManagingArchive(true); setError("");
    try {
      await invoke("restore_email_archive_folders");
      if (mounted.current) { resetMessageList(); setRevision(current => current + 1); }
    } catch { if (mounted.current) setError("Die entfernten Postfächer konnten nicht wieder angezeigt werden. Bitte eine laufende Kopie abwarten und erneut versuchen."); }
    finally { if (mounted.current) setManagingArchive(false); }
  };

  useEffect(() => {
    if (search === debouncedSearch) return;
    const timer = window.setTimeout(() => { setDebouncedSearch(search); setOffset(0); }, 250);
    return () => window.clearTimeout(timer);
  }, [search, debouncedSearch]);

  useEffect(() => {
    let active = true;
    setListing(true);
    if (!dateBounds.valid) { setEmails({ items: [], total: 0 }); setListing(false); return; }
    const query: EmailArchiveQuery = { folderId: queryFolderId, search: debouncedSearch, offset,
      fromAt: dateBounds.fromAt, beforeAt: dateBounds.beforeAt, attachmentsOnly, sort, includeDeleted, category:categoryFilter || null };
    void invoke<EmailArchivePage>("list_email_archive_messages", { query })
      .then(next => { if (active) setEmails(next); })
      .catch(() => { if (active) { setEmails({ items: [], total: 0 }); setError("Die archivierten Nachrichten konnten nicht geladen werden. Bitte erneut versuchen oder die EDV um Prüfung bitten."); } })
      .finally(() => { if (active) setListing(false); });
    return () => { active = false; };
  }, [queryFolderId, debouncedSearch, offset, revision, dateBounds.fromAt, dateBounds.beforeAt, dateBounds.valid, attachmentsOnly, sort, includeDeleted, categoryFilter]);

  useEffect(() => {
    let active = true;
    setEmail(null);
    if (!selectedId) { setReading(false); return; }
    setReading(true);
    void invoke<ArchivedEmail>("read_email_archive_message", { id: selectedId })
      .then(next => { if (active) setEmail(next); })
      .catch(() => { if (active) setError("Die lokale Nachricht konnte nicht gelesen werden. Bitte die Quelle erneut kopieren oder die EDV um Prüfung bitten."); })
      .finally(() => { if (active) setReading(false); });
    return () => { active = false; };
  }, [selectedId, revision]);

  const copy = async () => {
    if (copying || managingArchive || selectedSources.size === 0) return;
    copyPending.current = true;
    setCopying(true); setResult(null); setError(""); setProgress("");
    try {
      const next = await invoke<EmailCopyResult>("copy_local_emails", { sourceIds: [...selectedSources] });
      if (!mounted.current) return;
      latestCompletion.current = next.completedAt;
      setResult(next); setRevision(current => current + 1);
    } catch {
      if (mounted.current) { setError("Die E-Mail-Kopie konnte nicht vollständig erstellt werden. Bitte Thunderbird schließen, Outlook Classic öffnen und den freien Speicher prüfen. Vorhandene Archivkopien bleiben erhalten."); setRevision(current => current + 1); }
    } finally { copyPending.current = false; if (mounted.current) setCopying(false); }
  };

  const selectFolder = (id: string | null) => { setFolderId(id); setSearchScope("folder"); resetMessageList(); };
  const clearFilters = () => {
    setSearch(""); setDebouncedSearch(""); setSort("newest"); setSearchScope("folder");
    setDatePreset("all"); setFromDate(""); setToDate(""); setAttachmentsOnly(false); resetMessageList();
    setCategoryFilter("");
  };
  const changeDatePreset = (preset: EmailDatePreset) => {
    setDatePreset(preset);
    if (preset !== "custom") { const dates = emailDatePreset(preset); setFromDate(dates.from); setToDate(dates.to); }
    resetMessageList();
  };
  const totalArchived = folders.reduce((sum, folder) => sum + folder.count, 0);
  const selectedFolder = folders.find(folder => folder.id === folderId);
  const archiveTree = useMemo(() => buildEmailFolderTree(folders, folderPreferences), [folders, folderPreferences]);
  const sourceTree = useMemo(() => buildEmailFolderTree([
    ...scan.sources.map(source => ({ id: source.id, sourceId: source.id, name: source.name, path: source.name, source: source.kind, accountKind:source.accountKind })),
    ...(scan.folders ?? [])
  ], folderPreferences), [scan, folderPreferences]);
  const changeTab = (next: "import" | "read") => {
    setTab(next);
    try { localStorage.setItem("dmh-email-archive-tab", next); } catch { /* Navigation still works without storage. */ }
  };
  const chooseMessage = (id: string) => { setSelectedId(id); };
  const selectSource = (id: string, checked: boolean) => setSelectedSources(current => {
    const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next;
  });

  return <div className="page email-save-page">
    <header className="page-header"><div><h2>emails speichern</h2><p>E-Mails und Ordner lokal kopieren und im Archiv lesen.</p></div><span className="email-archive-readonly"><LockKeyhole size={17} /> Nur Lesen</span></header>
    <div className="email-archive-tabs" role="tablist" aria-label="E-Mail-Archiv Bereiche">
      <button type="button" role="tab" id="email-import-tab" aria-controls="email-import-panel" aria-selected={tab === "import"} tabIndex={tab === "import" ? 0 : -1} onClick={() => changeTab("import")} onKeyDown={event => { if (["ArrowRight", "End"].includes(event.key)) { event.preventDefault(); changeTab("read"); document.getElementById("email-read-tab")?.focus(); } }}><Download size={17} /> Importieren</button>
      <button type="button" role="tab" id="email-read-tab" aria-controls="email-read-panel" aria-selected={tab === "read"} tabIndex={tab === "read" ? 0 : -1} onClick={() => changeTab("read")} onKeyDown={event => { if (["ArrowLeft", "Home"].includes(event.key)) { event.preventDefault(); changeTab("import"); document.getElementById("email-import-tab")?.focus(); } }}><Mail size={17} /> E-Mails lesen <span>{totalArchived}</span></button>
      {copying && <span className="email-copy-tab-status" role="status"><LoaderCircle className="spin" size={15} /> Kopie läuft · {progress || "Wird vorbereitet …"}</span>}
    </div>
    {error && <p className="field-error email-archive-error" role="alert">{error}</p>}
    <section id="email-import-panel" role="tabpanel" aria-labelledby="email-import-tab" hidden={tab !== "import"} className="email-tab-panel email-import-panel">
      <section className="email-import-tree-panel" aria-label="Lokale E-Mail-Quellen">
      <div className="panel-heading"><div><h3>Konten und Ordner</h3><p>Thunderbird und Outlook Classic · Die Auswahl umfasst alle Unterordner.</p></div>
        <button type="button" onClick={() => void refreshSources()} disabled={scanning || copying}><RefreshCw size={17} /> Quellen prüfen</button>
      </div>
      <div className="email-source-selection"><span>{selectedSources.size} von {scan.sources.length} Konten ausgewählt</span><button type="button" disabled={copying || scanning} onClick={() => setSelectedSources(new Set(scan.sources.map(source => source.id)))}>Alle auswählen</button><button type="button" disabled={copying || scanning} onClick={() => setSelectedSources(new Set())}>Auswahl aufheben</button></div>
      {scanning ? <p role="status"><LoaderCircle className="spin" size={18} /> Quellen werden geprüft …</p> : scan.sources.length === 0 ? <p className="email-pane-empty">Keine zugängliche lokale E-Mail-Quelle gefunden. Outlook Classic öffnen und Quellen prüfen.</p> : <EmailFolderTree nodes={sourceTree} label="Quellordner" selectedSources={selectedSources} onSourceChange={selectSource} disabled={copying || orderingFolders || !preferencesLoaded} preferences={folderPreferences} onReorder={saveFolderOrder} />}
      </section>
      <aside className="email-import-summary" aria-label="Kopie und Speicherort">
      <div className="email-import-summary-title"><Archive size={23} /><div><h3>Lokale Sicherung</h3><p>Konten mit allen Unterordnern kopieren.</p></div></div>
      <div className="email-import-stats"><strong>{selectedSources.size}</strong><span>ausgewählte Konten und Profile</span><strong>{totalArchived}</strong><span>bereits archivierte Nachrichten</span></div>
      <div className="email-copy-destination"><h4>Speicherort der Kopie</h4><p>{scan.archivePath || "Lokales App-Archiv · email-archive"}</p><small>Die bestehende Ordnerstruktur und Anhänge bleiben in der Kopie erhalten.</small></div>
      <div className="button-row"><button className="primary" type="button" onClick={() => void copy()} disabled={copying || scanning || selectedSources.size === 0}>{copying ? <LoaderCircle className="spin" size={18} /> : <Archive size={18} />}{copying ? "E-Mails werden kopiert …" : "Alle E-Mails der Auswahl lokal kopieren"}</button>{copying && <span role="status">{progress || "Kopie wird vorbereitet …"}</span>}</div>
      <small>Es werden die bereits auf diesem PC verfügbaren Nachrichten kopiert, einschließlich Ordnerstruktur und Anhängen. Nur auf dem Server vorhandene Nachrichten bitte zuerst im E-Mail-Programm herunterladen.</small>
      {result && <div className="email-copy-result" role="status"><strong>{result.copied} Nachrichten kopiert · {dateLabel(result.completedAt)}</strong>{result.issues.length === 0 ? <p>Die ausgewählten zugänglichen Quellen wurden kopiert.</p> : <details open><summary>Die Kopie ist unvollständig ({result.issues.length} Hinweise)</summary><ul>{result.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></details>}</div>}
      {result && <button type="button" onClick={() => changeTab("read")}><Mail size={16} /> Archivierte E-Mails lesen</button>}
      <details className="email-import-help"><summary>Hinweise zur Vorbereitung</summary><p>Thunderbird vor der Kopie schließen. Für Outlook bitte Outlook Classic mit dem gewünschten Profil öffnen.</p><p>Die Auswahl kopiert immer das gesamte Konto mit allen verfügbaren Unterordnern. Ordnerpfeile ändern nur die Ansicht.</p></details>
      {scan.issues.length > 0 && <details className="email-import-help"><summary>Hinweise zu verfügbaren Quellen ({scan.issues.length})</summary><ul>{scan.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></details>}
      </aside>
    </section>
    <section id="email-read-panel" role="tabpanel" aria-labelledby="email-read-tab" hidden={tab !== "read"} className={`email-tab-panel email-archive-workspace${foldersVisible ? "" : " folders-hidden"}`} aria-label="Lokales E-Mail-Archiv">
      <nav className="email-archive-folders" aria-label="Archivordner" hidden={!foldersVisible}><h3>Lokale Ordner</h3><button type="button" aria-pressed={folderId === null} className={`email-all-messages${folderId === null ? " active" : ""}`} onClick={() => selectFolder(null)}><Mail size={17} /><span>Alle archivierten E-Mails</span><small>{totalArchived}</small></button>
        <EmailFolderTree nodes={archiveTree} label="Archivordnerstruktur" selectedId={folderId} onSelect={selectFolder} onSearch={id => { selectFolder(id); searchInput.current?.focus(); }} onRemove={node => void requestRemoval(node)} disabled={copying || managingArchive || orderingFolders || !preferencesLoaded} preferences={folderPreferences} onReorder={saveFolderOrder} />
        {removedCount > 0 && <button type="button" className="email-restore-folders" disabled={copying || managingArchive} onClick={() => void restoreArchiveFolders()}><Undo2 size={15} /> Entfernte Postfächer/Ordner wiederherstellen ({removedCount})</button>}
      </nav>
      <div className={`email-reader-main ${readerLayout === "right" ? "reader-right" : "reader-bottom"}${readerExpanded && selectedId ? " reader-expanded" : ""}`}>
        <div className="email-reader-controls">
          <header className="email-reader-toolbar">
            <button className="email-small-icon" type="button" aria-label={`Ordnerleiste ${foldersVisible ? "ausblenden" : "einblenden"}`} onClick={() => setFoldersVisible(current => !current)}>{foldersVisible ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</button>
            <strong>{selectedFolder?.name ?? "Alle Nachrichten"}</strong>
            <label className="search-field"><Search size={17} /><input ref={searchInput} type="search" aria-label="Archivierte E-Mails suchen" aria-describedby="email-search-help" placeholder="Betreff, Absender, Empfänger, Anhang" value={search} onChange={event => { setSearch(event.target.value); resetMessageList(); }} /></label>
            <div className="email-layout-controls"><button className="email-small-icon" type="button" aria-label="Lesebereich unten" aria-pressed={readerLayout === "bottom"} title="Lesebereich unten" onClick={() => setReaderLayout("bottom")}><PanelsTopLeft size={18} /></button><button className="email-small-icon" type="button" aria-label="Lesebereich rechts" aria-pressed={readerLayout === "right"} title="Lesebereich rechts" onClick={() => setReaderLayout("right")}><Columns2 size={18} /></button></div>
          </header>
          <div className="email-filter-bar">
            <label>Ansicht <select aria-label="Archivansicht" value={includeDeleted ? "trash" : "archive"} onChange={event => { setIncludeDeleted(event.target.value==="trash"); setFolderId(null); resetMessageList(); }}><option value="archive">Archiv</option><option value="trash">Archiv-Papierkorb</option></select></label>
            <label>Sortieren <select aria-label="E-Mails sortieren" value={sort} onChange={event => changeSort(event.target.value as EmailArchiveSort)}><option value="newest">Neueste zuerst</option><option value="oldest">Älteste zuerst</option><option value="subject">Betreff A–Z</option><option value="subjectDesc">Betreff Z–A</option><option value="sender">Absender A–Z</option><option value="senderDesc">Absender Z–A</option></select></label>
            <label>Suchen in <select aria-label="Suchbereich" value={folderId ? searchScope : "all"} disabled={!folderId} onChange={event => { setSearchScope(event.target.value as "folder" | "all"); resetMessageList(); }}><option value="folder">Aktueller Ordner</option><option value="all">Gesamtes Archiv</option></select></label>
            {emailCategories.length>0 && <label>Kategorie <select aria-label="E-Mails nach Kategorie filtern" value={categoryFilter} onChange={event => { setCategoryFilter(event.target.value); resetMessageList(); }}><option value="">Alle Kategorien</option>{emailCategories.map(category => <option key={category.name} value={category.name}>{category.name}</option>)}</select></label>}
            <button type="button" aria-expanded={filtersVisible} aria-controls="email-date-filters" onClick={() => setFiltersVisible(current => !current)}><SlidersHorizontal size={15} /> Filter{extraFilterCount > 0 && <span className="email-filter-count">{extraFilterCount}</span>}</button>
            {hasFilters && <button type="button" className="email-clear-filters" onClick={clearFilters}><X size={14} /> Zurücksetzen</button>}
          </div>
          {filtersVisible && <div className="email-filter-details" id="email-date-filters">
            <label>Zeitraum <select aria-label="E-Mail-Zeitraum" value={datePreset} onChange={event => changeDatePreset(event.target.value as EmailDatePreset)}><option value="all">Alle Daten</option><option value="today">Heute</option><option value="week">Letzte 7 Tage</option><option value="month">Letzte 30 Tage</option><option value="custom">Eigener Zeitraum</option></select></label>
            <label>Von <input type="date" aria-label="E-Mails ab Datum" value={fromDate} aria-invalid={!dateBounds.valid} onChange={event => { setFromDate(event.target.value); setDatePreset("custom"); resetMessageList(); }} /></label>
            <label>Bis <input type="date" aria-label="E-Mails bis Datum" value={toDate} aria-invalid={!dateBounds.valid} onChange={event => { setToDate(event.target.value); setDatePreset("custom"); resetMessageList(); }} /></label>
            <label className="email-attachments-filter"><input type="checkbox" checked={attachmentsOnly} onChange={event => { setAttachmentsOnly(event.target.checked); resetMessageList(); }} /><Paperclip size={14} /> Nur mit Anhang</label>
          </div>}
          <div className="email-filter-summary"><span role="status">{!dateBounds.valid ? "Bitte einen gültigen Zeitraum wählen: Von darf nicht nach Bis liegen." : listing || search !== debouncedSearch ? "Nachrichten werden gesucht …" : `${emails.total} ${emails.total === 1 ? "Nachricht" : "Nachrichten"} · ${queryFolderId ? selectedFolder?.name ?? "Aktueller Ordner" : "Gesamtes Archiv"}`}</span><small id="email-search-help">Suche in Betreff, Absender, Empfänger, Cc und Anhangnamen.</small></div>
        </div>
      <section className="email-archive-list" hidden={readerExpanded && !!selectedId}>
        <div className="email-message-columns" role="group" aria-label="Nachrichten sortieren">{sortHeader("Betreff", "subject", "subjectDesc")}{sortHeader("Von", "sender", "senderDesc")}{sortHeader("Datum", "oldest", "newest", false)}<span aria-hidden="true" /></div>
        <div className="email-archive-message-list" role="listbox" aria-label="Archivierte Nachrichten" onKeyDown={event => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !emails.items.length) return;
          event.preventDefault(); const current = Math.max(0, emails.items.findIndex(item => item.id === selectedId));
          const next = event.key === "Home" ? 0 : event.key === "End" ? emails.items.length - 1 : Math.max(0, Math.min(emails.items.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
          chooseMessage(emails.items[next].id); event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')[next]?.focus();
        }}>{listing ? <p role="status">Nachrichten werden geladen …</p> : emails.items.length === 0 ? <div className="email-pane-empty"><p>{includeDeleted ? "Keine Nachricht im Archiv-Papierkorb gefunden." : totalArchived === 0 ? "Noch keine E-Mails kopiert." : "Keine Nachricht gefunden."}</p>{!includeDeleted && totalArchived === 0 && <button type="button" onClick={() => changeTab("import")}>E-Mails importieren</button>}</div> : emails.items.map((item, index) => <button type="button" role="option" aria-selected={selectedId === item.id} tabIndex={selectedId === item.id || (!selectedOnPage && index === 0) ? 0 : -1} key={item.id} className={`email-message-row${selectedId === item.id ? " active" : ""}`} onClick={() => chooseMessage(item.id)} onDoubleClick={() => { void invoke("open_email_archive_window", { id:item.id }).catch(() => setError("Das separate Lesefenster konnte nicht geöffnet werden. Bitte erneut versuchen.")); }} onContextMenu={event => { event.preventDefault(); contextForMessage(item,event.currentTarget,event.clientX,event.clientY); }} onKeyDown={event => { if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); contextForMessage(item,event.currentTarget); } }}><strong title={item.subject}>{item.subject || "(Ohne Betreff)"}{item.category && <span className="email-row-category" title={item.category}><i style={{ backgroundColor:item.categoryColor || "#0078d4" }} />{item.category}</span>}</strong><span title={item.sender}>{item.sender || "Absender nicht verfügbar"}</span><small>{dateLabel(item.date)}</small><span className="email-attachment-icon">{item.attachments.length > 0 && <Paperclip size={13} aria-label="Mit Anhang" />}</span></button>)}</div>
        <footer><button className="icon-only" type="button" aria-label="Vorherige Nachrichtenseite" disabled={listing || search !== debouncedSearch || offset === 0} onClick={() => { setOffset(current => Math.max(0, current - 100)); setSelectedId(null); }}><ChevronLeft size={18} /></button><span>{emails.total === 0 ? "0 Nachrichten" : `${offset + 1}–${Math.min(offset + 100, emails.total)} von ${emails.total}`}</span><button className="icon-only" type="button" aria-label="Nächste Nachrichtenseite" disabled={listing || search !== debouncedSearch || offset + 100 >= emails.total} onClick={() => { setOffset(current => current + 100); setSelectedId(null); }}><ChevronRight size={18} /></button></footer>
      </section>
      <EmailArchiveReader email={email} reading={reading} folders={folders} expanded={readerExpanded} onToggleExpand={() => setReaderExpanded(current => !current)} />
      </div>
    </section>
    {removalPreview && <dialog ref={removalDialog} className="email-folder-removal-dialog" aria-labelledby="email-removal-title" onCancel={event => { if (managingArchive) event.preventDefault(); else setRemovalPreview(null); }} onClose={() => { if (!managingArchive) setRemovalPreview(null); }}>
      <h3 id="email-removal-title"><Trash2 size={19} /> Aus Archiv entfernen?</h3>
      <p><strong>{removalPreview.name}</strong> · {removalPreview.folders} Ordner · {removalPreview.messages} Nachrichten</p>
      <p>Dieses Postfach bzw. dieser Ordner mit allen Unterordnern wird aus der Archivansicht entfernt. Ihre Original-E-Mails in Outlook, Thunderbird und Microsoft 365 bleiben erhalten.</p>
      <p>Die lokale Kopie bleibt gespeichert. Über „Entfernte Postfächer/Ordner wiederherstellen“ können Sie sie jederzeit wieder anzeigen.</p>
      <div className="button-row"><button type="button" autoFocus disabled={managingArchive} onClick={() => setRemovalPreview(null)}>Abbrechen</button><button type="button" className="danger-button" disabled={managingArchive || copying} onClick={() => void removeFromArchive()}>{managingArchive ? "Wird entfernt …" : "Aus Archiv entfernen"}</button></div>
    </dialog>}
    <EmailMessageActions context={messageContext} onClose={() => setMessageContext(null)} folders={folders} preferences={folderPreferences} disabled={copying || managingArchive} onEdited={messageEdited} onError={setError} />
  </div>;
}
