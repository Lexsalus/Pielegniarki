-- =====================================================================
--  CRM Kancelarii — schemat bazy dla Supabase (PostgreSQL)
--  Zgodny ze specyfikacją v1.1 (22.10.2026). Uruchom raz w SQL Editor.
--  Reguły dostępu egzekwuje baza (RLS + funkcje), nie interfejs.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create schema if not exists app;      -- funkcje pomocnicze (niewystawione w API)
create schema if not exists private;  -- sekrety (niewystawione w API)

-- ---------------------------------------------------------------------
-- 0. Sekrety: klucz do szyfrowania PESEL (generowany przy instalacji)
-- ---------------------------------------------------------------------
create table if not exists private.app_secrets(name text primary key, value text not null);
insert into private.app_secrets(name,value) values ('pesel_key', encode(extensions.gen_random_bytes(32),'hex')) on conflict do nothing;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Użytkownicy, role, uprawnienia (§9)
-- ---------------------------------------------------------------------
create table public.profiles(
  id uuid primary key references auth.users(id) on delete restrict,
  full_name text not null default '',
  email text not null default '',
  role text not null default 'office' check (role in ('admin','att','app','office','tech')),
  color text not null default '#7c5cff',
  active boolean not null default false,          -- nowe konto czeka na aktywację przez Administratora
  created_at timestamptz not null default now()
);
create table public.role_permissions(
  role text not null check (role in ('admin','att','app','office','tech')),
  perm text not null,
  level smallint not null check (level between 0 and 2),   -- 2 pełny, 1 ograniczony, 0 brak
  primary key(role,perm)
);
create table public.permission_overrides(
  user_id uuid not null references public.profiles(id),
  perm text not null,
  level smallint not null check (level between 0 and 2),
  valid_until date,
  reason text not null check (length(reason)>=5),
  granted_by uuid not null default auth.uid() references public.profiles(id),
  granted_at timestamptz not null default now(),
  primary key(user_id,perm)
);
create table public.emergency_access(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id),
  reason text not null check (length(reason)>=5),
  status text not null default 'pending' check (status in ('pending','granted','rejected')),
  decided_by uuid references public.profiles(id),
  valid_until timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. Kategorie, szablony procesów, numeracja (§1, §4)
-- ---------------------------------------------------------------------
create table public.case_categories(
  code text primary key check (code ~ '^[A-Z]{2,6}$'),
  name text not null,
  color_hex text not null default '#94a3b8',
  sort_order int not null default 100,
  process_template text not null default 'std' check (process_template in ('std','rst')),
  has_currency boolean not null default false,
  is_active boolean not null default true
);
create table public.currencies(code text primary key);
create table public.process_template_stages(
  id uuid primary key default gen_random_uuid(),
  template text not null check (template in ('std','rst')),
  sort_order int not null,
  name text not null,
  requires_approval boolean not null default true,
  is_conflict_check boolean not null default false,
  unique(template,sort_order)
);
create table public.case_counters(code text not null, year int not null, last int not null default 0, primary key(code,year));
create table public.holidays(
  id uuid primary key default gen_random_uuid(),
  day date,                 -- konkretna data (jednorazowo)
  month_day text check (month_day ~ '^\d{2}-\d{2}$'),  -- 'MM-DD' co roku
  name text not null,
  check ((day is null) <> (month_day is null))
);

-- ---------------------------------------------------------------------
-- 3. Klienci i sprawy (§3) — finanse sprawy w osobnej tabeli (osobne RLS)
-- ---------------------------------------------------------------------
create table public.clients(
  id uuid primary key default gen_random_uuid(),
  first_name text not null, last_name text not null,
  pesel_masked text,                       -- np. 800101*****
  address text, phone text, email text,
  created_at timestamptz not null default now()
);
create table private.client_pesel(client_id uuid primary key references public.clients(id), pesel_enc bytea not null);

create table public.leads(                 -- zgłoszenia z formularza „Co mi się należy”
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  category text not null check (length(category)<=8),
  calc jsonb not null default '{}'::jsonb check (pg_column_size(calc)<20000),
  client_name text not null check (length(client_name) between 2 and 120),
  phone text not null check (length(phone) between 6 and 30),
  email text check (length(email)<=120),
  message text check (length(message)<=2000),
  lang text check (length(lang)<=5),
  consent boolean not null check (consent),
  status text not null default 'nowe' check (status in ('nowe','przyjęte','odrzucone')),
  reason text,
  case_id uuid,
  handled_by uuid references public.profiles(id)
);

create table public.cases(
  id uuid primary key default gen_random_uuid(),
  case_number text unique,                 -- nadawany przez trigger: KOD-ROK-NNNN
  category_code text not null references public.case_categories(code) on update cascade,
  status text not null default 'open' check (status in ('open','suspended','closed','archived')),
  client_id uuid not null references public.clients(id),
  court text, court_signature text,
  subject_value numeric(14,2) default 0,
  currency text references public.currencies(code),
  source text,
  lead_id uuid references public.leads(id),
  lead_data jsonb,
  opened_at date not null default current_date,
  closed_at date,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.leads add constraint leads_case_fk foreign key (case_id) references public.cases(id);
create table public.case_finance(
  case_id uuid primary key references public.cases(id),
  initial_fee numeric(14,2) not null default 0,
  success_fee_pct numeric(5,2) not null default 0
);
create table public.case_members(
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),
  user_id uuid not null references public.profiles(id),
  role text not null check (role in ('lead','second','app','assist')),
  start_date date not null default current_date,
  end_date date,
  access_documents boolean not null default true,
  access_actions boolean not null default true,
  access_finance boolean not null default false,
  responsibility_scope text,
  can_approve boolean not null default false,
  power_of_attorney_document_id uuid,
  granted_by uuid not null default auth.uid() references public.profiles(id),
  granted_at timestamptz not null default now(),
  revoked_by uuid references public.profiles(id),
  revoked_at timestamptz
);
create unique index one_lead_per_case on public.case_members(case_id) where role='lead' and revoked_at is null;
create unique index one_active_membership on public.case_members(case_id,user_id) where revoked_at is null;

create table public.case_stages(
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),
  template_stage_id uuid references public.process_template_stages(id),
  sort_order int not null,
  name text not null,
  is_conflict_check boolean not null default false,
  status text not null default 'todo' check (status in ('todo','open','approved')),
  responsible_user_id uuid references public.profiles(id),
  conflict_result text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  unique(case_id,sort_order)
);

-- ---------------------------------------------------------------------
-- 4. Wpisy, wersje, korekty, dokumenty (§4, §7)
-- ---------------------------------------------------------------------
create table public.case_entries(
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),
  stage_id uuid not null references public.case_stages(id),
  type text not null check (type in ('notatka','czynność')),
  kind text not null default 'inna' check (kind in ('przygotowanie dokumentu','analiza','złożenie pisma','kontakt z klientem','rozprawa','rozliczenie','inna')),
  title text not null check (length(title) between 1 and 300),
  description text not null default '',
  performed_on date not null default current_date,
  performed_by uuid not null default auth.uid() references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  next_action_date date,
  locked boolean not null default false,
  edit_reason text,                                   -- uzasadnienie korekty (Administrator)
  deleted_at timestamptz, deleted_by uuid references public.profiles(id), delete_reason text,
  created_at timestamptz not null default now(),
  check (deleted_at is null or length(delete_reason)>=5)
);
create table public.entry_versions(
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.case_entries(id),
  title text, description text, kind text,
  edited_by uuid references public.profiles(id), edited_at timestamptz not null default now(), reason text
);
create table public.correction_requests(
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.case_entries(id),
  case_id uuid not null references public.cases(id),
  requested_by uuid not null default auth.uid() references public.profiles(id),
  reason text not null check (length(reason)>=5),
  proposed_title text not null, proposed_description text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references public.profiles(id), decided_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.documents(
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),
  stage_id uuid references public.case_stages(id),
  entry_id uuid references public.case_entries(id),
  name text not null,
  deleted_at timestamptz, deleted_by uuid references public.profiles(id), delete_reason text,
  created_at timestamptz not null default now(),
  check (deleted_at is null or length(delete_reason)>=5)
);
create table public.document_versions(
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id),
  version int not null,
  storage_path text not null,                 -- Supabase Storage, prywatny kubełek „akta”
  size_bytes bigint, sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid not null default auth.uid() references public.profiles(id),
  uploaded_at timestamptz not null default now(),
  unique(document_id,version)
);

-- ---------------------------------------------------------------------
-- 5. Terminy (§5)
-- ---------------------------------------------------------------------
create table public.deadlines(
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),
  type text not null check (type in ('statutory','court','internal')),
  title text not null,
  trigger_date date, term_length int, term_unit text check (term_unit in ('dni','tygodnie','miesiące','lata')),
  computed_due_date date,
  final_due_date date not null,
  due_time time,
  override_reason text,
  change_reason text,                          -- wymagane przy zmianie daty (trafia do wersji)
  responsible_user_id uuid not null references public.profiles(id),
  second_controller_id uuid references public.profiles(id),
  controller_confirmed_at timestamptz,
  status text not null default 'open' check (status in ('open','done')),
  completed_at date, completed_by uuid references public.profiles(id), proof_document_id uuid references public.documents(id),
  deleted_at timestamptz, deleted_by uuid references public.profiles(id), delete_reason text,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  check (type<>'statutory' or second_controller_id is not null),
  check (second_controller_id is null or second_controller_id<>responsible_user_id),
  check (computed_due_date is null or final_due_date=computed_due_date or length(override_reason)>=5),
  check (status<>'done' or (completed_at is not null and proof_document_id is not null)),
  check (deleted_at is null or length(delete_reason)>=5)
);
create table public.deadline_versions(
  id uuid primary key default gen_random_uuid(),
  deadline_id uuid not null references public.deadlines(id),
  old_date date, new_date date, reason text,
  changed_by uuid references public.profiles(id), changed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 6. Finanse (§8)
-- ---------------------------------------------------------------------
create table public.payments(
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),
  amount numeric(14,2) not null check (amount>0),
  currency text not null default 'PLN',
  received_on date not null default current_date,
  payer text, title text not null default 'Wpłata klienta',
  document_id uuid references public.documents(id),
  status text not null default 'potwierdzona' check (status in ('oczekuje','potwierdzona')),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.allocations(
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  case_id uuid not null references public.cases(id),
  recipient_type text not null check (recipient_type in ('sales','marketing','attorney','company','other')),
  recipient_user_id uuid references public.profiles(id),   -- dla pełnomocnika
  recipient_name text,                                      -- dla pozostałych
  amount numeric(14,2) not null check (amount>=0),
  status text not null default 'planned' check (status in ('planned','approved','due','paid')),
  allocation_date date not null default current_date,
  paid_on date,
  basis text, document_id uuid references public.documents(id),
  version int not null default 1,
  change_reason text,
  check (recipient_type<>'attorney' or recipient_user_id is not null),
  check (status<>'paid' or paid_on is not null)
);
create table public.allocation_versions(
  id uuid primary key default gen_random_uuid(),
  allocation_id uuid not null references public.allocations(id),
  version int, amount numeric(14,2), status text, reason text,
  changed_by uuid references public.profiles(id), changed_at timestamptz not null default now()
);
create table public.attorney_fees(
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),
  user_id uuid not null references public.profiles(id),
  base_amount numeric(14,2) not null default 0,
  sf_type text not null default 'percent' check (sf_type in ('percent','amount')),
  sf_value numeric(14,2) not null default 0,
  sf_basis text, sf_condition text,
  sf_status text not null default 'niespełniony' check (sf_status in ('niespełniony','spełniony')),
  version int not null default 1,
  unique(case_id,user_id)
);

-- ---------------------------------------------------------------------
-- 7. Historia, powiadomienia, audyt (§3, §10, §12)
-- ---------------------------------------------------------------------
create table public.case_history(
  id bigint generated always as identity primary key,
  case_id uuid not null references public.cases(id),
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  text text not null, field text, before_value text, after_value text
);
create table public.notifications(
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id),
  event_type text not null,
  case_id uuid references public.cases(id),
  title text not null, body text, link text,
  requires_action boolean not null default false,
  priority text not null default 'normalne' check (priority in ('pilne','wazne','normalne')),
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  read_at timestamptz, action_done_at timestamptz
);
create table public.audit_log(
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  action text not null, target text, details text,
  prev_hash text not null, hash text not null
);

-- =====================================================================
-- FUNKCJE POMOCNICZE (schemat app — używane w politykach RLS)
-- =====================================================================
create or replace function app.my_role() returns text language sql stable security definer set search_path='' as $$
  select role from public.profiles where id=auth.uid() and active
$$;
create or replace function app.is_admin() returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select role='admin' from public.profiles where id=auth.uid() and active),false)
$$;
create or replace function app.perm(p text) returns int language sql stable security definer set search_path='' as $$
  select case when not exists(select 1 from public.profiles where id=auth.uid() and active) then 0 else coalesce(
    (select level from public.permission_overrides o where o.user_id=auth.uid() and o.perm=p and (o.valid_until is null or o.valid_until>=current_date)),
    (select level from public.role_permissions r join public.profiles u on u.role=r.role where u.id=auth.uid() and r.perm=p),0) end
$$;
create or replace function app.emergency_active() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.emergency_access e where e.user_id=auth.uid() and e.status='granted' and e.valid_until>now())
$$;
create or replace function app.member(cid uuid) returns public.case_members language sql stable security definer set search_path='' as $$
  select m.* from public.case_members m where m.case_id=cid and m.user_id=auth.uid() and m.revoked_at is null and (m.end_date is null or m.end_date>=current_date) limit 1
$$;
create or replace function app.can_case(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
  select case
    when app.is_admin() or app.perm('cases_all')=2 then true
    when app.my_role()='tech' then app.emergency_active()
    else (app.member(cid)).id is not null end
$$;
create or replace function app.case_flag(cid uuid, flag text) returns boolean language sql stable security definer set search_path='' as $$
  select case when app.is_admin() then true else coalesce((
    select case flag
      when 'documents' then m.access_documents and app.perm('documents')>0
      when 'actions'   then m.access_actions and app.perm('entries')>0
      when 'finance'   then m.access_finance
      when 'approve'   then m.can_approve
      when 'lead'      then m.role='lead' end
    from public.case_members m where m.case_id=cid and m.user_id=auth.uid() and m.revoked_at is null and (m.end_date is null or m.end_date>=current_date) limit 1),false) end
$$;
create or replace function app.case_number_of(cid uuid) returns text language sql stable security definer set search_path='' as $$
  select case_number from public.cases where id=cid
$$;

-- Dziennik audytu: dopisywanie z łańcuchem skrótów
create or replace function app.audit(p_action text, p_target text, p_details text) returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.audit_log(user_id,action,target,details,prev_hash,hash) values (auth.uid(),p_action,coalesce(p_target,''),coalesce(p_details,''),'','');
end $$;
create or replace function app.audit_chain() returns trigger language plpgsql security definer set search_path='' as $$
declare prev text;
begin
  perform pg_advisory_xact_lock(424242);
  select hash into prev from public.audit_log order by id desc limit 1;
  new.prev_hash:=coalesce(prev,repeat('0',64));
  new.at:=coalesce(new.at,now());
  new.hash:=encode(sha256(convert_to(new.prev_hash||'|'||new.id||'|'||to_char(new.at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'|'||coalesce(new.user_id::text,'')||'|'||new.action||'|'||new.target||'|'||new.details,'UTF8')),'hex');
  return new;
end $$;
create trigger audit_chain before insert on public.audit_log for each row execute function app.audit_chain();
create or replace function app.audit_readonly() returns trigger language plpgsql as $$
begin raise exception 'Dziennik audytu przyjmuje tylko dopisywanie (UPDATE/DELETE zabronione)' using errcode='42501'; end $$;
create trigger audit_no_update before update or delete on public.audit_log for each row execute function app.audit_readonly();
create trigger audit_no_truncate before truncate on public.audit_log for each statement execute function app.audit_readonly();
-- weryfikacja łańcucha (Administrator)
create or replace function public.verify_audit_chain() returns table(ok boolean, checked bigint, broken_at bigint) language plpgsql stable security definer set search_path='' as $$
declare r record; prev text:=repeat('0',64); n bigint:=0;
begin
  if app.perm('audit')=0 then raise exception 'Brak uprawnień' using errcode='42501'; end if;
  for r in select * from public.audit_log order by id loop
    n:=n+1;
    if r.prev_hash<>prev or r.hash<>encode(sha256(convert_to(r.prev_hash||'|'||r.id||'|'||to_char(r.at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'|'||coalesce(r.user_id::text,'')||'|'||r.action||'|'||r.target||'|'||r.details,'UTF8')),'hex') then
      return query select false,n,r.id; return; end if;
    prev:=r.hash;
  end loop;
  return query select true,n,null::bigint;
end $$;

create or replace function app.hist(cid uuid, txt text, fld text default null, b text default null, a text default null) returns void language sql security definer set search_path='' as $$
  insert into public.case_history(case_id,text,field,before_value,after_value) values (cid,txt,fld,b,a)
$$;
create or replace function app.notify(rcp uuid, ev text, cid uuid, ttl text, bdy text, prio text default 'normalne', act boolean default false, dkey text default null) returns void language plpgsql security definer set search_path='' as $$
begin
  if rcp is null then return; end if;
  insert into public.notifications(recipient_id,event_type,case_id,title,body,priority,requires_action,dedupe_key,link)
  values (rcp,ev,cid,ttl,bdy,prio,act,dkey,case when cid is null then null else '#/sprawa/'||cid end) on conflict (dedupe_key) do nothing;
end $$;

-- =====================================================================
-- TRIGGERY LOGIKI BIZNESOWEJ
-- =====================================================================
-- nowe konto w auth.users → profil (nieaktywny do zatwierdzenia przez Administratora)
create or replace function app.on_auth_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,email,full_name) values (new.id,coalesce(new.email,''),coalesce(new.raw_user_meta_data->>'full_name',''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function app.on_auth_user();

-- numeracja KOD-ROK-NNNN (atomowo, bez duplikatów) + etapy z szablonu
create or replace function app.case_before_insert() returns trigger language plpgsql security definer set search_path='' as $$
declare y int:=extract(year from coalesce(new.opened_at,current_date)); n int;
begin
  insert into public.case_counters(code,year,last) values (new.category_code,y,1)
    on conflict (code,year) do update set last=public.case_counters.last+1 returning last into n;
  new.case_number:=new.category_code||'-'||y||'-'||lpad(n::text,4,'0');
  return new;
end $$;
create trigger case_number before insert on public.cases for each row execute function app.case_before_insert();
create or replace function app.case_after_insert() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.case_stages(case_id,template_stage_id,sort_order,name,is_conflict_check,status)
  select new.id,s.id,s.sort_order,s.name,s.is_conflict_check,case when s.sort_order=1 then 'open' else 'todo' end
  from public.process_template_stages s join public.case_categories c on c.process_template=s.template where c.code=new.category_code order by s.sort_order;
  insert into public.case_finance(case_id) values (new.id) on conflict do nothing;
  perform app.hist(new.id,'Założono sprawę '||new.case_number);
  perform app.audit('sprawa.utworzona',new.case_number,'kategoria '||new.category_code);
  return new;
end $$;
create trigger case_stages_init after insert on public.cases for each row execute function app.case_after_insert();
-- zmiana kategorii / statusu: tylko Administrator; numer bez zmian
create or replace function app.case_before_update() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.case_number is distinct from old.case_number then raise exception 'Numer sprawy jest niezmienny' using errcode='42501'; end if;
  if (new.category_code is distinct from old.category_code or new.status is distinct from old.status) and not app.is_admin() then
    raise exception 'Zmiana kategorii lub statusu: tylko Administrator' using errcode='42501'; end if;
  if new.category_code is distinct from old.category_code then perform app.hist(new.id,'Zmiana kategorii','Kategoria',old.category_code,new.category_code); end if;
  if new.status is distinct from old.status then perform app.hist(new.id,'Zmiana statusu','Status',old.status,new.status);
    if new.status='closed' then new.closed_at:=coalesce(new.closed_at,current_date); end if; end if;
  if new.court is distinct from old.court then perform app.hist(new.id,'Zmiana: sąd','Sąd',old.court,new.court); end if;
  if new.court_signature is distinct from old.court_signature then perform app.hist(new.id,'Zmiana: sygnatura','Sygnatura',old.court_signature,new.court_signature); end if;
  if new.subject_value is distinct from old.subject_value then perform app.hist(new.id,'Zmiana: wartość sporu','Wartość sporu',old.subject_value::text,new.subject_value::text); end if;
  return new;
end $$;
create trigger case_update before update on public.cases for each row execute function app.case_before_update();
-- historia zmian danych klienta (przed / po)
create or replace function app.client_history() returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid; f text; o jsonb:=to_jsonb(old); n jsonb:=to_jsonb(new);
begin
  for cid in select id from public.cases where client_id=new.id loop
    foreach f in array array['first_name','last_name','address','phone','email'] loop
      if o->>f is distinct from n->>f then perform app.hist(cid,'Zmiana danych klienta',f,o->>f,n->>f); end if;
    end loop;
  end loop;
  perform app.audit('klient.zmiana',new.last_name,'');
  return new;
end $$;
create trigger client_hist after update on public.clients for each row execute function app.client_history();

-- zespół sprawy: historia, audyt, powiadomienia
create or replace function app.member_change() returns trigger language plpgsql security definer set search_path='' as $$
declare nm text:=(select full_name from public.profiles where id=new.user_id);
        scope text:=concat_ws(', ',case when new.access_documents then 'dokumenty' end,case when new.access_actions then 'czynności' end,case when new.access_finance then 'finanse' end);
        lead uuid:=(select user_id from public.case_members where case_id=new.case_id and role='lead' and revoked_at is null);
begin
  if tg_op='INSERT' then
    perform app.hist(new.case_id,'Administrator dołączył: '||nm||' ('||new.role||')');
    perform app.hist(new.case_id,'Nadano zakres: '||coalesce(nullif(scope,''),'brak')||case when new.access_finance then '' else ' (bez finansów)' end);
    perform app.audit('zespol.dolaczono',app.case_number_of(new.case_id),nm||' · '||scope);
    perform app.notify(new.user_id,'team.change',new.case_id,'Dołączono Cię do sprawy '||app.case_number_of(new.case_id),scope);
    if lead is distinct from new.user_id then perform app.notify(lead,'team.change',new.case_id,'Zmiana zespołu sprawy','Dodano: '||nm); end if;
  elsif new.revoked_at is not null and old.revoked_at is null then
    perform app.hist(new.case_id,'Odebrano dostęp: '||nm);
    perform app.audit('zespol.odebrano',app.case_number_of(new.case_id),nm);
    perform app.notify(lead,'team.change',new.case_id,'Zmiana zespołu sprawy','Odebrano dostęp: '||nm);
  else
    perform app.hist(new.case_id,'Zmieniono zakres: '||nm||' → '||coalesce(nullif(scope,''),'brak'));
    perform app.audit('zespol.zakres',app.case_number_of(new.case_id),nm||' · '||scope);
  end if;
  return new;
end $$;
create trigger member_change after insert or update on public.case_members for each row execute function app.member_change();
create or replace function app.member_guard() returns trigger language plpgsql as $$
begin
  if tg_op='UPDATE' and old.role='lead' and new.role<>'lead' and old.revoked_at is null then
    raise exception 'Sprawa musi mieć dokładnie jednego pełnomocnika prowadzącego' using errcode='23514'; end if;
  if tg_op='UPDATE' and new.revoked_at is not null and old.role='lead' then
    raise exception 'Najpierw wyznacz innego pełnomocnika prowadzącego' using errcode='23514'; end if;
  return new;
end $$;
create trigger member_guard before update on public.case_members for each row execute function app.member_guard();

-- wpisy: blokada po zatwierdzeniu, wersje przy edycji, soft delete tylko Administrator
create or replace function app.entry_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare st text:=(select status from public.case_stages where id=new.stage_id);
begin
  if tg_op='INSERT' then
    if st='approved' and not app.is_admin() then raise exception 'Etap zatwierdzony — nie można dodawać wpisów' using errcode='42501'; end if;
    if st='todo' then raise exception 'Etap jeszcze nie jest otwarty' using errcode='23514'; end if;
    new.performed_by:=coalesce(auth.uid(),new.performed_by); new.locked:=false;
    perform app.hist(new.case_id,'Dodano wpis: '||new.title);
    perform app.audit('wpis.dodany',app.case_number_of(new.case_id),new.title);
    return new;
  end if;
  if not app.is_admin() then
    if new.deleted_at is not null or old.deleted_at is not null then raise exception 'Usuwa tylko Administrator' using errcode='42501'; end if;
    if new.performed_by<>old.performed_by or new.case_id<>old.case_id or new.stage_id<>old.stage_id or new.approved_by is distinct from old.approved_by then raise exception 'Niedozwolona zmiana' using errcode='42501'; end if;
    if (new.title,new.description,new.kind,new.performed_on,new.next_action_date,new.type) is distinct from (old.title,old.description,old.kind,old.performed_on,old.next_action_date,old.type) then
      if old.locked or st='approved' then raise exception 'Wpis zatwierdzony — zmiana tylko przez wniosek o korektę' using errcode='42501'; end if;
      if old.performed_by<>auth.uid() then raise exception 'Edytować można tylko własny wpis' using errcode='42501'; end if;
    end if;
    if new.locked<>old.locked then
      if old.locked then raise exception 'Odblokować wpis może tylko Administrator' using errcode='42501'; end if;
      if not app.case_flag(new.case_id,'approve') then raise exception 'Brak uprawnienia do zatwierdzania' using errcode='42501'; end if;
    end if;
  end if;
  if (old.locked or st='approved') and app.is_admin() and new.deleted_at is null and (new.title,new.description) is distinct from (old.title,old.description) and length(coalesce(new.edit_reason,''))<5 then
    raise exception 'Korekta zatwierdzonego wpisu wymaga uzasadnienia (edit_reason)' using errcode='23514'; end if;
  if (new.title,new.description,new.kind) is distinct from (old.title,old.description,old.kind) then
    insert into public.entry_versions(entry_id,title,description,kind,edited_by,reason) values (old.id,old.title,old.description,old.kind,auth.uid(),new.edit_reason);
    perform app.hist(new.case_id,case when old.locked then 'Korekta wpisu (Administrator): ' else 'Edycja wpisu: ' end||new.title);
    perform app.audit('wpis.edycja',app.case_number_of(new.case_id),new.title||coalesce(' · '||new.edit_reason,''));
  end if;
  if new.locked and not old.locked then new.approved_by:=auth.uid(); new.approved_at:=now();
    perform app.hist(new.case_id,'Zatwierdzono wpis: '||new.title); perform app.audit('wpis.zatwierdzony',app.case_number_of(new.case_id),new.title); end if;
  if new.deleted_at is not null and old.deleted_at is null then new.deleted_by:=auth.uid();
    perform app.hist(new.case_id,'Usunięto wpis (soft delete): '||old.title||' — '||new.delete_reason);
    perform app.audit('wpis.usuniety',app.case_number_of(new.case_id),'„'||old.title||'” · treść: '||left(old.description,500)||' · powód: '||new.delete_reason); end if;
  new.edit_reason:=null;
  return new;
end $$;
create trigger entry_guard before insert or update on public.case_entries for each row execute function app.entry_guard();
create or replace function app.entry_next_action() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.next_action_date is not null and (tg_op='INSERT' or new.next_action_date is distinct from old.next_action_date) then
    insert into public.deadlines(case_id,type,title,final_due_date,responsible_user_id,created_by)
    values (new.case_id,'internal','Kolejna czynność: '||new.title,new.next_action_date,new.performed_by,auth.uid());
  end if;
  return new;
end $$;
create trigger entry_next after insert or update on public.case_entries for each row execute function app.entry_next_action();

-- dokumenty: wersje numerowane, soft delete
create or replace function app.doc_version() returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid; nm text;
begin
  select case_id,name into cid,nm from public.documents where id=new.document_id;
  new.version:=coalesce((select max(version) from public.document_versions where document_id=new.document_id),0)+1;
  new.uploaded_by:=coalesce(auth.uid(),new.uploaded_by);
  perform app.hist(cid,case when new.version=1 then 'Dodano dokument: ' else 'Nowa wersja dokumentu: ' end||nm||' (v'||new.version||')');
  perform app.audit('dokument.wersja',app.case_number_of(cid),nm||' v'||new.version||' · '||left(new.sha256,16));
  return new;
end $$;
create trigger doc_version before insert on public.document_versions for each row execute function app.doc_version();
create or replace function app.doc_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    if not app.is_admin() then raise exception 'Usuwa tylko Administrator' using errcode='42501'; end if;
    new.deleted_by:=auth.uid();
    perform app.hist(new.case_id,'Usunięto dokument (soft delete): '||old.name||' — '||new.delete_reason);
    perform app.audit('dokument.usuniety',app.case_number_of(new.case_id),old.name||' · '||new.delete_reason);
  end if;
  return new;
end $$;
create trigger doc_guard before update on public.documents for each row execute function app.doc_guard();

-- terminy: druga osoba, wersje dat, zamykanie z uprawnieniem, soft delete
create or replace function app.deadline_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    perform app.hist(new.case_id,'Nowy termin: '||new.title||' — '||to_char(new.final_due_date,'DD.MM.YYYY')||coalesce(' (nadpisano: '||new.override_reason||')',''));
    perform app.audit('termin.dodany',app.case_number_of(new.case_id),new.title||' · '||new.final_due_date);
    perform app.notify(new.responsible_user_id,'deadline.new',new.case_id,'Nowy termin: '||new.title,app.case_number_of(new.case_id)||' · '||to_char(new.final_due_date,'DD.MM.YYYY'));
    perform app.notify(new.second_controller_id,'deadline.new',new.case_id,'Potwierdź datę terminu: '||new.title,app.case_number_of(new.case_id),'wazne',true);
    return new;
  end if;
  if new.final_due_date is distinct from old.final_due_date then
    if length(coalesce(new.change_reason,''))<5 then raise exception 'Zmiana daty terminu wymaga uzasadnienia (change_reason)' using errcode='23514'; end if;
    insert into public.deadline_versions(deadline_id,old_date,new_date,reason,changed_by) values (old.id,old.final_due_date,new.final_due_date,new.change_reason,auth.uid());
    perform app.hist(new.case_id,'Zmiana daty terminu: '||new.title||' ('||new.change_reason||')','Termin',old.final_due_date::text,new.final_due_date::text);
    perform app.audit('termin.zmiana_daty',app.case_number_of(new.case_id),new.title||' → '||new.final_due_date||' · '||new.change_reason);
    if new.type='statutory' then new.controller_confirmed_at:=null; end if;
  end if;
  if new.controller_confirmed_at is not null and old.controller_confirmed_at is null and auth.uid() is distinct from new.second_controller_id then
    raise exception 'Datę potwierdza wyłącznie wyznaczony kontroler' using errcode='42501'; end if;
  if new.status='done' and old.status<>'done' then
    if new.type<>'internal' and app.perm('deadlines_close')=0 and not app.is_admin() then raise exception 'Zamykanie terminów procesowych wymaga uprawnienia' using errcode='42501'; end if;
    new.completed_by:=auth.uid();
    update public.notifications set action_done_at=now() where dedupe_key like old.id::text||':%';
    perform app.hist(new.case_id,'Wykonano termin: '||new.title);
    perform app.audit('termin.wykonany',app.case_number_of(new.case_id),new.title);
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    if not app.is_admin() then raise exception 'Usuwa tylko Administrator' using errcode='42501'; end if;
    new.deleted_by:=auth.uid(); perform app.hist(new.case_id,'Usunięto termin: '||old.title||' — '||new.delete_reason);
    perform app.audit('termin.usuniety',app.case_number_of(new.case_id),old.title||' · '||new.delete_reason);
  end if;
  new.change_reason:=null;
  return new;
end $$;
create trigger deadline_guard before insert or update on public.deadlines for each row execute function app.deadline_guard();

-- finanse: bilans 0 zł przed zatwierdzeniem, wersje zmian
create or replace function app.allocation_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare total numeric; others numeric;
begin
  select amount into total from public.payments where id=new.payment_id;
  select coalesce(sum(amount),0) into others from public.allocations where payment_id=new.payment_id and id<>new.id;
  if others+new.amount>total then raise exception 'Suma podziału przekracza kwotę wpływu' using errcode='23514'; end if;
  if new.status<>'planned' and others+new.amount<>total then raise exception 'Status inny niż „planowane” wymaga pełnego podziału (Bilans 0 zł)' using errcode='23514'; end if;
  if tg_op='UPDATE' and (new.amount,new.status,new.recipient_type,new.recipient_user_id) is distinct from (old.amount,old.status,old.recipient_type,old.recipient_user_id) then
    if old.status<>'planned' and length(coalesce(new.change_reason,''))<5 and new.amount<>old.amount then raise exception 'Zmiana zatwierdzonego podziału wymaga uzasadnienia' using errcode='23514'; end if;
    insert into public.allocation_versions(allocation_id,version,amount,status,reason,changed_by) values (old.id,old.version,old.amount,old.status,coalesce(new.change_reason,'zmiana statusu'),auth.uid());
    new.version:=old.version+1;
  end if;
  perform app.audit(case when tg_op='INSERT' then 'finanse.podzial' else 'finanse.podzial_zmiana' end,app.case_number_of(new.case_id),new.recipient_type||': '||new.amount||' ('||new.status||')'||coalesce(' · '||new.change_reason,''));
  if new.recipient_type='attorney' then perform app.notify(new.recipient_user_id,'fee.change',new.case_id,'Zmiana rozliczenia',app.case_number_of(new.case_id)||' · '||new.amount||' zł'); end if;
  new.change_reason:=null;
  return new;
end $$;
create trigger allocation_guard before insert or update on public.allocations for each row execute function app.allocation_guard();
create or replace function app.payment_after() returns trigger language plpgsql security definer set search_path='' as $$
declare r record;
begin
  perform app.hist(new.case_id,'Nowa wpłata: '||new.amount||' zł ('||new.title||')');
  perform app.audit('finanse.wplyw',app.case_number_of(new.case_id),new.amount||' zł');
  for r in select p.id from public.profiles p where p.active and (p.role='admin' or exists(select 1 from public.permission_overrides o where o.user_id=p.id and o.perm='initial_fee' and o.level>0)) loop
    perform app.notify(r.id,'payment.new',new.case_id,'Nowa wpłata klienta: '||new.amount||' zł',app.case_number_of(new.case_id));
  end loop;
  return new;
end $$;
create trigger payment_after after insert on public.payments for each row execute function app.payment_after();

-- uprawnienia: audyt każdego nadania / odebrania
create or replace function app.override_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then perform app.audit('uprawnienia.zmiana',(select full_name from public.profiles where id=old.user_id),old.perm||': wg roli'); return old; end if;
  perform app.audit('uprawnienia.zmiana',(select full_name from public.profiles where id=new.user_id),new.perm||' → '||new.level||coalesce(' do '||new.valid_until,' bezterminowo')||' · '||new.reason);
  perform app.notify(new.user_id,'perm.change',null,'Zmieniono Twoje uprawnienia',new.perm);
  return new;
end $$;
create trigger override_audit after insert or update or delete on public.permission_overrides for each row execute function app.override_audit();
create or replace function app.profile_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (old.role='admin' and old.active) and (new.role<>'admin' or not new.active)
     and (select count(*) from public.profiles where role='admin' and active and id<>old.id)=0 then
    raise exception 'W systemie musi zostać co najmniej jeden aktywny Administrator' using errcode='23514'; end if;
  if (new.role,new.active) is distinct from (old.role,old.active) then perform app.audit('uzytkownik.zmiana',new.full_name,'rola: '||new.role||', aktywny: '||new.active); end if;
  return new;
end $$;
create trigger profile_guard before update on public.profiles for each row execute function app.profile_guard();

-- =====================================================================
-- FUNKCJE API (wywoływane z CRM przez supabase.rpc)
-- =====================================================================
create or replace function public.create_case(p_category text, p_first text, p_last text, p_lead uuid,
  p_pesel text default null, p_phone text default null, p_email text default null, p_address text default null,
  p_value numeric default 0, p_initial_fee numeric default 0, p_success_fee numeric default 0, p_currency text default null, p_lead_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare cl uuid; cs uuid; ld public.leads;
begin
  if not (app.is_admin() or app.my_role()='office') then raise exception 'Zakładanie spraw: Administrator lub Biuro' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles where id=p_lead and role='att' and active) then raise exception 'Pełnomocnik prowadzący musi mieć rolę Pełnomocnik' using errcode='23514'; end if;
  insert into public.clients(first_name,last_name,phone,email,address,pesel_masked) values (p_first,p_last,p_phone,p_email,p_address,case when p_pesel is not null then left(p_pesel,6)||'*****' end) returning id into cl;
  if p_pesel is not null then
    if p_pesel !~ '^\d{11}$' then raise exception 'PESEL: 11 cyfr' using errcode='23514'; end if;
    insert into private.client_pesel values (cl, extensions.pgp_sym_encrypt(p_pesel,(select value from private.app_secrets where name='pesel_key')));
  end if;
  if p_lead_id is not null then select * into ld from public.leads where id=p_lead_id; end if;
  insert into public.cases(category_code,client_id,subject_value,currency,source,lead_id,lead_data)
    values (p_category,cl,coalesce(p_value,0),p_currency,case when p_lead_id is null then 'Wprowadzona ręcznie' else 'Formularz na stronie' end,p_lead_id,ld.calc) returning id into cs;
  update public.case_finance set initial_fee=coalesce(p_initial_fee,0),success_fee_pct=coalesce(p_success_fee,0) where case_id=cs;
  insert into public.case_members(case_id,user_id,role,access_documents,access_actions,access_finance,can_approve,responsibility_scope) values (cs,p_lead,'lead',true,true,true,true,'Prowadzenie sprawy');
  insert into public.attorney_fees(case_id,user_id) values (cs,p_lead);
  if p_lead_id is not null then update public.leads set status='przyjęte',case_id=cs,handled_by=auth.uid() where id=p_lead_id; end if;
  return cs;
end $$;

create or replace function public.reveal_pesel(p_client uuid) returns text language plpgsql security definer set search_path='' as $$
declare cid uuid; v text;
begin
  select c.id into cid from public.cases c where c.client_id=p_client and app.can_case(c.id) limit 1;
  if cid is null or app.perm('pesel')=0 then raise exception 'Brak uprawnienia do pełnego PESEL' using errcode='42501'; end if;
  select extensions.pgp_sym_decrypt(pesel_enc,(select value from private.app_secrets where name='pesel_key')) into v from private.client_pesel where client_id=p_client;
  perform app.audit('pesel.odsloniecie',app.case_number_of(cid),'Wyświetlono pełny PESEL klienta');
  return v;
end $$;

create or replace function public.approve_stage(p_stage uuid, p_conflict_result text default null) returns void language plpgsql security definer set search_path='' as $$
declare s public.case_stages;
begin
  select * into s from public.case_stages where id=p_stage for update;
  if s.id is null or not app.can_case(s.case_id) then raise exception 'Brak dostępu' using errcode='42501'; end if;
  if not (app.is_admin() or app.case_flag(s.case_id,'approve')) then raise exception 'Brak uprawnienia do zatwierdzania etapu' using errcode='42501'; end if;
  if s.status<>'open' then raise exception 'Etap nie jest otwarty' using errcode='23514'; end if;
  if s.is_conflict_check and coalesce(p_conflict_result,'') not like 'brak konfliktu%' then
    if p_conflict_result is not null then perform app.hist(s.case_id,'Wykryto konflikt interesów: '||p_conflict_result); perform app.audit('konflikt.wykryty',app.case_number_of(s.case_id),p_conflict_result); end if;
    raise exception 'Bez wyniku „brak konfliktu” nie można przejść dalej' using errcode='23514'; end if;
  update public.case_entries set locked=true where stage_id=p_stage and deleted_at is null and not locked;
  update public.case_stages set status='approved',approved_by=auth.uid(),approved_at=now(),conflict_result=coalesce(p_conflict_result,conflict_result) where id=p_stage;
  update public.case_stages set status='open' where case_id=s.case_id and sort_order=s.sort_order+1 and status='todo';
  perform app.hist(s.case_id,'Zatwierdzono etap '||s.sort_order||': '||s.name);
  perform app.audit('etap.zatwierdzony',app.case_number_of(s.case_id),s.name);
end $$;

create or replace function public.decide_correction(p_id uuid, p_approve boolean) returns void language plpgsql security definer set search_path='' as $$
declare k public.correction_requests;
begin
  if not app.is_admin() then raise exception 'Decyzja o korekcie: tylko Administrator' using errcode='42501'; end if;
  select * into k from public.correction_requests where id=p_id and status='pending' for update;
  if k.id is null then raise exception 'Brak wniosku' using errcode='23514'; end if;
  update public.correction_requests set status=case when p_approve then 'approved' else 'rejected' end,decided_by=auth.uid(),decided_at=now() where id=p_id;
  if p_approve then update public.case_entries set title=k.proposed_title,description=k.proposed_description,edit_reason='Korekta zatwierdzona: '||k.reason where id=k.entry_id; end if;
  perform app.notify(k.requested_by,'correction.decided',k.case_id,'Korekta '||case when p_approve then 'zatwierdzona' else 'odrzucona' end,app.case_number_of(k.case_id));
  perform app.audit('korekta.decyzja',app.case_number_of(k.case_id),case when p_approve then 'zatwierdzona' else 'odrzucona' end||' · '||k.reason);
end $$;
create or replace function app.correction_after() returns trigger language plpgsql security definer set search_path='' as $$
declare r record;
begin
  for r in select id from public.profiles where role='admin' and active loop
    perform app.notify(r.id,'correction.request',new.case_id,'Wniosek o korektę zatwierdzonego wpisu',app.case_number_of(new.case_id)||' · '||new.reason,'wazne',true);
  end loop;
  perform app.hist(new.case_id,'Wniosek o korektę: '||new.reason); perform app.audit('korekta.wniosek',app.case_number_of(new.case_id),new.reason);
  return new;
end $$;
create trigger correction_after after insert on public.correction_requests for each row execute function app.correction_after();

-- odczyt akt do audytu (wywoływane przy otwarciu karty sprawy)
create or replace function public.log_case_open(p_case uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if not app.can_case(p_case) then
    perform app.audit('odmowa.dostepu',coalesce(app.case_number_of(p_case),p_case::text),'Próba otwarcia karty sprawy');
    raise exception 'Brak dostępu do sprawy' using errcode='42501'; end if;
  perform app.audit('odczyt.akt',app.case_number_of(p_case),'Otwarcie karty sprawy');
end $$;

-- przypomnienia o terminach (§5) — uruchamiane co 15 minut przez pg_cron
create or replace function public.run_deadline_reminders() returns int language plpgsql security definer set search_path='' as $$
declare d record; n int; k int; lab text; prio text; lead uuid; a record; cnt int:=0;
begin
  for d in select * from public.deadlines where status='open' and deleted_at is null loop
    n:=d.final_due_date-current_date;
    lead:=(select user_id from public.case_members where case_id=d.case_id and role='lead' and revoked_at is null);
    if n>=0 then
      k:=case when n<=0 then 0 when n<=1 then 1 when n<=3 then 3 when n<=7 then 7 when n<=14 then 14 else null end;
      if k is not null then
        lab:='T-'||k; prio:=case when k<=1 then 'pilne' when k=3 then 'wazne' else 'normalne' end;
        perform app.notify(d.responsible_user_id,'deadline.approaching',d.case_id,case when k=0 then 'Dziś mija termin: ' else 'Zbliża się termin: ' end||d.title,app.case_number_of(d.case_id)||' · '||lab,prio,k<=1,d.id||':'||lab||':'||d.responsible_user_id);
        if k<=7 then perform app.notify(d.second_controller_id,'deadline.approaching',d.case_id,'Zbliża się termin: '||d.title,app.case_number_of(d.case_id)||' · '||lab,prio,k<=1,d.id||':'||lab||':'||d.second_controller_id); end if;
        if k<=3 then perform app.notify(lead,'deadline.approaching',d.case_id,'Zbliża się termin: '||d.title,app.case_number_of(d.case_id)||' · '||lab,prio,k<=1,d.id||':'||lab||':'||lead); end if;
        cnt:=cnt+1;
      end if;
    else
      perform app.notify(d.responsible_user_id,'deadline.overdue',d.case_id,'Przekroczony termin: '||d.title,app.case_number_of(d.case_id)||' · '||(-n)||' dni po terminie','pilne',true,d.id||':over:'||current_date||':'||d.responsible_user_id);
      perform app.notify(lead,'deadline.overdue',d.case_id,'Przekroczony termin: '||d.title,app.case_number_of(d.case_id)||' · eskalacja','pilne',true,d.id||':over:'||current_date||':'||lead);
      for a in select id from public.profiles where role='admin' and active loop
        perform app.notify(a.id,'deadline.overdue',d.case_id,'Przekroczony termin: '||d.title,app.case_number_of(d.case_id)||' · eskalacja','pilne',true,d.id||':over:'||current_date||':'||a.id);
      end loop;
      cnt:=cnt+1;
    end if;
  end loop;
  return cnt;
end $$;

-- =====================================================================
-- RLS — POLITYKI DOSTĘPU
-- =====================================================================
do $$ declare t text; begin
  foreach t in array array['profiles','role_permissions','permission_overrides','emergency_access','case_categories','currencies','process_template_stages','case_counters','holidays',
    'clients','leads','cases','case_finance','case_members','case_stages','case_entries','entry_versions','correction_requests','documents','document_versions',
    'deadlines','deadline_versions','payments','allocations','allocation_versions','attorney_fees','case_history','notifications','audit_log'] loop
    execute format('alter table public.%I enable row level security',t);
  end loop;
end $$;

-- słowniki: czytają zalogowani, zmienia Administrator
create policy r on public.profiles for select to authenticated using (true);
create policy w on public.profiles for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy r on public.role_permissions for select to authenticated using (true);
create policy w on public.role_permissions for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy r on public.permission_overrides for select to authenticated using (app.is_admin() or user_id=auth.uid());
create policy w on public.permission_overrides for all to authenticated using (app.perm('users')=2) with check (app.perm('users')=2);
create policy r on public.emergency_access for select to authenticated using (app.is_admin() or user_id=auth.uid());
create policy i on public.emergency_access for insert to authenticated with check (user_id=auth.uid() and app.my_role()='tech' and status='pending');
create policy u on public.emergency_access for update to authenticated using (app.is_admin()) with check (app.is_admin() and (status<>'granted' or valid_until<=now()+interval '60 minutes'));
create policy r on public.case_categories for select to authenticated using (true);
create policy i on public.case_categories for insert to authenticated with check (app.is_admin());
create policy u on public.case_categories for update to authenticated using (app.is_admin());
create policy r on public.currencies for select to authenticated using (true);
create policy w on public.currencies for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy r on public.process_template_stages for select to authenticated using (true);
create policy w on public.process_template_stages for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy r on public.holidays for select to authenticated using (true);
create policy w on public.holidays for all to authenticated using (app.is_admin()) with check (app.is_admin());
-- (case_counters: brak polityk — tylko przez trigger)

-- zgłoszenia ze strony: anonimowy może tylko DODAĆ (bez odczytu)
create policy anon_insert on public.leads for insert to anon with check (status='nowe' and case_id is null and handled_by is null and reason is null and consent);
create policy r on public.leads for select to authenticated using (app.perm('new_cases')>0);
create policy u on public.leads for update to authenticated using (app.perm('new_cases')>0) with check (app.perm('new_cases')>0);

-- sprawy i klienci
create policy r on public.cases for select to authenticated using (app.can_case(id));
create policy u on public.cases for update to authenticated using (app.is_admin() or app.case_flag(id,'lead')) with check (app.is_admin() or app.case_flag(id,'lead'));
create policy r on public.clients for select to authenticated using (app.perm('client')>0 and exists(select 1 from public.cases c where c.client_id=clients.id and app.can_case(c.id)));
create policy u on public.clients for update to authenticated using ((app.is_admin() or app.my_role()='office' or exists(select 1 from public.cases c where c.client_id=clients.id and app.case_flag(c.id,'lead'))) and exists(select 1 from public.cases c where c.client_id=clients.id and app.can_case(c.id)));
create policy r on public.case_finance for select to authenticated using (app.is_admin() or (app.case_flag(case_id,'finance') and app.perm('initial_fee')>0));
create policy u on public.case_finance for update to authenticated using (app.is_admin()) with check (app.is_admin());

-- zespół: widzą członkowie sprawy, zmienia tylko Administrator; brak DELETE (odebranie = revoked_at)
create policy r on public.case_members for select to authenticated using (app.can_case(case_id));
create policy i on public.case_members for insert to authenticated with check (app.is_admin());
create policy u on public.case_members for update to authenticated using (app.is_admin()) with check (app.is_admin());

-- etapy, wpisy, wersje, korekty
create policy r on public.case_stages for select to authenticated using (app.can_case(case_id) and app.case_flag(case_id,'actions'));
create policy u on public.case_stages for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy r on public.case_entries for select to authenticated using (app.can_case(case_id) and app.case_flag(case_id,'actions') and (deleted_at is null or app.is_admin()));
create policy i on public.case_entries for insert to authenticated with check (app.case_flag(case_id,'actions') and exists(select 1 from public.case_stages s where s.id=stage_id and s.case_id=case_entries.case_id));
create policy u on public.case_entries for update to authenticated using (app.can_case(case_id) and app.case_flag(case_id,'actions'));
create policy r on public.entry_versions for select to authenticated using (exists(select 1 from public.case_entries e where e.id=entry_id and app.can_case(e.case_id) and app.case_flag(e.case_id,'actions')));
create policy r on public.correction_requests for select to authenticated using (app.is_admin() or requested_by=auth.uid());
create policy i on public.correction_requests for insert to authenticated with check (requested_by=auth.uid() and status='pending' and app.case_flag(case_id,'actions') and exists(select 1 from public.case_entries e where e.id=entry_id and e.case_id=correction_requests.case_id));

-- dokumenty
create policy r on public.documents for select to authenticated using (app.can_case(case_id) and app.case_flag(case_id,'documents') and (deleted_at is null or app.is_admin()));
create policy i on public.documents for insert to authenticated with check (app.case_flag(case_id,'documents'));
create policy u on public.documents for update to authenticated using (app.is_admin());
create policy r on public.document_versions for select to authenticated using (exists(select 1 from public.documents d where d.id=document_id and app.can_case(d.case_id) and app.case_flag(d.case_id,'documents')));
create policy i on public.document_versions for insert to authenticated with check (exists(select 1 from public.documents d where d.id=document_id and app.case_flag(d.case_id,'documents') and d.deleted_at is null));

-- terminy
create policy r on public.deadlines for select to authenticated using (app.can_case(case_id) and app.perm('deadlines')>0 and (deleted_at is null or app.is_admin()));
create policy i on public.deadlines for insert to authenticated with check (app.can_case(case_id) and app.perm('deadlines')>0);
create policy u on public.deadlines for update to authenticated using (app.is_admin() or (app.can_case(case_id) and auth.uid() in (responsible_user_id,second_controller_id)));
create policy r on public.deadline_versions for select to authenticated using (exists(select 1 from public.deadlines d where d.id=deadline_id and app.can_case(d.case_id)));

-- finanse: Administrator całość; pełnomocnik wyłącznie swoje pozycje; aplikant nic
create policy r on public.payments for select to authenticated using (app.is_admin() or (app.perm('initial_fee')>0 and app.can_case(case_id) and app.case_flag(case_id,'finance')));
create policy w on public.payments for insert to authenticated with check (app.is_admin());
create policy u on public.payments for update to authenticated using (app.is_admin());
create policy r on public.allocations for select to authenticated using (app.is_admin() or (recipient_type='attorney' and recipient_user_id=auth.uid() and app.perm('attorney_fee')>0));
create policy i on public.allocations for insert to authenticated with check (app.is_admin());
create policy u on public.allocations for update to authenticated using (app.is_admin());
create policy r on public.allocation_versions for select to authenticated using (app.is_admin());
create policy r on public.attorney_fees for select to authenticated using (app.is_admin() or (user_id=auth.uid() and app.perm('attorney_fee')>0));
create policy w on public.attorney_fees for update to authenticated using (app.is_admin());

-- historia, powiadomienia, audyt
create policy r on public.case_history for select to authenticated using (app.can_case(case_id));
create policy r on public.notifications for select to authenticated using (recipient_id=auth.uid() and (case_id is null or app.can_case(case_id)));
create policy u on public.notifications for update to authenticated using (recipient_id=auth.uid()) with check (recipient_id=auth.uid());
create policy r on public.audit_log for select to authenticated using (app.perm('audit')>0);
-- (audit_log: brak polityk INSERT/UPDATE/DELETE — dopisuje wyłącznie funkcja app.audit)

-- uprawnienia na poziomie bazy
revoke all on all tables in schema public from anon;
grant insert on public.leads to anon;
revoke update, delete, truncate on public.audit_log from authenticated, anon;
revoke delete on all tables in schema public from authenticated;   -- usuwanie = soft delete
grant delete on public.permission_overrides, public.currencies, public.holidays, public.process_template_stages to authenticated;  -- słowniki
revoke all on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.run_deadline_reminders() from authenticated;
grant usage on schema app to authenticated;
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated;

-- =====================================================================
-- DANE STARTOWE
-- =====================================================================
insert into public.role_permissions(role,perm,level)
select 'admin',p,2 from unnest(array['cases_all','client','pesel','documents','entries','deadlines','deadlines_close','initial_fee','attorney_fee','success_fee','allocations','delete','new_cases','reports','users','config','audit']) p
union all select 'att',p,1 from unnest(array['client','documents','entries','deadlines','deadlines_close','attorney_fee','success_fee','reports']) p
union all select 'app',p,1 from unnest(array['client','documents','entries','deadlines']) p
union all select 'office',p,1 from unnest(array['client','documents','deadlines','reports']) p
union all select 'office','new_cases',2
union all select 'tech','config',1;

insert into public.case_categories(code,name,color_hex,sort_order,process_template,has_currency) values
 ('RST','Restrukturyzacja','#8b5cf6',1,'rst',false),('SKD','SKD — sankcja kredytu darmowego','#f59e0b',2,'std',false),
 ('CHF','Kredyt frankowy','#ef4444',3,'std',false),('PLN','Kredyt złotówkowy','#3b82f6',4,'std',false),
 ('FX','Kredyt walutowy (EUR, JPY i inne)','#14b8a6',5,'std',true),('ROD','Rozwód i sprawy rodzinne','#ec4899',6,'std',false),
 ('CIV','Inne sprawy cywilne','#22c55e',7,'std',false),('INNE','Pozostałe sprawy','#94a3b8',8,'std',false);
insert into public.currencies values ('EUR'),('JPY'),('USD'),('GBP'),('inne');
insert into public.process_template_stages(template,sort_order,name,is_conflict_check)
select 'std',o,n,n='Kontrola konfliktu interesów' from unnest(array['Przyjęcie sprawy','Rejestracja klienta','Wybór rodzaju sprawy','Kontrola konfliktu interesów','Opłata wstępna','Kwalifikacja','Analiza','Umowa','Przygotowanie','Złożenie pozwu']) with ordinality as t(n,o)
union all
select 'rst',o,n,n='Kontrola konfliktu interesów' from unnest(array['Analiza sytuacji finansowej','Kontrola konfliktu interesów','Opłata wstępna','Wybór postępowania','Przygotowanie wniosku','Złożenie wniosku','Otwarcie postępowania','Plan spłaty / układ','Wykonanie planu']) with ordinality as t(n,o);
insert into public.holidays(month_day,name) values ('01-01','Nowy Rok'),('01-06','Trzech Króli'),('05-01','Święto Pracy'),('05-03','Święto Konstytucji 3 Maja'),('08-15','Wniebowzięcie NMP'),
 ('11-01','Wszystkich Świętych'),('11-11','Święto Niepodległości'),('12-24','Wigilia'),('12-25','Boże Narodzenie'),('12-26','Drugi dzień Bożego Narodzenia');

select app.audit('system.instalacja','schemat v1','CRM Kancelarii — instalacja bazy');

-- =====================================================================
-- PO INSTALACJI (osobno, patrz SUPABASE.md):
--  1) Pierwszy Administrator — po założeniu konta w Authentication → Users:
--     update public.profiles set role='admin', active=true, full_name='Imię Nazwisko' where email='twoj@email.pl';
--  2) Przypomnienia co 15 min — włącz rozszerzenie pg_cron (Database → Extensions), potem:
--     select cron.schedule('przypomnienia-terminy','*/15 * * * *','select public.run_deadline_reminders()');
-- =====================================================================
