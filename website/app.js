const video = document.getElementById("anleitungs-video");
const hint = document.getElementById("video-hinweis");
const playButton = document.getElementById("video-play");
const configuredUrl = window.DMH_BACKUP_VIDEO_URL?.trim();

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
