-- =====================================================================
--  Migracja 005 — „Aktywni”: kto jest teraz zalogowany (widok Administratora).
--  Panel co minutę wysyła sygnał obecności (presence_ping). Aktywny teraz =
--  sygnał w ciągu ostatnich 2 minut i brak wylogowania po nim.
--  Zapis tylko przez funkcję (własny wiersz), odczyt tylko Administrator.
-- =====================================================================
create table public.user_presence(
  user_id uuid primary key references public.profiles(id) on delete cascade,
  login_at timestamptz,
  last_seen timestamptz not null default now(),
  logout_at timestamptz
);
alter table public.user_presence enable row level security;
revoke all on public.user_presence from anon, authenticated;
grant select on public.user_presence to authenticated;
create policy presence_admin on public.user_presence for select to authenticated using (app.is_admin());

create or replace function public.presence_ping(p_state text default 'ping') returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or p_state not in ('login','ping','logout') then raise exception 'Niedozwolone' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and active) then return; end if;
  if p_state<>'logout' and not app.session_ok() then return; end if;
  insert into public.user_presence as p(user_id,login_at,last_seen,logout_at)
    values(auth.uid(), case when p_state='login' then now() end, now(), case when p_state='logout' then now() end)
  on conflict(user_id) do update set
    last_seen = now(),
    login_at  = case when p_state='login' or p.login_at is null or p.logout_at>=p.last_seen then now() else p.login_at end,
    logout_at = case when p_state='logout' then now() else null end;
end $$;
revoke all on function public.presence_ping(text) from public, anon;
grant execute on function public.presence_ping(text) to authenticated;

create or replace function public.active_users() returns table(
  user_id uuid, full_name text, email text, role text, online boolean, login_at timestamptz, last_seen timestamptz, logout_at timestamptz)
language sql stable security definer set search_path='' as $$
  select u.id, u.full_name, u.email, u.role,
         coalesce(p.last_seen > now()-interval '2 minutes' and p.logout_at is null, false),
         p.login_at, p.last_seen, p.logout_at
  from public.profiles u left join public.user_presence p on p.user_id=u.id
  where app.is_admin() and u.active
  order by 5 desc, p.last_seen desc nulls last, u.full_name
$$;
revoke all on function public.active_users() from public, anon;
grant execute on function public.active_users() to authenticated;
