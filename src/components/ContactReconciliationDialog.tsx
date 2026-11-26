import { ReconciliationDialog } from "./ReconciliationDialog";
interface Props { open: boolean; onClose: () => void; onChanged: (message: string) => void | Promise<void> }
export function ContactReconciliationDialog(props: Props) {
  return <ReconciliationDialog {...props} kind="contacts" />;
}
