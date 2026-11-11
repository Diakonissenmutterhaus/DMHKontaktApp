export const outlookProfileChangedEventName = "dmh:outlook-profile-changed";

export interface OutlookProfileRefreshDetail {
  waitUntil: (query: Promise<void>) => void;
}

// Subscribers register their reads synchronously; completion waits for every
// visible profile view, including slower queries, before releasing the modal.
export async function refreshOutlookProfileViews(): Promise<void> {
  const pending: Promise<void>[] = [];
  window.dispatchEvent(new CustomEvent<OutlookProfileRefreshDetail>(outlookProfileChangedEventName, {
    detail: { waitUntil: (query) => { pending.push(query); } }
  }));
  await Promise.allSettled(pending);
}
