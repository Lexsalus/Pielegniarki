-- =====================================================================
--  Migracja 004 — zakładka „Pielęgniarki” (projekt 23.10.2026)
--  Rewiry na mapie · dostępność · strefy i stawki · przydział zleceń.
--  Nowa rola „nurse” (Pielęgniarka) i uprawnienie „nurses” (Pielęgniarki).
--  Reguły egzekwuje baza: pielęgniarka widzi tylko siebie i własne zlecenia,
--  zmiany obszaru i terminarza czekają na zatwierdzenie, każde zlecenie
--  wymaga akceptacji pielęgniarki (limit czasu → następna z puli → dyspozytor).
-- =====================================================================

-- 1) rola i uprawnienie
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','att','app','office','tech','nurse'));
alter table public.role_permissions drop constraint if exists role_permissions_role_check;
alter table public.role_permissions add constraint role_permissions_role_check check (role in ('admin','att','app','office','tech','nurse'));
insert into public.role_permissions(role,perm,level) values ('admin','nurses',2),('nurse','nurses',1) on conflict do nothing;

-- 2) tabele
create table public.nurse_settings(
  id smallint primary key default 1 check (id=1),
  map_provider text not null default 'leaflet' check (map_provider in ('leaflet','google')),
  google_key text not null default '',                    -- klucz przeglądarkowy Google Maps (ograniczony do domeny)
  overlap_mode text not null default 'rule' check (overlap_mode in ('rule','distance')),
  distance_mode text not null default 'straight' check (distance_mode in ('straight','roads')),
  max_visits_per_day int not null default 8 check (max_visits_per_day between 1 and 50),
  travel_buffer_min int not null default 30 check (travel_buffer_min between 0 and 240),
  accept_timeout_min int not null default 10 check (accept_timeout_min between 1 and 240),
  slot_step_min int not null default 30 check (slot_step_min in (10,15,20,30,60)),
  horizon_days int not null default 14 check (horizon_days between 1 and 90),
  updated_at timestamptz not null default now()
);
insert into public.nurse_settings(id) values (1) on conflict do nothing;

create table public.nurse_services(            -- usługi (badania)
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name)>=2),
  duration_min int not null default 15 check (duration_min between 5 and 480),
  buffer_min int not null default 0 check (buffer_min between 0 and 240),
  qualifications text not null default '',
  price numeric(10,2) check (price>=0),          -- cena badania (pusta = wg cennika)
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.nurses(
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.profiles(id),   -- konto do panelu pielęgniarki (opcjonalnie)
  full_name text not null check (length(full_name)>=3),
  color text not null default '#7c5cff' check (color ~ '^#[0-9a-fA-F]{6}$'),
  phone text not null default '', email text not null default '',
  city text not null default '',
  status text not null default 'do_weryfikacji' check (status in ('aktywna','urlop','do_weryfikacji','nieaktywna')),
  base_lat double precision, base_lng double precision, base_label text not null default '',
  rating numeric(2,1) check (rating between 0 and 5),
  created_at timestamptz not null default now()
);
create table public.nurse_service_links(
  nurse_id uuid not null references public.nurses(id), service_id uuid not null references public.nurse_services(id),
  primary key(nurse_id,service_id)
);
create table public.nurse_documents(
  id uuid primary key default gen_random_uuid(),
  nurse_id uuid not null references public.nurses(id),
  kind text not null check (kind in ('PWZ','OC','umowa','inne')),
  number text not null default '', valid_until date,
  storage_path text, file_name text,
  uploaded_by uuid default auth.uid(), uploaded_at timestamptz not null default now()
);

create table public.districts(                  -- granice dzielnic (import z OpenStreetMap lub narysowane)
  id uuid primary key default gen_random_uuid(),
  city text not null, name text not null,
  rings jsonb not null,                          -- [[ [lat,lng], ... ], ...] — parzystość pierścieni (obsługa dziur)
  source text not null default 'osm',
  unique(city,name)
);

create table public.nurse_areas(
  id uuid primary key default gen_random_uuid(),
  nurse_id uuid not null references public.nurses(id),
  shapes jsonb not null default '[]',            -- [{type:'districts',city,names[]} | {type:'city',city} | {type:'polygon',points[[lat,lng]]} | {type:'radius',lat,lng,km,label}]
  base_lat double precision, base_lng double precision, base_label text not null default '',
  status text not null default 'draft' check (status in ('draft','pending','approved','archived')),
  note text not null default '',
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  submitted_at timestamptz, decided_by uuid, decided_at timestamptz
);
create unique index nurse_areas_one_open on public.nurse_areas(nurse_id) where status in ('draft','pending');
create unique index nurse_areas_one_approved on public.nurse_areas(nurse_id) where status='approved';

create table public.nurse_patterns(             -- wzorzec tygodnia
  id uuid primary key default gen_random_uuid(),
  nurse_id uuid not null references public.nurses(id),
  dow smallint not null check (dow between 1 and 7),            -- 1 = poniedziałek … 7 = niedziela
  time_from time not null, time_to time not null check (time_to>time_from),
  valid_from date not null default current_date, valid_to date check (valid_to>=valid_from),
  status text not null default 'pending' check (status in ('pending','approved')),
  end_requested date,                                            -- pielęgniarka prosi o zakończenie wzorca od tej daty
  created_by uuid default auth.uid(), created_at timestamptz not null default now(), decided_by uuid
);
create table public.nurse_exceptions(
  id uuid primary key default gen_random_uuid(),
  nurse_id uuid not null references public.nurses(id),
  date_from date not null, date_to date not null check (date_to>=date_from),
  kind text not null check (kind in ('urlop','wolne','dodatkowe')),
  time_from time, time_to time,
  note text not null default '',
  status text not null default 'pending' check (status in ('pending','approved')),
  created_by uuid default auth.uid(), created_at timestamptz not null default now(), decided_by uuid,
  check ((time_from is null and time_to is null) or (time_from is not null and time_to is not null and time_to>time_from)),
  check (kind<>'dodatkowe' or time_from is not null)
);

create table public.price_zones(                -- szablon miasta albo nadpisanie dla pielęgniarki
  id uuid primary key default gen_random_uuid(),
  city text, nurse_id uuid references public.nurses(id),
  zone_no smallint not null check (zone_no between 1 and 20),
  km_from numeric(6,1), km_to numeric(6,1),
  price_client numeric(10,2) check (price_client>=0), payout numeric(10,2) check (payout>=0),
  check ((city is not null and nurse_id is null and km_from is not null and km_to is not null and km_to>km_from and price_client is not null and payout is not null)
      or (nurse_id is not null and city is null and (km_from is null or km_to>km_from)))
);
create unique index price_zones_city on public.price_zones(lower(city),zone_no) where city is not null;
create unique index price_zones_nurse on public.price_zones(nurse_id,zone_no) where nurse_id is not null;

create table public.assignment_rules(
  id uuid primary key default gen_random_uuid(),
  city text not null, district text,             -- district pusty = całe miasto
  kind text not null default 'weighted' check (kind in ('round_robin','weighted','queue','manual')),
  accept_timeout_min int check (accept_timeout_min between 1 and 240),   -- pusty = z ustawień
  rr_pointer int not null default 0,
  active boolean not null default true,
  updated_by uuid default auth.uid(), updated_at timestamptz not null default now()
);
create unique index assignment_rules_scope on public.assignment_rules(lower(city),lower(coalesce(district,'')));
create table public.assignment_pool(
  rule_id uuid not null references public.assignment_rules(id) on delete cascade,
  nurse_id uuid not null references public.nurses(id),
  weight numeric(6,2) not null default 1 check (weight>0),
  daily_limit int check (daily_limit between 1 and 50),
  queue_limit int check (queue_limit between 1 and 200),
  sort_order int not null default 0,
  swrr numeric not null default 0,               -- stan rozdziału proporcjonalnego (smooth weighted round-robin)
  primary key(rule_id,nurse_id)
);

create table public.nurse_orders(
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity (start with 1001) unique,
  client_name text not null check (length(client_name)>=3), client_phone text not null default '',
  address text not null, lat double precision not null, lng double precision not null,
  city text not null default '', district text,
  service_id uuid not null references public.nurse_services(id),
  start_at timestamptz not null, end_at timestamptz not null,
  nurse_id uuid references public.nurses(id),
  status text not null default 'nowe' check (status in ('nowe','zaproponowane','przyjete','w_drodze','wykonane','rozliczone')),
  needs_dispatcher boolean not null default false,
  rule_id uuid references public.assignment_rules(id),
  road_km jsonb not null default '{}',           -- odległości po drogach (id pielęgniarki → km), gdy włączone
  -- kwoty zapisywane w zleceniu (zmiana cennika nie zmienia historii)
  price_service numeric(10,2), price_travel numeric(10,2),
  zone_no smallint, distance_km numeric(6,1), payout_travel numeric(10,2),
  margin numeric(10,2) generated always as (price_travel-payout_travel) stored,
  proposed_at timestamptz, expires_at timestamptz, accepted_at timestamptz, done_at timestamptz, settled_at timestamptz,
  note text not null default '',
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);
create table public.order_attempts(
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.nurse_orders(id),
  nurse_id uuid not null references public.nurses(id),
  via text not null check (via in ('regula','odleglosc','dyspozytor')),
  proposed_at timestamptz not null default now(),
  result text not null default 'zaproponowane' check (result in ('zaproponowane','przyjete','odrzucone','brak_odpowiedzi')),
  decided_at timestamptz
);
create table public.nurse_waitlist(
  id uuid primary key default gen_random_uuid(),
  client_name text not null, client_phone text not null default '',
  address text not null, lat double precision, lng double precision, city text not null default '',
  service_id uuid references public.nurse_services(id),
  reason text not null default 'brak pokrycia',
  created_by uuid default auth.uid(), created_at timestamptz not null default now(), resolved_at timestamptz
);

-- 3) funkcje pomocnicze
create or replace function app.nurse_admin() returns boolean language sql stable security definer set search_path='' as $$ select app.perm('nurses')=2 $$;
create or replace function app.my_nurse() returns uuid language sql stable security definer set search_path='' as $$
  select n.id from public.nurses n join public.profiles p on p.id=n.user_id where n.user_id=auth.uid() and p.role='nurse' and app.session_ok()
$$;
create or replace function app.ncfg() returns public.nurse_settings language sql stable security definer set search_path='' as $$ select * from public.nurse_settings where id=1 $$;
create or replace function app.km(a1 float8, o1 float8, a2 float8, o2 float8) returns numeric language sql immutable as $$
  select round((2*6371*asin(sqrt(power(sin(radians(a2-a1)/2),2)+cos(radians(a1))*cos(radians(a2))*power(sin(radians(o2-o1)/2),2))))::numeric,1)
$$;
-- punkt w wielokącie (ray casting); ring = [[lat,lng],...]
create or replace function app.pip(lat float8, lng float8, ring jsonb) returns boolean language plpgsql immutable as $$
declare n int := jsonb_array_length(ring); i int; j int; yi float8; xi float8; yj float8; xj float8; inside boolean := false;
begin
  if n<3 then return false; end if;
  j := n-1;
  for i in 0..n-1 loop
    yi := (ring->i->>0)::float8; xi := (ring->i->>1)::float8; yj := (ring->j->>0)::float8; xj := (ring->j->>1)::float8;
    if ((yi>lat) <> (yj>lat)) and (lng < (xj-xi)*(lat-yi)/(yj-yi)+xi) then inside := not inside; end if;
    j := i;
  end loop;
  return inside;
end $$;
create or replace function app.rings_has(rings jsonb, lat float8, lng float8) returns boolean language sql immutable as $$
  select coalesce((select count(*) filter (where app.pip(lat,lng,r)) % 2 = 1 from jsonb_array_elements(rings) r),false)
$$;
create or replace function app.area_has(shapes jsonb, lat float8, lng float8) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from jsonb_array_elements(coalesce(shapes,'[]')) s where
    case s->>'type'
      when 'radius' then app.km(lat,lng,(s->>'lat')::float8,(s->>'lng')::float8) <= (s->>'km')::numeric
      when 'polygon' then app.pip(lat,lng,s->'points')
      when 'city' then exists(select 1 from public.districts d where lower(d.city)=lower(s->>'city') and app.rings_has(d.rings,lat,lng))
      when 'districts' then exists(select 1 from public.districts d where lower(d.city)=lower(s->>'city') and d.name in (select jsonb_array_elements_text(s->'names')) and app.rings_has(d.rings,lat,lng))
      else false end)
$$;
create or replace function app.nurse_covers(n uuid, lat float8, lng float8) returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select app.area_has(a.shapes,lat,lng) from public.nurse_areas a where a.nurse_id=n and a.status='approved'),false)
$$;
create or replace function app.district_of(lat float8, lng float8) returns public.districts language sql stable security definer set search_path='' as $$
  select d.* from public.districts d where app.rings_has(d.rings,lat,lng) limit 1
$$;
-- strefa: szablon miasta pielęgniarki + jej nadpisania (nadpisanie może zmienić tylko wybraną kwotę albo dodać strefę)
create or replace function app.zone(n uuid, dist numeric) returns table(zone_no smallint, price_client numeric, payout numeric) language sql stable security definer set search_path='' as $$
  with nn as (select city from public.nurses where id=n),
  t as (select * from public.price_zones z where z.city is not null and lower(z.city)=lower((select city from nn))),
  o as (select * from public.price_zones z where z.nurse_id=n),
  m as (select coalesce(o.zone_no,t.zone_no) zn, coalesce(o.km_from,t.km_from) kf, coalesce(o.km_to,t.km_to) kt,
               coalesce(o.price_client,t.price_client) pc, coalesce(o.payout,t.payout) po from t full join o on o.zone_no=t.zone_no)
  select zn, pc, po from m where dist>=kf and dist<kt and pc is not null and po is not null order by zn limit 1
$$;
create or replace function app.rule_for(p_city text, p_district text) returns public.assignment_rules language sql stable security definer set search_path='' as $$
  select r.* from public.assignment_rules r where r.active and lower(r.city)=lower(coalesce(p_city,''))
    and (r.district is null or lower(r.district)=lower(coalesce(p_district,'')))
  order by (r.district is null) limit 1
$$;
create or replace function app.day_limit(n uuid, rule uuid) returns int language sql stable security definer set search_path='' as $$
  select coalesce((select daily_limit from public.assignment_pool where rule_id=rule and nurse_id=n),(app.ncfg()).max_visits_per_day)
$$;
create or replace function app.day_count(n uuid, d date) returns int language sql stable security definer set search_path='' as $$
  select count(*)::int from public.nurse_orders o where o.nurse_id=n and o.status<>'nowe' and (o.start_at at time zone 'Europe/Warsaw')::date=d
$$;
-- wolne okna: wzorzec + godziny dodatkowe − urlop/wolne − wizyty (z buforem na dojazd)
create or replace function app.free(n uuid, d1 date, d2 date) returns tstzmultirange language plpgsql stable security definer set search_path='' as $$
declare av tstzmultirange; bl tstzmultirange; bz tstzmultirange; buf interval := make_interval(mins=>(app.ncfg()).travel_buffer_min); tz text := 'Europe/Warsaw';
begin
  if coalesce((select status from public.nurses where id=n),'')<>'aktywna' then return '{}'; end if;
  select coalesce(range_agg(tstzrange((g.d+p.time_from) at time zone tz,(g.d+p.time_to) at time zone tz)),'{}') into av
    from (select x::date d from generate_series(d1,d2,interval '1 day') x) g
    join public.nurse_patterns p on p.nurse_id=n and p.status='approved' and p.dow=extract(isodow from g.d) and g.d>=p.valid_from and (p.valid_to is null or g.d<=p.valid_to);
  av := av + coalesce((select range_agg(tstzrange((g.d+e.time_from) at time zone tz,(g.d+e.time_to) at time zone tz))
    from (select x::date d from generate_series(d1,d2,interval '1 day') x) g
    join public.nurse_exceptions e on e.nurse_id=n and e.status='approved' and e.kind='dodatkowe' and g.d between e.date_from and e.date_to),'{}');
  select coalesce(range_agg(tstzrange((g.d+coalesce(e.time_from,'00:00')) at time zone tz, case when e.time_to is null then (g.d+1)::timestamp at time zone tz else (g.d+e.time_to) at time zone tz end)),'{}') into bl
    from (select x::date d from generate_series(d1,d2,interval '1 day') x) g
    join public.nurse_exceptions e on e.nurse_id=n and e.status='approved' and e.kind in ('urlop','wolne') and g.d between e.date_from and e.date_to;
  select coalesce(range_agg(tstzrange(o.start_at-buf,o.end_at+buf)),'{}') into bz from public.nurse_orders o
    where o.nurse_id=n and o.status<>'nowe' and o.start_at < (d2+2)::timestamp at time zone tz and o.end_at > (d1-1)::timestamp at time zone tz;
  return av - bl - bz;
end $$;
create or replace function app.visit_len(s uuid) returns interval language sql stable security definer set search_path='' as $$
  select make_interval(mins=>duration_min+buffer_min) from public.nurse_services where id=s
$$;
create or replace function app.align(t timestamptz, step int) returns timestamptz language sql immutable as $$
  select date_trunc('hour',t) + ceil(extract(epoch from (t-date_trunc('hour',t)))/60.0/step)*step*interval '1 minute'
$$;
create or replace function app.dist_for(n uuid, o public.nurse_orders) returns numeric language sql stable security definer set search_path='' as $$
  select coalesce((o.road_km->>n::text)::numeric, (select app.km(o.lat,o.lng,base_lat,base_lng) from public.nurses where id=n))
$$;
-- pielęgniarki, które przechodzą twarde filtry dla zlecenia: obszar, wolny termin, usługa, limit dzienny
create or replace function app.order_cands(o public.nurse_orders, skip_attempted boolean default true) returns table(nurse_id uuid, dist numeric) language sql stable security definer set search_path='' as $$
  select n.id, app.dist_for(n.id,o) from public.nurses n
  where n.status='aktywna' and n.base_lat is not null
    and exists(select 1 from public.nurse_service_links l where l.nurse_id=n.id and l.service_id=o.service_id)
    and app.nurse_covers(n.id,o.lat,o.lng)
    and tstzrange(o.start_at,o.end_at) <@ app.free(n.id,(o.start_at at time zone 'Europe/Warsaw')::date,(o.start_at at time zone 'Europe/Warsaw')::date)
    and app.day_count(n.id,(o.start_at at time zone 'Europe/Warsaw')::date) < app.day_limit(n.id,o.rule_id)
    and (not skip_attempted or not exists(select 1 from public.order_attempts a where a.order_id=o.id and a.nurse_id=n.id))
$$;
create or replace function app.notify_dispatch(o public.nurse_orders, why text) returns void language plpgsql security definer set search_path='' as $$
declare a uuid;
begin
  for a in select p.id from public.profiles p where p.active and (p.role='admin' or exists(select 1 from public.permission_overrides x where x.user_id=p.id and x.perm='nurses' and x.level=2 and (x.valid_until is null or x.valid_until>=current_date))) loop
    perform app.notify(a,'order.dispatch',null,'Zlecenie #'||o.number||' czeka na dyspozytora',why,'wazne',true,'order-dispatch:'||o.id||':'||extract(epoch from now())::bigint);
  end loop;
end $$;
create or replace function app.propose(oid uuid, n uuid, via text) returns void language plpgsql security definer set search_path='' as $$
declare o public.nurse_orders; z record; d numeric; tmo int; u uuid;
begin
  select * into o from public.nurse_orders where id=oid for update;
  d := app.dist_for(n,o); select * into z from app.zone(n,d);
  tmo := coalesce((select accept_timeout_min from public.assignment_rules where id=o.rule_id),(app.ncfg()).accept_timeout_min);
  update public.nurse_orders set nurse_id=n, status='zaproponowane', needs_dispatcher=false, proposed_at=now(), expires_at=now()+make_interval(mins=>tmo),
    distance_km=d, zone_no=z.zone_no, payout_travel=z.payout where id=oid;
  insert into public.order_attempts(order_id,nurse_id,via) values (oid,n,via);
  select user_id into u from public.nurses where id=n;
  perform app.notify(u,'order.proposed',null,'Nowe zlecenie #'||o.number||' do akceptacji',
    to_char(o.start_at at time zone 'Europe/Warsaw','DD.MM.YYYY HH24:MI')||' · '||o.address||' · masz '||tmo||' min na przyjęcie','wazne',true,'order:'||oid||':'||n);
end $$;
-- wybór pielęgniarki wg reguły admina (albo odległości przy nakładających się obszarach)
create or replace function app.assign(oid uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare o public.nurse_orders; r public.assignment_rules; cfg public.nurse_settings := app.ncfg(); c uuid[]; pick uuid; via text := 'regula'; tot numeric; m record; cnt int;
begin
  select * into o from public.nurse_orders where id=oid for update;
  if o.status<>'nowe' then return o.nurse_id; end if;
  r := app.rule_for(o.city,o.district);
  if r.id is distinct from o.rule_id then update public.nurse_orders set rule_id=r.id where id=oid; o.rule_id := r.id; end if;
  select array_agg(x.nurse_id) into c from app.order_cands(o) x;
  if c is null then
    update public.nurse_orders set needs_dispatcher=true where id=oid;
    perform app.notify_dispatch(o,'Brak chętnych: żadna pielęgniarka z obszaru nie może przyjąć tego terminu.'); return null; end if;
  if r.id is not null and r.kind='manual' then
    update public.nurse_orders set needs_dispatcher=true where id=oid; perform app.notify_dispatch(o,'Reguła „ręcznie” — wybierz pielęgniarkę.'); return null; end if;
  if cfg.overlap_mode='distance' then
    select x.nurse_id into pick from app.order_cands(o) x order by x.dist, x.nurse_id limit 1; via := 'odleglosc';
  elsif r.id is null then
    update public.nurse_orders set needs_dispatcher=true where id=oid; perform app.notify_dispatch(o,'Brak reguły przydziału dla tego miasta / dzielnicy.'); return null;
  elsif r.kind='weighted' then
    select coalesce(sum(p.weight),0) into tot from public.assignment_pool p where p.rule_id=r.id and p.nurse_id=any(c);
    if tot>0 then
      update public.assignment_pool p set swrr=p.swrr+p.weight where p.rule_id=r.id and p.nurse_id=any(c);
      select p.nurse_id into pick from public.assignment_pool p where p.rule_id=r.id and p.nurse_id=any(c) order by p.swrr desc, p.sort_order limit 1;
      update public.assignment_pool p set swrr=p.swrr-tot where p.rule_id=r.id and p.nurse_id=pick;
    end if;
  else  -- po kolei / kolejka z limitem
    if r.kind='queue' then
      for m in select p.* from public.assignment_pool p where p.rule_id=r.id and p.nurse_id=any(c) and p.queue_limit is not null order by p.sort_order loop
        select count(*) into cnt from public.order_attempts a join public.nurse_orders x on x.id=a.order_id
          where x.rule_id=r.id and a.nurse_id=m.nurse_id and a.result in ('zaproponowane','przyjete') and (a.proposed_at at time zone 'Europe/Warsaw')::date=(now() at time zone 'Europe/Warsaw')::date;
        if cnt<m.queue_limit then pick := m.nurse_id; exit; end if;
      end loop;
    end if;
    if pick is null then
      select p.nurse_id into pick from public.assignment_pool p
        where p.rule_id=r.id and p.nurse_id=any(c) and (r.kind='round_robin' or p.queue_limit is null)
        order by (p.sort_order<=r.rr_pointer), p.sort_order limit 1;
      if pick is not null then update public.assignment_rules x set rr_pointer=(select p.sort_order from public.assignment_pool p where p.rule_id=r.id and p.nurse_id=pick) where x.id=r.id; end if;
    end if;
  end if;
  if pick is null then
    update public.nurse_orders set needs_dispatcher=true where id=oid; perform app.notify_dispatch(o,'Żadna pielęgniarka z puli reguły nie może przyjąć tego terminu.'); return null; end if;
  perform app.propose(oid,pick,via);
  return pick;
end $$;
-- brak akceptacji w limicie czasu → następna z puli
create or replace function app.expire_orders() returns int language plpgsql security definer set search_path='' as $$
declare o record; k int := 0;
begin
  for o in select id, nurse_id, number from public.nurse_orders where status='zaproponowane' and expires_at<now() for update skip locked loop
    update public.order_attempts set result='brak_odpowiedzi', decided_at=now() where order_id=o.id and nurse_id=o.nurse_id and result='zaproponowane';
    update public.nurse_orders set status='nowe', nurse_id=null, proposed_at=null, expires_at=null, zone_no=null, distance_km=null, payout_travel=null where id=o.id;
    perform app.audit('zlecenie.brak_odpowiedzi','#'||o.number,'przekazane dalej');
    perform app.assign(o.id); k := k+1;
  end loop;
  return k;
end $$;

-- 4) triggery: zatwierdzanie obszaru i terminarza, audyt konfiguracji
create or replace function app.area_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not app.nurse_admin() then
    if new.nurse_id is distinct from app.my_nurse() then raise exception 'Możesz zmieniać tylko własny obszar' using errcode='42501'; end if;
    if new.status not in ('draft','pending') or (tg_op='UPDATE' and old.status not in ('draft','pending')) then
      raise exception 'Obszar zatwierdza Administrator' using errcode='42501'; end if;
    new.decided_by := null; new.decided_at := null;
  end if;
  if tg_op='UPDATE' and old.status in ('approved','archived') and not (old.status='approved' and new.status='archived') then
    raise exception 'Zatwierdzony obszar jest niezmienny — zmiana = nowy szkic' using errcode='42501'; end if;
  if new.status='pending' and (tg_op='INSERT' or old.status<>'pending') then new.submitted_at := now(); end if;
  if new.status='approved' and (tg_op='INSERT' or old.status<>'approved') then
    new.decided_by := auth.uid(); new.decided_at := now();
    update public.nurse_areas set status='archived' where nurse_id=new.nurse_id and status='approved' and id<>new.id;   -- poprzedni obszar
  end if;
  return new;
end $$;
create trigger area_guard before insert or update on public.nurse_areas for each row execute function app.area_guard();
create or replace function app.area_after() returns trigger language plpgsql security definer set search_path='' as $$
declare nm text; a uuid;
begin
  select full_name into nm from public.nurses where id=new.nurse_id;
  if new.status='pending' and (tg_op='INSERT' or old.status<>'pending') then
    for a in select id from public.profiles where role='admin' and active loop
      perform app.notify(a,'nurse.area',null,'Obszar do zatwierdzenia: '||nm,'Pielęgniarka wysłała zmianę obszaru pracy.','normalne',true,'area:'||new.id); end loop;
  end if;
  if new.status='approved' and (tg_op='INSERT' or old.status<>'approved') then
    if new.base_lat is not null then update public.nurses set base_lat=new.base_lat, base_lng=new.base_lng, base_label=new.base_label where id=new.nurse_id; end if;
    perform app.audit('pielegniarka.obszar_zatwierdzony',nm,jsonb_array_length(new.shapes)||' elementów obszaru');
  end if;
  return null;
end $$;
create trigger area_after after insert or update on public.nurse_areas for each row execute function app.area_after();

create or replace function app.avail_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare nextw date := (date_trunc('week',current_date)+interval '7 days')::date; a uuid; nm text;
begin
  if not app.nurse_admin() then
    if new.nurse_id is distinct from app.my_nurse() then raise exception 'Możesz zmieniać tylko własny terminarz' using errcode='42501'; end if;
    if tg_table_name='nurse_patterns' then
      if tg_op='INSERT' then
        if new.status<>'pending' then raise exception 'Zmiana terminarza czeka na zatwierdzenie' using errcode='42501'; end if;
        if new.valid_from<nextw then raise exception 'Zmiany obowiązują od następnego tygodnia (najwcześniej %)', to_char(nextw,'DD.MM.YYYY') using errcode='23514'; end if;
      elsif old.status='approved' then   -- zatwierdzony wzorzec: pielęgniarka może tylko poprosić o zakończenie
        if (new.dow,new.time_from,new.time_to,new.valid_from,new.valid_to,new.status) is distinct from (old.dow,old.time_from,old.time_to,old.valid_from,old.valid_to,old.status)
          then raise exception 'Zatwierdzony wzorzec: możesz tylko poprosić o jego zakończenie' using errcode='42501'; end if;
        if new.end_requested is not null and new.end_requested<nextw then raise exception 'Zakończenie najwcześniej od %', to_char(nextw,'DD.MM.YYYY') using errcode='23514'; end if;
      elsif new.status<>'pending' or new.valid_from<nextw then raise exception 'Zmiana terminarza czeka na zatwierdzenie (od następnego tygodnia)' using errcode='42501'; end if;
    else
      if new.status<>'pending' or (tg_op='UPDATE' and old.status<>'pending') then raise exception 'Wyjątek w terminarzu zatwierdza Administrator' using errcode='42501'; end if;
      if new.date_from<current_date then raise exception 'Wyjątek nie może dotyczyć przeszłości' using errcode='23514'; end if;
    end if;
    new.decided_by := null;
    if tg_op='INSERT' or (to_jsonb(new)->>'end_requested') is distinct from (to_jsonb(old)->>'end_requested') then
      select full_name into nm from public.nurses where id=new.nurse_id;
      for a in select id from public.profiles where role='admin' and active loop
        perform app.notify(a,'nurse.availability',null,'Terminarz do zatwierdzenia: '||nm,'Zmiana dostępności czeka na decyzję.','normalne',true,'avail:'||new.id||':'||coalesce(to_jsonb(new)->>'end_requested','')); end loop;
    end if;
  elsif new.status='approved' then
    new.decided_by := auth.uid();
  end if;
  return new;
end $$;
create trigger avail_guard before insert or update on public.nurse_patterns for each row execute function app.avail_guard();
create trigger avail_guard before insert or update on public.nurse_exceptions for each row execute function app.avail_guard();

create or replace function app.nurse_cfg_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare r jsonb := to_jsonb(coalesce(new,old));
begin
  perform app.audit('pielegniarki.'||tg_table_name, coalesce(r->>'full_name',r->>'name',r->>'city',r->>'kind',r->>'id',''), lower(tg_op));
  return null;
end $$;
do $$ declare t text; begin
  foreach t in array array['nurse_settings','nurse_services','nurses','nurse_documents','districts','price_zones','assignment_rules','assignment_pool'] loop
    execute format('create trigger cfg_audit after insert or update or delete on public.%I for each row execute function app.nurse_cfg_audit()',t);
  end loop;
end $$;

-- 5) API (CRM → supabase.rpc)
create or replace function public.nurse_tick() returns int language plpgsql security definer set search_path='' as $$
begin if app.perm('nurses')=0 then raise exception 'Brak dostępu' using errcode='42501'; end if; return app.expire_orders(); end $$;
create or replace function public.run_order_timeouts() returns int language sql security definer set search_path='' as $$ select app.expire_orders() $$;

create or replace function public.nurse_free_windows(p_nurse uuid, p_from date, p_days int default 7) returns table(s timestamptz, e timestamptz) language plpgsql stable security definer set search_path='' as $$
begin
  if not (app.nurse_admin() or p_nurse=app.my_nurse()) then raise exception 'Brak dostępu' using errcode='42501'; end if;
  return query select lower(r), upper(r) from unnest(app.free(p_nurse,p_from,p_from+greatest(1,least(p_days,92))-1)) r;
end $$;

-- wolne terminy dla adresu: obszar + wolne okno + usługa + limit; cena dojazdu wg strefy
create or replace function public.nurse_slots(p_lat float8, p_lng float8, p_service uuid, p_city text default null, p_from date default null, p_days int default null, p_road jsonb default '{}')
returns table(nurse_id uuid, slot_start timestamptz, distance_km numeric, zone_no smallint, price_travel numeric, payout numeric) language plpgsql stable security definer set search_path='' as $$
declare cfg public.nurse_settings := app.ncfg(); d1 date; d2 date; len interval; stp interval; n record; z record; dist numeric; r tstzrange; s timestamptz; dd public.districts; rl public.assignment_rules;
begin
  if not app.nurse_admin() then raise exception 'Brak dostępu' using errcode='42501'; end if;
  len := app.visit_len(p_service); if len is null then raise exception 'Nieznana usługa'; end if;
  stp := make_interval(mins=>cfg.slot_step_min);
  d1 := greatest(coalesce(p_from,current_date),current_date); d2 := d1+coalesce(p_days,cfg.horizon_days)-1;
  dd := app.district_of(p_lat,p_lng); rl := app.rule_for(coalesce(p_city,dd.city),dd.name);
  for n in select x.* from public.nurses x where x.status='aktywna' and x.base_lat is not null
      and exists(select 1 from public.nurse_service_links l where l.nurse_id=x.id and l.service_id=p_service) and app.nurse_covers(x.id,p_lat,p_lng) loop
    dist := coalesce((p_road->>n.id::text)::numeric, app.km(p_lat,p_lng,n.base_lat,n.base_lng));
    select * into z from app.zone(n.id,dist);
    for r in select x from unnest(app.free(n.id,d1,d2)) x loop
      s := app.align(lower(r),cfg.slot_step_min);
      while s+len <= upper(r) loop
        if s>now() and app.day_count(n.id,(s at time zone 'Europe/Warsaw')::date) < app.day_limit(n.id,rl.id) then
          nurse_id := n.id; slot_start := s; distance_km := dist; zone_no := z.zone_no; price_travel := z.price_client; payout := z.payout; return next;
        end if;
        s := s+stp;
      end loop;
    end loop;
  end loop;
end $$;

create or replace function public.create_nurse_order(p jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare o public.nurse_orders; sv public.nurse_services; dd public.districts; st timestamptz := (p->>'start_at')::timestamptz; pt numeric; rl public.assignment_rules;
begin
  if not app.nurse_admin() then raise exception 'Zlecenia zakłada Administrator / dyspozytor' using errcode='42501'; end if;
  perform app.expire_orders();
  select * into sv from public.nurse_services where id=(p->>'service_id')::uuid and active;
  if sv.id is null then raise exception 'Wybierz aktywną usługę'; end if;
  if st is null or st<=now() then raise exception 'Termin musi być w przyszłości'; end if;
  dd := app.district_of((p->>'lat')::float8,(p->>'lng')::float8);
  rl := app.rule_for(coalesce(nullif(p->>'city',''),dd.city),dd.name);
  insert into public.nurse_orders(client_name,client_phone,address,lat,lng,city,district,service_id,start_at,end_at,rule_id,road_km,price_service,note)
  values (trim(p->>'client_name'),coalesce(p->>'client_phone',''),trim(p->>'address'),(p->>'lat')::float8,(p->>'lng')::float8,coalesce(nullif(p->>'city',''),dd.city,''),dd.name,
    sv.id,st,st+make_interval(mins=>sv.duration_min+sv.buffer_min),rl.id,coalesce(p->'road_km','{}'),sv.price,coalesce(p->>'note',''))
  returning * into o;
  if not exists(select 1 from app.order_cands(o)) then raise exception 'Brak wolnej pielęgniarki w tym terminie — wybierz inny termin albo dodaj klienta do listy oczekujących' using errcode='23514'; end if;
  -- cena dojazdu dla klienta: ta pokazana przy wyborze terminu (najniższa strefa wśród dostępnych), albo wycena indywidualna
  select min(z.price_client) into pt from app.order_cands(o) c cross join lateral app.zone(c.nurse_id,c.dist) z;
  pt := coalesce(pt,(p->>'price_travel')::numeric);
  if pt is null then raise exception 'Adres poza strefami cennika — podaj indywidualną cenę dojazdu' using errcode='23514'; end if;
  update public.nurse_orders set price_travel=pt where id=o.id;
  perform app.audit('zlecenie.utworzone','#'||o.number,sv.name||' · '||to_char(st at time zone 'Europe/Warsaw','DD.MM.YYYY HH24:MI'));
  perform app.assign(o.id);
  return o.id;
end $$;

create or replace function public.dispatch_order(p_order uuid, p_nurse uuid) returns void language plpgsql security definer set search_path='' as $$
declare o public.nurse_orders;
begin
  if not app.nurse_admin() then raise exception 'Przydziela dyspozytor' using errcode='42501'; end if;
  perform app.expire_orders();
  select * into o from public.nurse_orders where id=p_order for update;
  if o.status<>'nowe' then raise exception 'Zlecenie nie czeka na przydział (status: %)', o.status; end if;
  if not exists(select 1 from app.order_cands(o,false) c where c.nurse_id=p_nurse) then
    raise exception 'Ta pielęgniarka nie spełnia warunków: obszar, wolny termin, usługa albo limit dzienny' using errcode='23514'; end if;
  perform app.propose(p_order,p_nurse,'dyspozytor');
  perform app.audit('zlecenie.dyspozytor','#'||o.number,(select full_name from public.nurses where id=p_nurse));
end $$;

-- dla dyspozytora: kto przechodzi twarde filtry (obszar, wolny termin, usługa, limit) i kto już odmówił
create or replace function public.order_candidates(p_order uuid) returns table(nurse_id uuid, distance_km numeric, attempted text) language plpgsql stable security definer set search_path='' as $$
declare o public.nurse_orders;
begin
  if not app.nurse_admin() then raise exception 'Brak dostępu' using errcode='42501'; end if;
  select * into o from public.nurse_orders where id=p_order;
  return query select c.nurse_id, c.dist, (select string_agg(a.result,', ') from public.order_attempts a where a.order_id=o.id and a.nurse_id=c.nurse_id)
    from app.order_cands(o,false) c order by c.dist;
end $$;

create or replace function public.respond_order(p_order uuid, p_accept boolean) returns void language plpgsql security definer set search_path='' as $$
declare o public.nurse_orders; me uuid := app.my_nurse();
begin
  perform app.expire_orders();
  select * into o from public.nurse_orders where id=p_order for update;
  if o.id is null or o.nurse_id is distinct from me or me is null then raise exception 'To nie jest Twoje zlecenie' using errcode='42501'; end if;
  if o.status<>'zaproponowane' then raise exception 'Zlecenie nie czeka już na Twoją decyzję (minął czas albo zostało przekazane)'; end if;
  update public.order_attempts set result=case when p_accept then 'przyjete' else 'odrzucone' end, decided_at=now() where order_id=o.id and nurse_id=me and result='zaproponowane';
  if p_accept then
    update public.nurse_orders set status='przyjete', accepted_at=now(), expires_at=null where id=o.id;
    perform app.audit('zlecenie.przyjete','#'||o.number,'');
  else
    update public.nurse_orders set status='nowe', nurse_id=null, proposed_at=null, expires_at=null, zone_no=null, distance_km=null, payout_travel=null where id=o.id;
    perform app.audit('zlecenie.odrzucone','#'||o.number,'przekazane dalej');
    perform app.assign(o.id);
  end if;
end $$;

-- statusy: przyjęte → w drodze → wykonane (pielęgniarka) → rozliczone (Administrator)
create or replace function public.advance_order(p_order uuid, p_status text) returns void language plpgsql security definer set search_path='' as $$
declare o public.nurse_orders; adm boolean := app.nurse_admin();
begin
  select * into o from public.nurse_orders where id=p_order for update;
  if o.id is null or not (adm or (o.nurse_id=app.my_nurse() and app.my_nurse() is not null)) then raise exception 'Brak dostępu' using errcode='42501'; end if;
  if not ((o.status,p_status) in (('przyjete','w_drodze'),('przyjete','wykonane'),('w_drodze','wykonane')) or (adm and o.status='wykonane' and p_status='rozliczone')) then
    raise exception 'Niedozwolona zmiana statusu: % → %', o.status, p_status; end if;
  update public.nurse_orders set status=p_status, done_at=case when p_status='wykonane' then now() else done_at end, settled_at=case when p_status='rozliczone' then now() else settled_at end where id=o.id;
  perform app.audit('zlecenie.status','#'||o.number,o.status||' → '||p_status);
end $$;

-- panel pielęgniarki: własne zlecenia i stawki (bez ceny dla klienta i marży)
create or replace function public.my_orders() returns table(id uuid, number bigint, client_name text, client_phone text, address text, lat float8, lng float8, service text, start_at timestamptz, end_at timestamptz,
  status text, expires_at timestamptz, zone_no smallint, distance_km numeric, payout_travel numeric, note text) language sql stable security definer set search_path='' as $$
  select o.id,o.number,o.client_name,o.client_phone,o.address,o.lat,o.lng,s.name,o.start_at,o.end_at,o.status,o.expires_at,o.zone_no,o.distance_km,o.payout_travel,o.note
  from public.nurse_orders o join public.nurse_services s on s.id=o.service_id where o.nurse_id=app.my_nurse() and app.my_nurse() is not null order by o.start_at
$$;
create or replace function public.my_rates() returns table(zone_no smallint, km_from numeric, km_to numeric, payout numeric) language sql stable security definer set search_path='' as $$
  with n as (select id, city from public.nurses where id=app.my_nurse()),
  t as (select z.* from public.price_zones z, n where z.city is not null and lower(z.city)=lower(n.city)),
  o as (select z.* from public.price_zones z, n where z.nurse_id=n.id)
  select coalesce(o.zone_no,t.zone_no), coalesce(o.km_from,t.km_from), coalesce(o.km_to,t.km_to), coalesce(o.payout,t.payout) from t full join o on o.zone_no=t.zone_no order by 1
$$;

-- 6) RLS
do $$ declare t text; begin
  foreach t in array array['nurse_settings','nurse_services','nurses','nurse_service_links','nurse_documents','districts','nurse_areas','nurse_patterns','nurse_exceptions',
    'price_zones','assignment_rules','assignment_pool','nurse_orders','order_attempts','nurse_waitlist'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon',t);
    execute format('revoke delete on public.%I from authenticated',t);
  end loop;
end $$;
create policy r on public.nurse_settings for select to authenticated using (app.perm('nurses')>0);
create policy u on public.nurse_settings for update to authenticated using (app.nurse_admin()) with check (app.nurse_admin());
create policy r on public.nurse_services for select to authenticated using (app.perm('nurses')>0);
create policy w on public.nurse_services for all to authenticated using (app.nurse_admin()) with check (app.nurse_admin());
create policy r on public.nurses for select to authenticated using (app.nurse_admin() or id=app.my_nurse());
create policy w on public.nurses for all to authenticated using (app.nurse_admin()) with check (app.nurse_admin());
create policy r on public.nurse_service_links for select to authenticated using (app.nurse_admin() or nurse_id=app.my_nurse());
create policy w on public.nurse_service_links for all to authenticated using (app.nurse_admin()) with check (app.nurse_admin());
create policy r on public.nurse_documents for select to authenticated using (app.nurse_admin());
create policy w on public.nurse_documents for all to authenticated using (app.nurse_admin()) with check (app.nurse_admin());
create policy r on public.districts for select to authenticated using (app.perm('nurses')>0);
create policy w on public.districts for all to authenticated using (app.nurse_admin()) with check (app.nurse_admin());
create policy r on public.nurse_areas for select to authenticated using (app.nurse_admin() or nurse_id=app.my_nurse());
create policy i on public.nurse_areas for insert to authenticated with check (app.nurse_admin() or nurse_id=app.my_nurse());
create policy u on public.nurse_areas for update to authenticated using (app.nurse_admin() or (nurse_id=app.my_nurse() and status in ('draft','pending')));
create policy r on public.nurse_patterns for select to authenticated using (app.nurse_admin() or nurse_id=app.my_nurse());
create policy i on public.nurse_patterns for insert to authenticated with check (app.nurse_admin() or nurse_id=app.my_nurse());
create policy u on public.nurse_patterns for update to authenticated using (app.nurse_admin() or nurse_id=app.my_nurse());
create policy d on public.nurse_patterns for delete to authenticated using (app.nurse_admin() or (nurse_id=app.my_nurse() and status='pending'));
create policy r on public.nurse_exceptions for select to authenticated using (app.nurse_admin() or nurse_id=app.my_nurse());
create policy i on public.nurse_exceptions for insert to authenticated with check (app.nurse_admin() or nurse_id=app.my_nurse());
create policy u on public.nurse_exceptions for update to authenticated using (app.nurse_admin() or (nurse_id=app.my_nurse() and status='pending'));
create policy d on public.nurse_exceptions for delete to authenticated using (app.nurse_admin() or (nurse_id=app.my_nurse() and status='pending'));
create policy w on public.price_zones for all to authenticated using (app.nurse_admin()) with check (app.nurse_admin());
create policy w on public.assignment_rules for all to authenticated using (app.nurse_admin()) with check (app.nurse_admin());
create policy w on public.assignment_pool for all to authenticated using (app.nurse_admin()) with check (app.nurse_admin());
create policy r on public.nurse_orders for select to authenticated using (app.nurse_admin());      -- pielęgniarka: tylko przez my_orders()
create policy r on public.order_attempts for select to authenticated using (app.nurse_admin());
create policy w on public.nurse_waitlist for all to authenticated using (app.nurse_admin()) with check (app.nurse_admin());
-- (nurse_orders, order_attempts: brak INSERT/UPDATE — tylko funkcje create/dispatch/respond/advance)
grant delete on public.nurse_service_links, public.districts, public.nurse_patterns, public.nurse_exceptions, public.price_zones, public.assignment_rules, public.assignment_pool, public.nurse_documents to authenticated;

-- dokumenty pielęgniarek (PWZ, OC, umowa): prywatny magazyn, ścieżka <id pielęgniarki>/<plik>
insert into storage.buckets(id,name,public,file_size_limit) values ('pielegniarki','pielegniarki',false,10485760) on conflict (id) do nothing;
drop policy if exists pielegniarki_read on storage.objects;
drop policy if exists pielegniarki_insert on storage.objects;
create policy pielegniarki_read on storage.objects for select to authenticated using (bucket_id='pielegniarki' and app.nurse_admin());
create policy pielegniarki_insert on storage.objects for insert to authenticated with check (bucket_id='pielegniarki' and app.nurse_admin());

revoke all on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.run_order_timeouts() from authenticated;
revoke execute on function public.run_deadline_reminders() from authenticated;
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated;
select app.audit('system.migracja','004_pielegniarki','zakładka Pielęgniarki: obszary, dostępność, strefy, przydział zleceń');
-- PO WDROŻENIU (raz, gdy włączony pg_cron): limit czasu na przyjęcie zlecenia sprawdzany co minutę
--   select cron.schedule('zlecenia-limit-czasu','* * * * *','select public.run_order_timeouts()');
