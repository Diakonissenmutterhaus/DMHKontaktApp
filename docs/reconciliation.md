# Kontakte / Kalender prüfen und aktualisieren

Access: Kontakte → Weitere Optionen, or Kalender → Weitere Kalenderaktionen →
**Prüfen und aktualisieren**. Sources: Outlook Classic and local Thunderbird.
This is a separate re-import mode; it does not run automatically at startup.

The native preview reads the source and SQLite destination, including deleted
items. It writes only a temporary plan, never contact/calendar records. The table
shows field differences, protected items and pending review, with 50 rows per page.
Updates with an established baseline are selected initially. Newly discovered
items require explicit selection. Closing the dialog does not apply the plan.

On confirmation, the source is read again. Changed or partially unreadable sources
invalidate the preview. An immediate SQLite transaction verifies destination,
deletion markers, sync links/outbox and previous baseline before applying anything.
Only selected rows are written, using the existing destination IDs. Before/after
values, baseline and sync-outbox entries commit atomically. A consumed/expired
plan cannot be replayed. The page then reloads, without saving its full event list.

## Rules

- Same values: no write. An exact verified pair can establish a baseline.
- Only source fields changed since that baseline: update those fields, preserving
  other local edits, including intentionally cleared values.
- Both sides changed the same field: keep current data and request review.
- Calendar start/end, all-day and recurrence changes are treated together to avoid
  constructing an invalid schedule from two independently edited versions.
- Existing birthdays are never overwritten. Earlier birthday recovery remains
  available independently of this mode.
- Deleted records stay deleted, including when the source ID changed but another
  identity matches. Purging the trash retains a native identity tombstone.
- A source item missing from the destination without reliable history is **Prüfen**,
  not automatically new. Old imports cannot retrospectively provide that history.
- Similar or ambiguous people/events, multiple source IDs for one target and
  duplicate incoming IDs are protected from automatic merging/insertion.
- New source items are offered only after an earlier observation of the same
  source, with no local identity collision. They are not preselected.
- Missing items in the source do not delete items in the app.
- Exchange-linked records and pending sync writes are protected from re-import
  updates: this mode does not claim to have validated live Graph contents or use an
  old Outlook copy to overwrite Exchange. They remain for EDV review.

Baseline and tombstones persist in SQLite. Baselines cannot be reconstructed for
records already purged before this feature; those remain conservative review cases.
Normal file import and first-import flows retain their existing behavior; use this
explicit mode for a later comparison.

## Verification

Rust tests use in-memory SQLite databases, not actual Outlook/Exchange data.
They cover tombstones, field clearing, conflicting changes, birthdays, calendar
exceptions, duplicate identities, stale previews, rollback, idempotency and outbox
protection. React tests use mocked native commands; a browser flow checks preview,
confirmation and that refreshing the calendar does not save the full list again.
