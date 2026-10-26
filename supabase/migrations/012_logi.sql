-- =====================================================================
--  Migracja 012 — logi działań użytkowników (do szukania błędów).
--  Zapisywane: kliknięcia (przyciski, zakładki, linki), przejścia między widokami,
--  błędy strony i bazy. NIE zapisujemy treści wpisywanej w pola (dane pacjentów,
--  hasła) ani treści wiadomości czatu.
--  Zapis: tylko własne wpisy, przez funkcję log_batch (paczki do 200 wpisów).
--  Odczyt: tylko Administrator (user_logs_for). Przechowywanie: 30 dni (pg_cron).
-- =====================================================================
create table public.user_logs(
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('click','nav','error','info')),
  label text not null default '',
  view text not null default '',
  detail text not null default '',
  version text not null default '',
  device text not null default ''
);
create index user_logs_user_at on public.user_logs(user_id, at desc);
create index user_logs_at on public.user_logs(at);
alter table public.user_logs enable row level security;
revoke all on public.user_logs from anon, authenticated;
create policy r on public.user_logs for select to authenticated using (app.is_admin());
grant select on public.user_logs to authenticated;

create or replace function public.log_batch(p jsonb) returns int
language plpgsql security definer set search_path='' as $$
declare n int;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active) then return 0; end if;
  if jsonb_typeof(p)<>'array' then raise exception 'Niedozwolone'; end if;
  insert into public.user_logs(user_id,at,kind,label,view,detail,version,device)
  select auth.uid(),
         least(now(), greatest(now()-interval '1 day', coalesce((e->>'at')::timestamptz, now()))),
         case when e->>'kind' in ('click','nav','error','info') then e->>'kind' else 'info' end,
         left(coalesce(e->>'label',''),300), left(coalesce(e->>'view',''),200), left(coalesce(e->>'detail',''),1000),
         left(coalesce(e->>'version',''),20), left(coalesce(e->>'device',''),120)
  from (select e from jsonb_array_elements(p) e limit 200) x;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.user_logs_for(p_user uuid, p_hours int default 24, p_errors boolean default false)
returns setof public.user_logs language sql stable security definer set search_path='' as $$
  select * from public.user_logs
  where app.is_admin() and user_id=p_user and at>now()-make_interval(hours=>greatest(1,least(coalesce(p_hours,24),720)))
    and (not coalesce(p_errors,false) or kind='error')
  order by at desc limit 3000
$$;

revoke all on function public.log_batch(jsonb), public.user_logs_for(uuid,int,boolean) from public, anon;
grant execute on function public.log_batch(jsonb), public.user_logs_for(uuid,int,boolean) to authenticated;

-- porządki: logi starsze niż 30 dni kasują się co noc
do $$ begin
  if to_regclass('cron.job') is not null then
    execute $q$select cron.unschedule(jobid) from cron.job where jobname='logi-porzadki'$q$;
    execute $q$select cron.schedule('logi-porzadki','17 2 * * *','delete from public.user_logs where at < now() - interval ''30 days''')$q$;
  end if;
end $$;
