import { useDiagnosticMessage } from "../hooks/useDiagnosticMessage";
import { Eye, EyeOff, LockKeyhole, ShieldCheck, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { invokeWithDiagnostics } from "../utils/notificationPolicy";

interface EdvAccessDialogProps {
  onCancel: () => void;
  onUnlocked: () => void;
}

export function EdvAccessDialog({ onCancel, onUnlocked }: EdvAccessDialogProps) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useDiagnosticMessage("EdvAccessDialog:error", "inline");

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!(await invokeWithDiagnostics<boolean>("unlock_edv_tools", { password }))) {
        setError("Das EDV-Kennwort ist nicht korrekt.");
        setPassword("");
        return;
      }
      onUnlocked();
    } catch {
      setError("Der EDV-Zugang konnte nicht geprüft werden. Bitte erneut versuchen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop edv-access-backdrop" role="presentation" onMouseDown={onCancel}>
      <form className="modal-card edv-access-dialog" role="dialog" aria-modal="true" aria-labelledby="edv-access-title" onMouseDown={(event) => event.stopPropagation()} onSubmit={unlock}>
        <header>
          <span className="edv-access-icon"><ShieldCheck size={30} aria-hidden="true" /></span>
          <div>
            <p>Geschützter Bereich</p>
            <h2 id="edv-access-title">EDV Tools</h2>
          </div>
          <button className="icon-only" type="button" onClick={onCancel} aria-label="Schließen"><X size={21} /></button>
        </header>
        <p className="edv-access-notice"><LockKeyhole size={20} /> Der Zugriff ist ausschließlich für die EDV bestimmt.</p>
        <label className="field">
          <span>EDV-Kennwort</span>
          <span className="password-input-wrap">
            <input autoFocus autoComplete="off" type={visible ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} required />
            <button className="icon-only" type="button" onClick={() => setVisible((current) => !current)} aria-label={visible ? "Kennwort verbergen" : "Kennwort anzeigen"}>
              {visible ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </span>
        </label>
        {error && <p className="edv-access-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>Abbrechen</button>
          <button className="primary" type="submit" disabled={busy}><ShieldCheck size={19} /> EDV Tools öffnen</button>
        </div>
      </form>
    </div>
  );
}
