-- =====================================================================
--  Migracja 007 — telefon przy osobie i status Administratora / dyspozytora.
--  • Telefon (user_contacts): widzi go sam właściciel, Administrator / dyspozytor
--    i osoby, które mogą z nim pisać w komunikatorze (pielęgniarki nie widzą się nawzajem).
--    Zmienia: Administrator (każdy numer) albo właściciel (własny).
--  • Status (tylko Administrator / dyspozytor): Dostępny / Zajęty / Niewidoczny.
--    Niewidoczny = dla wszystkich wygląda na niezalogowanego (także w „Aktywni”).
--    Status zostaje po wylogowaniu. Gdy osoba staje się dostępna (logowanie ze statusem
--    „Dostępny” albo zmiana na „Dostępny”), zapisuje się available_at — inni zalogowani
--    dostają krótki komunikat z dźwiękiem.
-- =====================================================================
create table public.user_contacts(
  user_id uuid primary key references public.profiles(id) on delete cascade,
  phone text not null default '' check (phone='' or phone ~ '^\+?[0-9][0-9 ()-]{5,19}$'),
  updated_at timestamptz not null default now()
);
alter table public.user_contacts enable row level security;
revoke all on public.user_contacts from anon, authenticated;
grant select on public.user_contacts to authenticated;
create policy r on public.user_contacts for select to authenticated using (app.session_ok() and (
  user_id=auth.uid() or app.nurse_lvl(auth.uid())=2 or app.can_chat(auth.uid(),user_id)));

create or replace function public.set_phone(p_user uuid, p_phone text) returns void language plpgsql security definer set search_path='' as $$
declare v text:=btrim(coalesce(p_phone,''));
begin
  if auth.uid() is null or not app.session_ok() then raise exception 'Brak aktywnej sesji' using errcode='42501'; end if;
  if p_user<>auth.uid() and not app.is_admin() then raise exception 'Numer zmienia Administrator albo właściciel konta' using errcode='42501'; end if;
  if v<>'' and v !~ '^\+?[0-9][0-9 ()-]{5,19}$' then raise exception 'Nieprawidłowy numer telefonu'; end if;
  insert into public.user_contacts(user_id,phone,updated_at) values(p_user,v,now()) on conflict (user_id) do update set phone=excluded.phone, updated_at=now();
  perform app.audit('uzytkownik.telefon',coalesce((select full_name from public.profiles where id=p_user),''),case when v='' then 'usunięto' else 'zmieniono' end);
end $$;

alter table public.user_presence add column status text not null default 'online' check (status in ('online','busy','invisible'));
alter table public.user_presence add column available_at timestamptz;

-- sygnał obecności: jak w 005 + moment „stał się dostępny” (wejście ze statusem Dostępny)
create or replace function public.presence_ping(p_state text default 'ping') returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or p_state not in ('login','ping','logout') then raise exception 'Niedozwolone' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and active) then return; end if;
  if p_state<>'logout' and not app.session_ok() then return; end if;
  insert into public.user_presence as p(user_id,login_at,last_seen,logout_at,available_at)
    values(auth.uid(), case when p_state='login' then now() end, now(), case when p_state='logout' then now() end, case when p_state<>'logout' then now() end)
  on conflict(user_id) do update set
    last_seen = now(),
    login_at  = case when p_state='login' or p.login_at is null or p.logout_at>=p.last_seen then now() else p.login_at end,
    logout_at = case when p_state='logout' then now() else null end,
    available_at = case when p_state<>'logout' and p.status='online'
                         and (p.logout_at is not null or p.last_seen < now()-interval '2 minutes') then now() else p.available_at end;
end $$;

-- obecność widziana przez innych: online / busy / offline (niewidoczny = offline)
create or replace function app.presence_of(uid uuid) returns text language sql stable security definer set search_path='' as $$
  select case when p.user_id is null or not (p.last_seen > now()-interval '2 minutes' and p.logout_at is null) then 'offline'
              when p.status='invisible' and uid<>auth.uid() then 'offline'
              when p.status='busy' then 'busy' else 'online' end
  from (select 1) x left join public.user_presence p on p.user_id=uid
$$;

create or replace function public.set_my_status(p_status text) returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not app.session_ok() then raise exception 'Brak aktywnej sesji' using errcode='42501'; end if;
  if app.nurse_lvl(auth.uid())<>2 then raise exception 'Status ustawia Administrator / dyspozytor' using errcode='42501'; end if;
  if p_status not in ('online','busy','invisible') then raise exception 'Nieznany status'; end if;
  insert into public.user_presence as p(user_id,last_seen,status,available_at) values(auth.uid(),now(),p_status,case when p_status='online' then now() end)
    on conflict (user_id) do update set status=excluded.status, last_seen=now(), logout_at=null,
      available_at=case when excluded.status='online' and p.status<>'online' then now() else p.available_at end;
end $$;

drop function public.active_users();
create function public.active_users() returns table(
  user_id uuid, full_name text, email text, role text, online boolean, login_at timestamptz, last_seen timestamptz, logout_at timestamptz, status text)
language sql stable security definer set search_path='' as $$
  select u.id, u.full_name, u.email, u.role,
         app.presence_of(u.id) in ('online','busy'),
         case when app.presence_of(u.id)='offline' and p.status='invisible' and u.id<>auth.uid() then null else p.login_at end,
         case when p.status='invisible' and u.id<>auth.uid() then null else p.last_seen end,
         case when p.status='invisible' and u.id<>auth.uid() then null else p.logout_at end,
         app.presence_of(u.id)
  from public.profiles u left join public.user_presence p on p.user_id=u.id
  where app.is_admin() and u.active
  order by 5 desc, 7 desc nulls last, u.full_name
$$;

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

revoke all on function public.set_phone(uuid,text), public.set_my_status(text), public.active_users(), public.chat_state() from public, anon;
grant execute on function public.set_phone(uuid,text), public.set_my_status(text), public.active_users(), public.chat_state() to authenticated;
