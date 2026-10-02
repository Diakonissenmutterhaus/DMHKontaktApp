const video = document.getElementById("anleitungs-video");
const hint = document.getElementById("video-hinweis");
const configuredUrl = window.DMH_BACKUP_VIDEO_URL?.trim();

if (video && hint) {
  document.querySelector('.primary-link[href="#video"]')?.addEventListener("click", () => {
    void video.play().catch(() => {
      // Die Videosteuerung bleibt verfügbar, falls der Browser das Abspielen blockiert.
    });
  });

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
