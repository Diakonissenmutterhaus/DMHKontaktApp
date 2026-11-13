import { Channel, invoke } from "@tauri-apps/api/core";

export interface AppUpdatePolicy { canSelfUpdate: boolean; reason: string }
export type AppUpdateEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Installing" };

export const getAppUpdatePolicy = () => invoke<AppUpdatePolicy>("get_app_update_policy");

export function installAppUpdate(rid: number, onEvent: (event: AppUpdateEvent) => void): Promise<void> {
  const channel = new Channel<AppUpdateEvent>();
  channel.onmessage = onEvent;
  return invoke("install_app_update", { rid, onEvent: channel });
}
