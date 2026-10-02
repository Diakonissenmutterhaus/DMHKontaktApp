from pathlib import Path

from PIL import Image
from reportlab.lib.colors import black, white, HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output" / "pdf" / "DMH_Kurzanleitung_Datensicherung_Mailumzug.pdf"
TMP = ROOT / "tmp" / "pdfs" / "real-screens"
W, H = A4

SCREENSHOTS = {
    "import": Path(r"C:\Users\julius.otto\AppData\Local\Temp\codex-clipboard-9ff1f53f-146c-4594-ae6b-cc919cbb6a2d.png"),
    "contacts": Path(r"C:\Users\julius.otto\AppData\Local\Temp\codex-clipboard-d931056d-a5fa-419b-ab5c-efacb6e5e50e.png"),
    "calendar": Path(r"C:\Users\julius.otto\AppData\Local\Temp\codex-clipboard-1edee459-7889-457c-9afb-986a2dbeb0c2.png"),
}


def register_fonts():
    pdfmetrics.registerFont(TTFont("Arial", r"C:\Windows\Fonts\arial.ttf"))
    pdfmetrics.registerFont(TTFont("Arial-Bold", r"C:\Windows\Fonts\arialbd.ttf"))


def prepare_images():
    TMP.mkdir(parents=True, exist_ok=True)
    prepared = {}
    for name, source in SCREENSHOTS.items():
        # Keep the real application screenshot exactly in its original colours.
        image = Image.open(source).convert("RGB")
        output = TMP / f"{name}.png"
        image.save(output)
        prepared[name] = output
    return prepared


def text(c, x, y, value, size=10, font="Arial", color=black):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawString(x, y, value)


def paragraph(c, x, y, value, width, size=10, leading=14, font="Arial"):
    c.setFont(font, size)
    c.setFillColor(black)
    for line in simpleSplit(value, font, size, width):
        c.drawString(x, y, line)
        y -= leading
    return y


def footer(c, page):
    c.setStrokeColor(HexColor("#999999"))
    c.line(42, 39, W - 42, 39)
    text(c, 42, 24, "DMH Kontakt - Kurzanleitung zum E-Mail-Umzug", 8, color=HexColor("#444444"))
    text(c, W - 63, 24, f"Seite {page}", 8, color=HexColor("#444444"))


def header(c, title, page):
    text(c, 42, H - 49, "DMH Kontakt", 11, "Arial-Bold")
    c.setStrokeColor(black)
    c.setLineWidth(1)
    c.line(42, H - 58, W - 42, H - 58)
    text(c, 42, H - 91, title, 20, "Arial-Bold")
    footer(c, page)


def number(c, x, y, value):
    c.setFillColor(black)
    c.circle(x, y, 12, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont("Arial-Bold", 10)
    c.drawCentredString(x, y - 3.5, str(value))


def step(c, y, n, title, detail):
    number(c, 56, y + 3, n)
    text(c, 78, y + 4, title, 12, "Arial-Bold")
    paragraph(c, 78, y - 15, detail, 440, 10, 14)


def draw_screenshot(c, path, x, y, max_w, max_h):
    image = Image.open(path)
    iw, ih = image.size
    scale = min(max_w / iw, max_h / ih)
    dw, dh = iw * scale, ih * scale
    c.setStrokeColor(black)
    c.setLineWidth(0.8)
    c.rect(x - 2, y - 2, dw + 4, dh + 4, fill=0, stroke=1)
    c.drawImage(ImageReader(image), x, y, width=dw, height=dh, mask="auto")
    return dw, dh


def caption(c, y, value):
    c.setFillColor(HexColor("#EEEEEE"))
    c.rect(42, y - 8, W - 84, 25, fill=1, stroke=0)
    text(c, 51, y, value, 8.5, "Arial-Bold")


def page_one(c):
    header(c, "Sicher durch den E-Mail-Umzug", 1)
    text(c, 42, H - 122, "Bitte einmal vor dem Umzug erledigen.", 13, "Arial-Bold")
    paragraph(c, 42, H - 146, "In etwa einem Monat wird der E-Mail-Server umgestellt. DMH Kontakt hilft dabei, dass Kontakte und vorhandene Kalendertermine nicht verloren gehen.", W - 84, 10.5, 15)

    text(c, 42, H - 208, "So gehen Sie vor", 14, "Arial-Bold")
    step(c, H - 244, 1, "Auf der Startseite: Daten an EDV senden", "Klicken Sie auf den Bereich oder die Schaltfläche \"Daten an EDV senden\". Warten Sie auf die Bestätigung.")
    step(c, H - 330, 2, "Danach: Kontakte öffnen", "Importieren Sie Kontakte aus dem Programm, in dem sie heute gespeichert sind: Outlook oder Thunderbird.")
    step(c, H - 416, 3, "Danach: Kalender öffnen", "Wenn im gleichen Programm Termine vorhanden sind, importieren Sie auch den Kalender.")

    c.setStrokeColor(black)
    c.setLineWidth(1)
    c.rect(42, 169, W - 84, 105, fill=0, stroke=1)
    text(c, 58, 247, "Wichtig", 12, "Arial-Bold")
    paragraph(c, 58, 224, "- Es wird nichts aus Outlook oder Thunderbird gelöscht.\n- Importieren Sie nur aus einer Quelle, damit Kontakte nicht doppelt erscheinen.\n- Der Import ist eine zusätzliche Sicherung für die kontrollierte Umstellung durch die EDV.", W - 116, 10, 15)
    text(c, 42, 127, "Merksatz: Erst an die EDV senden. Danach Kontakte und - falls vorhanden - Kalender importieren.", 10, "Arial-Bold")
    c.showPage()


def page_two(c, imgs):
    header(c, "Kontakte importieren", 2)
    text(c, 42, H - 119, "Wählen Sie die Quelle, in der Ihre Kontakte liegen.", 12, "Arial-Bold")
    paragraph(c, 42, H - 142, "Nach dem Klick auf Kontakte erscheint diese Ansicht, wenn noch keine Kontakte importiert wurden.", W - 84, 10, 14)
    draw_screenshot(c, imgs["import"], 42, 273, W - 84, 282)
    caption(c, 244, "Originalansicht der App: Kontakte importieren")
    step(c, 203, 1, "Einfach importieren wählen", "Klicken Sie auf \"Einfach importieren\". Die App durchsucht Outlook Classic und Thunderbird automatisch.")
    step(c, 132, 2, "Die richtige Quelle bestätigen", "Übernehmen Sie nur die Kontakte aus dem Programm, in dem Sie sie heute verwalten.")
    text(c, 42, 83, "Bitte nicht dieselben Kontakte zweimal importieren.", 10, "Arial-Bold")
    c.showPage()


def page_three(c, imgs):
    header(c, "Nach dem Import prüfen", 3)
    text(c, 42, H - 119, "Die Kontakte erscheinen danach in einer Liste.", 12, "Arial-Bold")
    paragraph(c, 42, H - 142, "Prüfen Sie kurz, ob Namen, E-Mail-Adressen und Telefonnummern sichtbar sind. Die abgebildeten Kontakte sind nur Beispieldaten.", W - 84, 10, 14)
    draw_screenshot(c, imgs["contacts"], 130, 193, 335, 430)
    caption(c, 164, "Originalansicht der App: importierte Kontakte")
    text(c, 42, 128, "Fertig.", 12, "Arial-Bold")
    paragraph(c, 42, 108, "Wenn die Liste gefüllt ist, sind die Kontakte zusätzlich in DMH Kontakt gesichert. Sie müssen den Import nicht noch einmal ausführen.", W - 84, 10, 14)
    c.showPage()


def page_four(c, imgs):
    header(c, "Kalendertermine importieren", 4)
    text(c, 42, H - 119, "Importieren Sie den Kalender nur, wenn dort Termine vorhanden sind.", 12, "Arial-Bold")
    paragraph(c, 42, H - 142, "Nutzen Sie die gleiche Quelle wie bei den Kontakten. Liegen Kontakte und Termine in Outlook, importieren Sie beides aus Outlook. Bei Thunderbird gilt das genauso.", W - 84, 10, 14)
    draw_screenshot(c, imgs["calendar"], 42, 193, W - 84, 392)
    caption(c, 164, "Originalansicht der App: Kalender")
    text(c, 42, 128, "Warum das schützt", 12, "Arial-Bold")
    paragraph(c, 42, 108, "Beim Wechsel des E-Mail-Servers begleitet die EDV die Migration. Durch die vorherige Übernahme in DMH Kontakt gibt es eine zusätzliche, gut prüfbare Sicherung Ihrer Kontakte und Termine.", W - 84, 10, 14)
    c.showPage()


def main():
    register_fonts()
    images = prepare_images()
    c = canvas.Canvas(str(OUT), pagesize=A4, pageCompression=1)
    c.setTitle("DMH Kontakt - Kurzanleitung Datensicherung Mailumzug")
    c.setAuthor("DMH Kontakt")
    page_one(c)
    page_two(c, images)
    page_three(c, images)
    page_four(c, images)
    c.save()


if __name__ == "__main__":
    main()
