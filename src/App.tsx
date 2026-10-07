import { LoaderCircle, RefreshCw } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { EdvAccessDialog } from "./components/EdvAccessDialog";
import { Sidebar, type Page } from "./components/Sidebar";
import { SettingsSubtabs, type SettingsSection } from "./components/SettingsSubtabs";
import { ContactsPage } from "./pages/ContactsPage";
import { CalendarPage } from "./pages/CalendarPage";
import { TrashPage } from "./pages/TrashPage";
import { UpdateNotifier } from "./components/UpdateNotifier";
import { ActivityCenter } from "./components/ActivityCenter";
import { SettingsPage } from "./pages/SettingsPage";
import { PasswordsPage } from "./pages/PasswordsPage";
import { AuthenticatorPage } from "./pages/AuthenticatorPage";
import { BackupPage } from "./pages/BackupPage";
import { Microsoft365Page } from "./pages/Microsoft365Page";
import { SynchronizationsPage } from "./pages/SynchronizationsPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { FeatureDevelopmentPage } from "./pages/FeatureDevelopmentPage";
import { RecoveryPage } from "./pages/RecoveryPage";
import { WelcomePage } from "./pages/WelcomePage";
import { createAutomaticSafetyBackup, getMicrosoft365ConnectionStatus, getVaultStatus, syncOfflineDocuments } from "./services/db";
import type { VaultStatus } from "./types/vault";
import { captureBrowserStorage } from "./utils/backup";
import {
  clearFeatureOverrides,
  readFeatureAvailability,
  setFeatureOverride,
  type AppFeature
} from "./utils/featureFlags";
import {
  calendarAutomaticSyncStatusEventName,
  calendarChangedEventName,
  calendarStorageUpdatedEventName,
  contactChangedEventName,
  describeMicrosoft365SyncFailure,
  m365DataUpdatedEventName,
  m365SafeImportTestMode,
  recordMicrosoft365SynchronizationError,
  runAutomaticCalendarSync as performAutomaticCalendarSync,
  type AutomaticSyncTrigger,
  type CalendarAutomaticSyncStatus
} from "./utils/automaticCalendarSync";
import { enableCompleteAutomaticMicrosoft365Sync } from "./utils/microsoft365SyncConfig";
import { dataSectionVisibilityChangedEventName, readHiddenDataSections, type DataSection } from "./utils/dataSectionVisibility";
import { readActivityCenterEnabled, saveActivityCenterEnabled } from "./utils/settings";

const DataTransferPage = lazy(() =>
  import("./pages/DataTransferPage").then((module) => ({ default: module.DataTransferPage }))
);

const browserPreviewStatus: VaultStatus = {
  protectionEnabled: false,
  unlocked: true,
  username: "",
  recoveryEmail: "",
  recoveryEmailHint: "",
  recoveryAvailable: false,
  entryCount: 0
};

const edvPages = new Set<Page>(["settings", "feature-development", "backup", "synchronizations", "m365", "recovery"]);
const advancedCalendarStorageKey = "dmh.calendar.advanced.v1";
type NavigationBlocker = (continueNavigation: () => void) => boolean;

function readAdvancedCalendarPreference(): boolean {
  return localStorage.getItem(advancedCalendarStorageKey) === "true";
}

export default function App() {
  const isAdminTest = import.meta.env.VITE_APP_CHANNEL === "admin-test";
  const sourceCommit = import.meta.env.VITE_SOURCE_COMMIT?.slice(0, 8);
  const [hiddenDataSections, setHiddenDataSections] = useState<DataSection[]>(readHiddenDataSections);
  const [page, setPage] = useState<Page>("welcome");
  const [advancedCalendar, setAdvancedCalendar] = useState(readAdvancedCalendarPreference);
  const [activityCenterEnabled, setActivityCenterEnabled] = useState(readActivityCenterEnabled);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [featureAvailability, setFeatureAvailability] = useState(readFeatureAvailability);
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  const [startupError, setStartupError] = useState("");
  const [edvUnlocked, setEdvUnlocked] = useState(false);
  const [pendingEdvNavigation, setPendingEdvNavigation] = useState<{ page: Page; section?: SettingsSection } | null>(null);
  const safetyBackupPromise = useRef<Promise<void> | null>(null);
  const backupDirty = useRef(true);
  const backupGeneration = useRef(0);
  const documentSyncPromise = useRef<Promise<void> | null>(null);
  const calendarSyncPromise = useRef<Promise<"success" | "error" | "skipped"> | null>(null);
  const queuedCalendarSyncTriggers = useRef(new Set<AutomaticSyncTrigger>());
  const navigationBlockerRef = useRef<NavigationBlocker | null>(null);
  const closing = useRef(false);
  const settingsAreaOpen = page === "settings" || page === "feature-development" || page === "backup" || page === "synchronizations" || page === "m365" || page === "recovery";
  const compactSidebar = settingsAreaOpen || (page === "calendar" && advancedCalendar);

  const changeAdvancedCalendar = (enabled: boolean) => {
    localStorage.setItem(advancedCalendarStorageKey, String(enabled));
    setAdvancedCalendar(enabled);
  };

  const changeActivityCenter = (enabled: boolean) => {
    saveActivityCenterEnabled(enabled);
    setActivityCenterEnabled(enabled);
  };

  useEffect(() => {
    const updateDataSectionVisibility = () => setHiddenDataSections(readHiddenDataSections());
    window.addEventListener(dataSectionVisibilityChangedEventName, updateDataSectionVisibility);
    return () => window.removeEventListener(dataSectionVisibilityChangedEventName, updateDataSectionVisibility);
  }, []);

  const applyNavigation = (nextPage: Page, nextSection?: SettingsSection) => {
    if (nextPage === "services") return;
    if (nextPage === "contacts" && hiddenDataSections.includes("contacts")) return;
    if (nextPage === "calendar" && hiddenDataSections.includes("calendar")) return;
    if (nextPage === "authenticator" && !featureAvailability.authenticator) return;
    if (nextPage === "passwords" && !featureAvailability.passwords) return;
    if (nextPage === "documents" && !featureAvailability.documents) return;
    if (!edvPages.has(nextPage)) setEdvUnlocked(false);
    setPage(nextPage);
    if (nextSection) {
      setSettingsSection(nextSection);
      return;
    }
    if (nextPage === "settings") setSettingsSection("general");
    else if (nextPage === "simple-import") setSettingsSection("import");
    else if (nextPage === "backup") setSettingsSection("backup");
    else if (nextPage === "synchronizations" || nextPage === "m365") setSettingsSection("sync");
    else if (nextPage === "recovery") setSettingsSection("recovery");
    else if (nextPage === "trash") setSettingsSection("trash");
    else if (nextPage === "import" || nextPage === "export" || nextPage === "feature-development") setSettingsSection("advanced");
  };

  const registerNavigationBlocker = useCallback((blocker: NavigationBlocker | null) => {
    navigationBlockerRef.current = blocker;
  }, []);

  const navigate = (nextPage: Page, nextSection?: SettingsSection) => {
    const continueNavigation = () => {
      if (edvPages.has(nextPage) && !edvUnlocked) {
        setPendingEdvNavigation({ page: nextPage, section: nextSection });
        return;
      }
      applyNavigation(nextPage, nextSection);
    };
    if (page === "contacts" && nextPage !== "contacts" && navigationBlockerRef.current?.(continueNavigation)) return;
    continueNavigation();
  };

  const unlockEdvTools = () => {
    const destination = pendingEdvNavigation ?? { page: "settings" as Page, section: "general" as SettingsSection };
    setEdvUnlocked(true);
    setPendingEdvNavigation(null);
    applyNavigation(destination.page, destination.section);
  };

  const changeFeatureAvailability = (feature: AppFeature, enabled: boolean) => {
    setFeatureAvailability(setFeatureOverride(feature, enabled));
  };

  const runSafetyBackup = useCallback(async (snapshot = false): Promise<void> => {
    const isTauri = "__TAURI_INTERNALS__" in window;
    if (!isTauri) return;
    if (safetyBackupPromise.current) {
      await safetyBackupPromise.current;
      if (!snapshot) return;
    }
    if (!snapshot && !backupDirty.current) return;

    const generation = backupGeneration.current;
    const promise = createAutomaticSafetyBackup(snapshot, captureBrowserStorage());
    safetyBackupPromise.current = promise;
    try {
      await promise;
      if (backupGeneration.current === generation) backupDirty.current = false;
    } finally {
      if (safetyBackupPromise.current === promise) safetyBackupPromise.current = null;
    }
  }, []);

  const runDocumentSync = useCallback(async (): Promise<void> => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    if (m365SafeImportTestMode) return;
    if (documentSyncPromise.current) return documentSyncPromise.current;
    const promise = syncOfflineDocuments().then(() => undefined);
    documentSyncPromise.current = promise;
    try { await promise; }
    finally { if (documentSyncPromise.current === promise) documentSyncPromise.current = null; }
  }, []);

  const runCalendarSync = useCallback(async (trigger: AutomaticSyncTrigger): Promise<"success" | "error" | "skipped"> => {
    if (!("__TAURI_INTERNALS__" in window)) return "skipped";
    if (calendarSyncPromise.current) {
      queuedCalendarSyncTriggers.current.add(trigger);
      return calendarSyncPromise.current;
    }
    const promise = (async () => {
      let outcome: "success" | "error" | "skipped" = "skipped";
      let nextTrigger: AutomaticSyncTrigger | undefined = trigger;
      while (nextTrigger) {
        const currentTrigger = nextTrigger;
        try {
          const status = await performAutomaticCalendarSync(currentTrigger);
          if (status) {
            outcome = status.state;
            // A healthy 25-second poll is silent. Otherwise it would keep
            // replacing the calendar's useful message with "already synced".
            if (currentTrigger !== "calendar-poll" || status.state !== "success"
              || status.message !== "Microsoft 365 ist bereits synchron.") {
              window.dispatchEvent(new CustomEvent<CalendarAutomaticSyncStatus>(calendarAutomaticSyncStatusEventName, { detail: status }));
            }
          }
        } catch (error) {
          outcome = "error";
          await recordMicrosoft365SynchronizationError(error).catch(() => undefined);
          window.dispatchEvent(new CustomEvent<CalendarAutomaticSyncStatus>(calendarAutomaticSyncStatusEventName, {
            detail: {
              state: "error",
              message: describeMicrosoft365SyncFailure(1, [String(error)])
            }
          }));
        }
        nextTrigger = (["change", "contact-change", "calendar-poll", "open", "poll"] as AutomaticSyncTrigger[])
          .find((candidate) => queuedCalendarSyncTriggers.current.has(candidate));
        if (nextTrigger) queuedCalendarSyncTriggers.current.delete(nextTrigger);
      }
      return outcome;
    })();
    calendarSyncPromise.current = promise;
    try {
      return await promise;
    } finally {
      if (calendarSyncPromise.current === promise) calendarSyncPromise.current = null;
    }
  }, []);

  const loadVaultStatus = () => {
    setStartupError("");
    const localBrowserPreview = !("__TAURI_INTERNALS__" in window)
      && (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost");
    if (localBrowserPreview) {
      setVaultStatus(browserPreviewStatus);
      return;
    }
    getVaultStatus()
      .then(setVaultStatus)
      .catch((error) => setStartupError(String(error)));
  };

  useEffect(() => {
    loadVaultStatus();
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let pollingTimer: number | undefined;
    let disposed = false;
    let failedPollingCycles = 0;

    const clearPollingTimer = () => {
      if (pollingTimer !== undefined) {
        window.clearTimeout(pollingTimer);
        pollingTimer = undefined;
      }
    };
    const nextPollingDelay = () => {
      if (document.hidden) return 10 * 60_000;
      return [2 * 60_000, 3 * 60_000, 5 * 60_000, 10 * 60_000][Math.min(failedPollingCycles, 3)];
    };
    const schedulePolling = () => {
      clearPollingTimer();
      if (disposed) return;
      pollingTimer = window.setTimeout(() => void runScheduledPoll(), nextPollingDelay());
    };
    const runScheduledPoll = async () => {
      const outcome = await runCalendarSync("poll");
      failedPollingCycles = outcome === "error" ? Math.min(failedPollingCycles + 1, 3) : 0;
      schedulePolling();
    };
    // A lightweight calendar-only delta pass keeps changes made in Teams or
    // Exchange responsive without fetching every contact folder every 25 s.
    const calendarPollInterval = window.setInterval(() => {
      void runCalendarSync("calendar-poll");
    }, 25_000);

    void getMicrosoft365ConnectionStatus()
      .then(async (status) => {
        if (status.connected) {
          // A contact-folder problem must not prevent the first calendar read.
          if (!m365SafeImportTestMode) {
            try {
              await enableCompleteAutomaticMicrosoft365Sync(false);
            } catch (error) {
              await recordMicrosoft365SynchronizationError(error).catch(() => undefined);
              window.dispatchEvent(new CustomEvent<CalendarAutomaticSyncStatus>(calendarAutomaticSyncStatusEventName, {
                detail: { state: "error", message: `Microsoft-365-Einrichtung konnte nicht abgeschlossen werden: ${error}` }
              }));
            }
          }
          await runCalendarSync("calendar-poll");
          if (!m365SafeImportTestMode) {
            const outcome = await runCalendarSync("open");
            failedPollingCycles = outcome === "error" ? 1 : 0;
          }
        }
        schedulePolling();
      })
      .catch(() => {
        // A missing or offline Microsoft connection is shown on its own page.
        schedulePolling();
      });

    let debounceTimer: number | undefined;
    let contactDebounceTimer: number | undefined;
    const queueChangedCalendarSync = () => {
      if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => void runCalendarSync("change"), 3_000);
    };
    const queueChangedContactSync = () => {
      if (contactDebounceTimer !== undefined) window.clearTimeout(contactDebounceTimer);
      contactDebounceTimer = window.setTimeout(() => void runCalendarSync("contact-change"), 3_000);
    };
    const syncWhenVisible = () => {
      if (document.hidden) {
        schedulePolling();
        return;
      }
      clearPollingTimer();
      void runScheduledPoll();
    };
    window.addEventListener(calendarChangedEventName, queueChangedCalendarSync);
    window.addEventListener(contactChangedEventName, queueChangedContactSync);
    document.addEventListener("visibilitychange", syncWhenVisible);
    return () => {
      window.removeEventListener(calendarChangedEventName, queueChangedCalendarSync);
      window.removeEventListener(contactChangedEventName, queueChangedContactSync);
      document.removeEventListener("visibilitychange", syncWhenVisible);
      disposed = true;
      clearPollingTimer();
      window.clearInterval(calendarPollInterval);
      if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
      if (contactDebounceTimer !== undefined) window.clearTimeout(contactDebounceTimer);
    };
  }, [runCalendarSync]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;

    const interval = window.setInterval(() => {
      void runSafetyBackup(true).catch(() => {
        // Backup failures must not interrupt normal contact/calendar work.
      });
    }, 5 * 60_000);
    const documentSyncInterval = window.setInterval(() => {
      void runDocumentSync().catch(() => {
        // Offline changes remain queued and are retried when the connection returns.
      });
    }, 45_000);
    const startupBackupTimer = window.setTimeout(() => {
      void runSafetyBackup(true).catch(() => {
        // The next interval or the close handler will retry automatically.
      });
    }, 8_000);
    void runDocumentSync().catch(() => {
      // A missing connection is expected while the device is offline.
    });

    let backupDebounceTimer: number | undefined;
    const markBackupDirty = () => {
      backupDirty.current = true;
      backupGeneration.current += 1;
      if (backupDebounceTimer !== undefined) window.clearTimeout(backupDebounceTimer);
      // The native history is incremental, so recording a change shortly after
      // it happens is cheap even for very large calendars/address books.
      backupDebounceTimer = window.setTimeout(() => {
        void runSafetyBackup().catch(() => {
          // Keep the dirty flag; the periodic pass will retry.
        });
      }, 3_000);
    };
    window.addEventListener(calendarChangedEventName, markBackupDirty);
    window.addEventListener(contactChangedEventName, markBackupDirty);
    window.addEventListener(calendarStorageUpdatedEventName, markBackupDirty);
    window.addEventListener(m365DataUpdatedEventName, markBackupDirty);
    window.addEventListener(dataSectionVisibilityChangedEventName, markBackupDirty);

    const appWindow = getCurrentWindow();
    const unlisten = appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      if (closing.current) return;
      closing.current = true;
      try {
        await appWindow.hide();
        closing.current = false;
        void Promise.allSettled([
          runCalendarSync("poll"),
          runDocumentSync(),
          runSafetyBackup(true)
        ]);
      } catch (error) {
        closing.current = false;
        window.alert(`Die App konnte nicht im Hintergrund weiterlaufen: ${error}`);
      }
    });

    return () => {
      window.clearInterval(interval);
      window.clearInterval(documentSyncInterval);
      window.clearTimeout(startupBackupTimer);
      if (backupDebounceTimer !== undefined) window.clearTimeout(backupDebounceTimer);
      window.removeEventListener(calendarChangedEventName, markBackupDirty);
      window.removeEventListener(contactChangedEventName, markBackupDirty);
      window.removeEventListener(calendarStorageUpdatedEventName, markBackupDirty);
      window.removeEventListener(m365DataUpdatedEventName, markBackupDirty);
      window.removeEventListener(dataSectionVisibilityChangedEventName, markBackupDirty);
      void unlisten.then((dispose) => dispose());
    };
  }, [runCalendarSync, runDocumentSync, runSafetyBackup]);

  if (!vaultStatus) {
    return (
      <main className="app-startup-screen">
        <img src="/dmh-kontakte-kalender.png" alt="DMH Backup" />
        {startupError ? (
          <>
            <h1>App konnte nicht sicher geöffnet werden</h1>
            <p>{startupError}</p>
            <button className="primary" type="button" onClick={loadVaultStatus}><RefreshCw size={21} /> Erneut versuchen</button>
          </>
        ) : (
          <><LoaderCircle className="spin" size={30} /><p>Lokale Daten werden vorbereitet …</p></>
        )}
      </main>
    );
  }

  return (
    <div className={isAdminTest ? "app-channel-root admin-test-root" : "app-channel-root"}>
      {isAdminTest && (
        <div className="admin-test-banner" role="status">
          ADMIN TEST · Isolierte Testdaten · Keine offizielle Version
          {sourceCommit && <span>Commit {sourceCommit}</span>}
        </div>
      )}
      <div className={`app-shell${settingsAreaOpen ? " settings-app-shell" : ""}${compactSidebar ? " compact-sidebar-shell" : ""}`}>
        <Sidebar
          activePage={page}
          calendarEnabled={!hiddenDataSections.includes("calendar")}
          contactsEnabled={!hiddenDataSections.includes("contacts")}
          authenticatorEnabled={featureAvailability.authenticator}
          compact={compactSidebar}
          documentsEnabled={featureAvailability.documents}
          onNavigate={navigate}
          passwordsEnabled={featureAvailability.passwords}
        />
        {settingsAreaOpen && <SettingsSubtabs activePage={page} activeSection={settingsSection} onNavigate={navigate} />}
        <main className="content">
          {page === "welcome" && <WelcomePage onNavigate={navigate} />}
          {page === "contacts" && !hiddenDataSections.includes("contacts") && (
            <ContactsPage onNavigate={navigate} onRegisterNavigationBlocker={registerNavigationBlocker} />
          )}
          {page === "calendar" && !hiddenDataSections.includes("calendar") && (
            <CalendarPage advancedMode={advancedCalendar} onAdvancedModeChange={changeAdvancedCalendar} onNavigate={navigate} />
          )}
          {page === "documents" && featureAvailability.documents && <DocumentsPage />}
          {page === "passwords" && featureAvailability.passwords && <PasswordsPage status={vaultStatus} onStatusChanged={setVaultStatus} />}
          {page === "authenticator" && featureAvailability.authenticator && <AuthenticatorPage />}
          {page === "feature-development" && (
            <FeatureDevelopmentPage
              availability={featureAvailability}
              onFeatureChange={changeFeatureAvailability}
              onReset={() => setFeatureAvailability(clearFeatureOverrides())}
            />
          )}
          {page === "m365" && <Microsoft365Page />}
          {page === "recovery" && <RecoveryPage />}
          {page === "trash" && <TrashPage />}
          {page === "settings" && (
            <SettingsPage
              activityCenterEnabled={activityCenterEnabled}
              onActivityCenterEnabledChange={changeActivityCenter}
              section={settingsSection}
              onNavigate={navigate}
            />
          )}
          {(page === "simple-import" || page === "import" || page === "contact-import" || page === "calendar-import" || page === "export") && (
            <Suspense fallback={<div className="page-loading"><LoaderCircle className="spin" size={28} /> Datenbereich wird geöffnet …</div>}>
              <DataTransferPage
                initialView={page === "export" ? "export" : page === "import" || page === "contact-import" || page === "calendar-import" ? "file-import" : "overview"}
                initialFileImportMode={page === "contact-import" ? "contacts" : page === "calendar-import" ? "calendar" : undefined}
                onManageSync={() => navigate("synchronizations")}
              />
            </Suspense>
          )}
          {page === "backup" && <BackupPage />}
          {page === "synchronizations" && <SynchronizationsPage onNavigate={navigate} />}
        </main>
        <UpdateNotifier />
        {activityCenterEnabled ? <ActivityCenter /> : null}
      </div>
      {pendingEdvNavigation && <EdvAccessDialog onCancel={() => setPendingEdvNavigation(null)} onUnlocked={unlockEdvTools} />}
    </div>
  );
}
