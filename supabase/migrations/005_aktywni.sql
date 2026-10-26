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

-- =====================================================================
--  Podgląd „jako rola” / „jako osoba” (tylko Administrator, tylko odczyt).
--  Zlecenia i stawki w podglądzie pochodzą z tych samych zapytań co panel
--  pielęgniarki (my_orders / my_rates), więc podgląd pokazuje dokładnie to samo.
-- =====================================================================
create or replace function app.orders_for(nid uuid) returns table(id uuid, number bigint, client_name text, client_phone text, address text, lat float8, lng float8, service text, start_at timestamptz, end_at timestamptz,
  status text, expires_at timestamptz, zone_no smallint, distance_km numeric, payout_travel numeric, note text) language sql stable security definer set search_path='' as $$
  select o.id,o.number,o.client_name,o.client_phone,o.address,o.lat,o.lng,s.name,o.start_at,o.end_at,o.status,o.expires_at,o.zone_no,o.distance_km,o.payout_travel,o.note
  from public.nurse_orders o join public.nurse_services s on s.id=o.service_id where o.nurse_id=nid and nid is not null order by o.start_at
$$;
create or replace function app.rates_for(nid uuid) returns table(zone_no smallint, km_from numeric, km_to numeric, payout numeric) language sql stable security definer set search_path='' as $$
  with n as (select id, city from public.nurses where id=nid),
  t as (select z.* from public.price_zones z, n where z.city is not null and lower(z.city)=lower(n.city)),
  o as (select z.* from public.price_zones z, n where z.nurse_id=n.id)
  select coalesce(o.zone_no,t.zone_no), coalesce(o.km_from,t.km_from), coalesce(o.km_to,t.km_to), coalesce(o.payout,t.payout) from t full join o on o.zone_no=t.zone_no order by 1
$$;
revoke all on function app.orders_for(uuid), app.rates_for(uuid) from public, anon, authenticated;
create or replace function public.my_orders() returns table(id uuid, number bigint, client_name text, client_phone text, address text, lat float8, lng float8, service text, start_at timestamptz, end_at timestamptz,
  status text, expires_at timestamptz, zone_no smallint, distance_km numeric, payout_travel numeric, note text) language sql stable security definer set search_path='' as $$
  select * from app.orders_for(app.my_nurse())
$$;
create or replace function public.my_rates() returns table(zone_no smallint, km_from numeric, km_to numeric, payout numeric) language sql stable security definer set search_path='' as $$
  select * from app.rates_for(app.my_nurse())
$$;

-- p_user: podgląd konkretnej osoby; p_role (+ p_nurse: karta „na przykładzie”): podgląd roli
create or replace function public.preview_panel(p_user uuid default null, p_role text default null, p_nurse uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u public.profiles; r text; lvl int; nid uuid;
begin
  if not app.is_admin() then raise exception 'Podgląd tylko dla Administratora' using errcode='42501'; end if;
  if p_user is not null then
    select * into u from public.profiles where id=p_user;
    if not found then raise exception 'Nie ma takiego konta'; end if;
    r:=u.role;
    lvl:=case when not u.active then 0 else coalesce(
      (select level from public.permission_overrides o where o.user_id=u.id and o.perm='nurses' and (o.valid_until is null or o.valid_until>=current_date)),
      (select level from public.role_permissions where role=u.role and perm='nurses'),0) end;
    if r='nurse' then select id into nid from public.nurses where user_id=u.id; end if;
  else
    r:=p_role;
    if r is null or not exists(select 1 from public.role_permissions where role=r) and r not in ('admin','att','app','office','tech','nurse') then raise exception 'Nieznana rola'; end if;
    lvl:=coalesce((select level from public.role_permissions where role=r and perm='nurses'),0);
    if r='nurse' then nid:=p_nurse; end if;
  end if;
  return jsonb_build_object('role',r,'level',lvl,'active',coalesce(u.active,true),'name',coalesce(nullif(u.full_name,''),u.email),'nurse_id',nid,
    'orders',coalesce((select jsonb_agg(to_jsonb(x)) from app.orders_for(case when r='nurse' and lvl>0 then nid end) x),'[]'::jsonb),
    'rates',coalesce((select jsonb_agg(to_jsonb(x)) from app.rates_for(case when r='nurse' and lvl>0 then nid end) x),'[]'::jsonb));
end $$;
revoke all on function public.preview_panel(uuid,text,uuid) from public, anon;
grant execute on function public.preview_panel(uuid,text,uuid) to authenticated;
