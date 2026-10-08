const video = document.getElementById("anleitungs-video");
const hint = document.getElementById("video-hinweis");
const playButton = document.getElementById("video-play");
const configuredUrl = window.DMH_BACKUP_VIDEO_URL?.trim();
const downloadButton = document.getElementById("download-button");
const downloadVersion = document.getElementById("download-version");
const officialReleaseApi = "https://api.github.com/repos/Diakonissenmutterhaus/DMHKontaktApp/releases/latest";
const moreHelpButton = document.getElementById("more-help-button");
const moreHelpPanel = document.getElementById("more-help-panel");
const moreHelpClose = document.getElementById("more-help-close");

function openMoreHelp() {
  if (!moreHelpPanel || !moreHelpButton) return;
  moreHelpPanel.hidden = false;
  moreHelpButton.setAttribute("aria-expanded", "true");
  document.body.classList.add("help-panel-open");
  moreHelpClose?.focus();
}

function closeMoreHelp() {
  if (!moreHelpPanel || !moreHelpButton) return;
  moreHelpPanel.hidden = true;
  moreHelpButton.setAttribute("aria-expanded", "false");
  document.body.classList.remove("help-panel-open");
  moreHelpButton.focus();
}

moreHelpButton?.addEventListener("click", openMoreHelp);
moreHelpClose?.addEventListener("click", closeMoreHelp);
moreHelpPanel?.addEventListener("click", (event) => {
  if (event.target === moreHelpPanel) closeMoreHelp();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && moreHelpPanel && !moreHelpPanel.hidden) closeMoreHelp();
});

async function resolveOfficialDownload() {
  if (!downloadButton) return;
  try {
    const response = await fetch(officialReleaseApi, {
      headers: { Accept: "application/vnd.github+json" }
    });
    if (!response.ok) throw new Error(`GitHub respondeu com ${response.status}`);
    const release = await response.json();
    const tag = typeof release.tag_name === "string" ? release.tag_name.trim() : "";
    if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(tag)) {
      throw new Error("A versão mais recente não é uma publicação oficial estável.");
    }
    const version = tag.slice(1);
    const expectedInstaller = `DMH.Backup_${version}_x64-setup.exe`.toLowerCase();
    const installer = Array.isArray(release.assets)
      ? release.assets.find((asset) => asset?.name?.toLowerCase() === expectedInstaller)
      : null;
    if (!installer?.browser_download_url) {
      throw new Error("O instalador oficial não está disponível nesta publicação.");
    }
    downloadButton.href = installer.browser_download_url;
    downloadButton.dataset.ready = "true";
    downloadButton.title = `DMH Backup ${tag} herunterladen`;
    downloadButton.setAttribute("aria-label", `DMH Backup ${tag}, neueste offizielle Version, herunterladen`);
    if (downloadVersion) downloadVersion.textContent = `${tag} · Offizielle Version`;
  } catch (error) {
    // Der Link zur offiziellen Latest-Seite bleibt als sichere Alternative aktiv.
    console.warn("Der direkte Download konnte nicht aufgelöst werden:", error);
  }
}

void resolveOfficialDownload();

if (video && hint) {
  playButton?.addEventListener("click", () => {
    void video.play().catch(() => {
      // Die Videosteuerung bleibt verfügbar, falls der Browser das Abspielen blockiert.
    });
  });

  video.addEventListener("play", () => video.parentElement?.classList.add("is-playing"));
  video.addEventListener("pause", () => video.parentElement?.classList.remove("is-playing"));
  video.addEventListener("ended", () => video.parentElement?.classList.remove("is-playing"));

  if (configuredUrl) {
    const source = video.querySelector("source");
    if (source) {
      source.src = configuredUrl;
      video.load();
    }
  }

  video.addEventListener("error", () => { hint.hidden = false; });
  video.querySelector("source")?.addEventListener("error", () => { hint.hidden = false; });
  video.addEventListener("loadedmetadata", () => { hint.hidden = true; });
}
