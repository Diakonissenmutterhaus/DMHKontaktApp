-- Server-only reporting database. No browser/app receives a Supabase secret key.
-- Apply to the dedicated dmh-migration project before selecting this provider.
begin;

create table public.dmh_reporting_devices (
  device_id uuid primary key,
  payload jsonb not null,
  constraint dmh_device_identity check (jsonb_typeof(payload) = 'object' and payload ? 'deviceId' and payload->>'deviceId' = device_id::text)
);
create table public.dmh_reporting_events (
  device_id uuid not null,
  attempt_id uuid not null,
  sequence integer not null check (sequence between 0 and 10000),
  event_id uuid not null unique,
  payload jsonb not null,
  primary key (device_id, attempt_id, sequence),
  constraint dmh_event_identity check (
    jsonb_typeof(payload) = 'object'
    and payload ?& array['deviceId', 'attemptId', 'sequence', 'eventId', 'windowsUser', 'procedure', 'occurredAt', 'receivedAt']
    and payload->>'deviceId' = device_id::text
    and payload->>'attemptId' = attempt_id::text
    and payload->>'eventId' = event_id::text
    and payload->>'sequence' = sequence::text
  )
);

alter table public.dmh_reporting_devices enable row level security;
alter table public.dmh_reporting_events enable row level security;
revoke all on public.dmh_reporting_devices, public.dmh_reporting_events from public, anon, authenticated, service_role;
grant select, insert, update on public.dmh_reporting_devices to service_role;
grant select, insert on public.dmh_reporting_events to service_role;

-- The sequence, not reception time, identifies the final state of an attempt.
-- Sort by original occurrence time so an old backfill cannot replace a newer result.
create function public.dmh_reporting_attempts()
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  with latest as (
    select distinct on (e.device_id, e.attempt_id) e.device_id, e.attempt_id, e.payload
    from public.dmh_reporting_events e
    order by e.device_id, e.attempt_id, e.sequence desc
  ), counted as (
    select l.payload || jsonb_build_object('attemptCount', count(*) over (
      partition by l.device_id, l.payload->>'windowsUser', l.payload->>'procedure'
    )) as payload, l.device_id, l.attempt_id
    from latest l
  ), bounded as (
    select c.* from counted c
    order by c.payload->>'occurredAt' desc, c.payload->>'receivedAt' desc, c.device_id, c.attempt_id
    limit 10001
  )
  select jsonb_build_object(
    'attempts', coalesce(jsonb_agg(b.payload order by b.payload->>'occurredAt' desc, b.payload->>'receivedAt' desc, b.device_id, b.attempt_id), '[]'::jsonb),
    'truncated', count(*) > 10000
  ) from bounded b;
$$;
revoke all on function public.dmh_reporting_attempts() from public, anon, authenticated;
grant execute on function public.dmh_reporting_attempts() to service_role;

comment on table public.dmh_reporting_devices is 'DMH write-only installation credentials; accessible only through the authenticated server API.';
comment on table public.dmh_reporting_events is 'Immutable DMH procedure events; preserve IDs, sequence and original occurrence timestamps when importing.';
commit;
