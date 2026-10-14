// Email markup never enters the live document: no scripts, links or trackers.
export function emailHtmlAsText(html: string): string {
  const template = document.createElement("template"); template.innerHTML = html;
  template.content.querySelectorAll("script,style,iframe,object,embed,link,meta,head,noscript").forEach(node => node.remove());
  template.content.querySelectorAll("br,p,div,li,tr,h1,h2,h3,h4,blockquote").forEach(node => node.appendChild(document.createTextNode("\n")));
  return (template.content.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}
export function emailDateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Datum nicht verfügbar" : date.toLocaleString("de-DE", { dateStyle:"short",timeStyle:"short" });
}
