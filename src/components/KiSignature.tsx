import { useEffect, useRef, useState, type PointerEvent } from "react";

export type SignatureMethod = "draw" | "typed" | "import";
interface Props { name: string; method: SignatureMethod; onMethodChange: (method: SignatureMethod) => void; value: string; onChange: (value: string) => void; disabled?: boolean }

export function createTypedSignature(name: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = 900; canvas.height = 220;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Die Unterschrift konnte nicht erstellt werden.");
  context.fillStyle = "#ffffff"; context.fillRect(0, 0, 900, 220);
  context.fillStyle = "#202124"; context.font = '48px "Segoe Script", "Brush Script MT", cursive';
  context.fillText(name.trim(), 24, 135, 850);
  return canvas.toDataURL("image/png");
}

export function KiSignature({ name, method, onMethodChange, value, onChange, disabled }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const restoredCanvas = useRef<HTMLCanvasElement | null>(null);
  const stroke = useRef<{ pointer: number; x: number; y: number; moved: boolean } | null>(null);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    if (!value) { canvas.current?.getContext("2d")?.clearRect(0, 0, 900, 220); stroke.current = null; }
    else if (method === "draw" && canvas.current && restoredCanvas.current !== canvas.current) {
      const target = canvas.current; restoredCanvas.current = target;
      let cancelled = false;
      const image = new Image();
      image.onload = () => {
        if (cancelled || stroke.current) return;
        const context = target.getContext("2d");
        context?.clearRect(0, 0, 900, 220);
        context?.drawImage(image, 0, 0);
      };
      image.src = value;
      return () => { cancelled = true; if (restoredCanvas.current === target) restoredCanvas.current = null; };
    }
  }, [value, method]);
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * 900 / bounds.width, y: (event.clientY - bounds.top) * 220 / bounds.height };
  };
  const clear = () => { canvas.current?.getContext("2d")?.clearRect(0, 0, 900, 220); onChange(""); setError(""); };
  const importImage = async (file?: File) => {
    if (!file) return;
    onChange(""); setError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) { setError("Bitte PNG, JPG oder WebP bis 2 MB auswählen."); return; }
    setImporting(true);
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url; await image.decode();
      if (image.width > 12000 || image.height > 12000) throw new Error("image_size");
      const output = document.createElement("canvas"); output.width = 900; output.height = 220;
      const context = output.getContext("2d"); if (!context) throw new Error("canvas");
      context.fillStyle = "#ffffff"; context.fillRect(0, 0, 900, 220);
      const scale = Math.min(850 / image.width, 190 / image.height);
      context.drawImage(image, (900 - image.width * scale) / 2, (220 - image.height * scale) / 2, image.width * scale, image.height * scale);
      onChange(output.toDataURL("image/png"));
    } catch { setError("Die Bilddatei konnte nicht als Unterschrift geladen werden."); }
    finally { URL.revokeObjectURL(url); setImporting(false); }
  };
  return <fieldset className="ki-signature" disabled={disabled || importing}>
    <legend>Unterschrift</legend>
    <div className="ki-choice-buttons" role="group" aria-label="Art der Unterschrift">{([{ value: "typed", label: "Name" }, { value: "draw", label: "Zeichnen" }, { value: "import", label: "Bild" }] as const).map((option) => <button key={option.value} type="button" className={method === option.value ? "active" : ""} aria-pressed={method === option.value} onClick={() => { if (method !== option.value) { clear(); onMethodChange(option.value); } }}>{option.label}</button>)}</div>
    {method === "typed" ? <div className="ki-typed-signature" aria-label="Vorschau der Unterschrift" title="Einfache elektronische Unterschrift">{name || "Vor- und Nachname"}</div> : method === "draw" ? <>
      <canvas ref={canvas} width={900} height={220} aria-label="Unterschrift mit der Maus zeichnen" onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId); stroke.current = { pointer: event.pointerId, ...point(event), moved: false };
      }} onPointerMove={(event) => {
        const previous = stroke.current; if (!previous || previous.pointer !== event.pointerId) return;
        const context = event.currentTarget.getContext("2d"); if (!context) return;
        const next = point(event); context.lineWidth = 3; context.lineCap = "round"; context.strokeStyle = "#202124";
        context.beginPath(); context.moveTo(previous.x, previous.y); context.lineTo(next.x, next.y); context.stroke();
        stroke.current = { pointer: event.pointerId, ...next, moved: true };
      }} onPointerUp={(event) => { if (stroke.current?.pointer === event.pointerId && stroke.current.moved) onChange(event.currentTarget.toDataURL("image/png")); stroke.current = null; }} onPointerCancel={() => { stroke.current = null; }} />
    </> : <label>Bilddatei<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void importImage(event.target.files?.[0])} /></label>}
    {method === "import" && value && <img className="ki-signature-preview" src={value} alt="Importierte Unterschrift" />}
    {method !== "typed" && <button type="button" onClick={clear}>Unterschrift löschen</button>}
    {importing && <p role="status">Bild wird geladen …</p>}{error && <p role="alert">{error}</p>}
  </fieldset>;
}
