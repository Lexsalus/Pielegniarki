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


-- =====================================================================
--  Urządzenie przy osobie (📱 telefon / 💻 komputer) — „Aktywni” i komunikator.
--  Panel przy każdym sygnale obecności podaje rodzaj urządzenia (bez numerów
--  i identyfikatorów): np. „phone|Chrome / Android · aplikacja”.
--  Osoba „Niewidoczna” — urządzenie ukryte jak obecność.
-- =====================================================================
alter table public.user_presence add column if not exists device text;
drop function if exists public.presence_ping(text);
create or replace function public.presence_ping(p_state text default 'ping', p_device text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or p_state not in ('login','ping','logout') then raise exception 'Niedozwolone' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and active) then return; end if;
  if p_state<>'logout' and not app.session_ok() then return; end if;
  insert into public.user_presence as p(user_id,login_at,last_seen,logout_at,available_at,device)
    values(auth.uid(), case when p_state='login' then now() end, now(), case when p_state='logout' then now() end, case when p_state<>'logout' then now() end, left(p_device,120))
  on conflict(user_id) do update set
    last_seen = now(),
    login_at  = case when p_state='login' or p.login_at is null or p.logout_at>=p.last_seen then now() else p.login_at end,
    logout_at = case when p_state='logout' then now() else null end,
    device = coalesce(left(p_device,120), p.device),
    available_at = case when p_state<>'logout' and p.status='online'
                         and (p.logout_at is not null or p.last_seen < now()-interval '2 minutes') then now() else p.available_at end;
end $$;
revoke all on function public.presence_ping(text,text) from public, anon;
grant execute on function public.presence_ping(text,text) to authenticated;

drop function if exists public.active_users();
create function public.active_users() returns table(
  user_id uuid, full_name text, email text, role text, online boolean, login_at timestamptz, last_seen timestamptz, logout_at timestamptz, status text, device text)
language sql stable security definer set search_path='' as $$
  select u.id, u.full_name, u.email, u.role,
         app.presence_of(u.id) in ('online','busy'),
         case when app.presence_of(u.id)='offline' and p.status='invisible' and u.id<>auth.uid() then null else p.login_at end,
         case when p.status='invisible' and u.id<>auth.uid() then null else p.last_seen end,
         case when p.status='invisible' and u.id<>auth.uid() then null else p.logout_at end,
         app.presence_of(u.id),
         case when p.status='invisible' and u.id<>auth.uid() then null else p.device end
  from public.profiles u left join public.user_presence p on p.user_id=u.id
  where app.is_admin() and u.active
  order by 5 desc, 7 desc nulls last, u.full_name
$$;

revoke all on function public.active_users() from public, anon;
grant execute on function public.active_users() to authenticated;

create or replace function public.chat_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); res jsonb;
begin
  if me is null or not app.session_ok() then return jsonb_build_object('contacts','[]'::jsonb,'orders','[]'::jsonb); end if;
  update public.chat_messages set delivered_at=now() where recipient_id=me and delivered_at is null;
  select jsonb_build_object(
    'contacts', coalesce((select jsonb_agg(c order by c.unread desc, c.last_at desc nulls last, c.full_name) from (
      select u.id as user_id, coalesce(nullif(u.full_name,''),u.email) as full_name, u.role,
        app.presence_of(u.id) in ('online','busy') as online,
        app.presence_of(u.id) as status,
        app.nurse_lvl(u.id)=2 as staff,
        case when app.presence_of(u.id)<>'offline' or (select status from public.user_presence where user_id=u.id)<>'invisible' then (select device from public.user_presence where user_id=u.id) end as device,
        case when app.presence_of(u.id)='online' then (select available_at from public.user_presence where user_id=u.id) end as available_at,
        coalesce(nullif(uc.phone,''),nullif((select n.phone from public.nurses n where n.user_id=u.id limit 1),'')) as phone,
        (select count(*) from public.chat_messages m where m.sender_id=u.id and m.recipient_id=me and m.read_at is null)::int as unread,
        (select max(m.created_at) from public.chat_messages m where (m.sender_id=u.id and m.recipient_id=me) or (m.sender_id=me and m.recipient_id=u.id)) as last_at,
        (select left(m.body,80) from public.chat_messages m where (m.sender_id=u.id and m.recipient_id=me) or (m.sender_id=me and m.recipient_id=u.id) order by m.created_at desc limit 1) as last_body
      from public.profiles u left join public.user_contacts uc on uc.user_id=u.id
      where app.can_chat(me,u.id)) c),'[]'::jsonb),
    'me', jsonb_build_object('status',coalesce((select status from public.user_presence where user_id=me),'online'),'can_status',app.nurse_lvl(me)=2),
    'orders', coalesce((select jsonb_agg(t order by t.unread desc, t.last_at desc) from (
      select o.id as order_id, o.number, max(m.created_at) as last_at,
        count(*) filter (where m.sender_id<>me and m.created_at > coalesce(cr.last_read_at,'-infinity'))::int as unread,
        (array_agg(left(m.body,80) order by m.created_at desc))[1] as last_body
      from public.chat_messages m join public.nurse_orders o on o.id=m.order_id
      left join public.chat_reads cr on cr.order_id=o.id and cr.user_id=me
      where m.order_id is not null and app.order_chat_ok(me,o.id)
      group by o.id, o.number, cr.last_read_at) t),'[]'::jsonb)) into res;
  return res;
end $$;
revoke all on function public.chat_state() from public, anon;
grant execute on function public.chat_state() to authenticated;
