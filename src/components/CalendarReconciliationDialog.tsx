import { ReconciliationDialog } from "./ReconciliationDialog";
interface Props {
  open: boolean;
  onClose: () => void;
  onChanged: (message: string) => void | Promise<void>;
}
export function CalendarReconciliationDialog({ open, onClose, onChanged }: Props) {
  return <ReconciliationDialog open={open} onClose={onClose} kind="calendar" onChanged={onChanged} />;
}
