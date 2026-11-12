const media = window.DMH_MIGRATION_MEDIA || {};
const video = document.getElementById("migration-video");
const pending = document.getElementById("video-pending");
const downloadButton = document.getElementById("migration-download");
async function resolveOfficialDownload() {
  if (!downloadButton) return;
  try {
    const response = await fetch("https://api.github.com/repos/Diakonissenmutterhaus/DMHKontaktApp/releases/latest", { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) return;
    const release = await response.json();
    const tag = typeof release.tag_name === "string" ? release.tag_name : "";
    if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(tag)) return;
    const name = `DMH.Backup_${tag.slice(1)}_x64-setup.exe`;
    const installer = Array.isArray(release.assets) ? release.assets.find(asset => asset.name === name) : null;
    const allowedPrefix = `https://github.com/Diakonissenmutterhaus/DMHKontaktApp/releases/download/${tag}/`;
    if (typeof installer?.browser_download_url !== "string" || !installer.browser_download_url.startsWith(allowedPrefix)) return;
    downloadButton.href = installer.browser_download_url;
    document.getElementById("migration-download-version").textContent = `${tag} · Windows · Offizielle Version`;
  } catch {
    // The official release page remains available as the download fallback.
  }
}
void resolveOfficialDownload();
function localMedia(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try { const url = new URL(value, window.location.href); return url.origin === window.location.origin ? url.href : null; }
  catch { return null; }
}
const videoUrl = localMedia(media.video);
if (videoUrl) {
  video.src = videoUrl;
  const poster = localMedia(media.poster);
  if (poster) video.poster = poster;
  video.hidden = false;
  pending.hidden = true;
  video.addEventListener("error", () => {
    video.hidden = true;
    pending.hidden = false;
    pending.querySelector("span").textContent = "Das Video ist momentan nicht verfügbar. Die schriftliche Anleitung finden Sie darunter.";
  });
}
for (const figure of document.querySelectorAll("[data-capture]")) {
  const source = localMedia(media.captures?.[figure.dataset.capture]);
  if (!source) continue;
  const image = figure.querySelector("img");
  image.addEventListener("error", () => { figure.hidden = true; });
  image.src = source;
  figure.hidden = false;
}
