const video = document.getElementById("anleitungs-video");
const hint = document.getElementById("video-hinweis");
const configuredUrl = window.DMH_BACKUP_VIDEO_URL?.trim();

if (video && hint) {
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
