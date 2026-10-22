create extension if not exists pg_cron with schema pg_catalog;

create or replace function private.peak_fresh_generate_weekly_pickup_slots()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_today date := (now() at time zone 'Africa/Nairobi')::date;
  v_inserted integer;
begin
  insert into public.pickup_slots
    (pickup_date, start_time, end_time, capacity, reserved_quantity, order_cutoff, available)
  select
    v_today + day_offset,
    make_time(hour_no, 0, 0),
    make_time(hour_no + 1, 0, 0),
    3,
    0,
    ((v_today + day_offset + make_time(hour_no, 0, 0)) - interval '5 hours') at time zone 'Africa/Nairobi',
    true
  from generate_series(1, 14) as days(day_offset)
  cross join generate_series(12, 19) as hours(hour_no)
  where not exists (
    select 1
    from public.pickup_slots existing
    where existing.pickup_date = v_today + day_offset
      and existing.start_time = make_time(hour_no, 0, 0)
  );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$;

revoke all on function private.peak_fresh_generate_weekly_pickup_slots() from public, anon, authenticated;

select private.peak_fresh_generate_weekly_pickup_slots() as inserted_new_slots;

do $schedule$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'peak_fresh_weekly_pickup_slots';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'peak_fresh_weekly_pickup_slots',
    '0 21 * * 0',
    'select private.peak_fresh_generate_weekly_pickup_slots();'
  );
end;
$schedule$;