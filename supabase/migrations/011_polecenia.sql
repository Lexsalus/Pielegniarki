-- =====================================================================
--  Migracja 011 — polecenia Administratora dla zalogowanych („Aktywni”):
--  • ask_reload   — prośba o odświeżenie panelu (osoba odpowiada Tak / Nie),
--  • force_reload — wymuszone odświeżenie (po potwierdzeniu u Administratora),
--  • logout       — wylogowanie; dodatkowo unieważnia sesje w bazie, więc działa
--                   także na stronach w starej wersji (bez obsługi poleceń).
--  Polecenie wykonuje panel osoby (na żywo albo przy najbliższym sprawdzeniu);
--  polecenia starsze niż 10 minut są pomijane. Każde polecenie trafia do audytu.
-- =====================================================================
create table public.client_commands(
  id uuid primary key default gen_random_uuid(),
  target_user uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('ask_reload','force_reload','logout')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  done_at timestamptz,
  answer text check (answer in ('tak','nie','wykonano'))
);
create index client_commands_target_idx on public.client_commands(target_user, created_at) where done_at is null;
alter table public.client_commands enable row level security;
revoke all on public.client_commands from anon, authenticated;
grant select on public.client_commands to authenticated;
create policy r on public.client_commands for select to authenticated using (app.session_ok() and (target_user=auth.uid() or app.is_admin()));

create or replace function public.client_command(p_user uuid, p_kind text) returns uuid
language plpgsql security definer set search_path='' as $$
declare cid uuid; nm text;
begin
  if not app.is_admin() then raise exception 'Polecenia wysyła tylko Administrator' using errcode='42501'; end if;
  if p_kind not in ('ask_reload','force_reload','logout') then raise exception 'Nieznane polecenie'; end if;
  if p_user=auth.uid() then raise exception 'To Twoje konto — odśwież lub wyloguj się sam'; end if;
  select coalesce(nullif(full_name,''),email) into nm from public.profiles where id=p_user;
  if nm is null then raise exception 'Nie ma takiego konta'; end if;
  insert into public.client_commands(target_user,kind,created_by) values(p_user,p_kind,auth.uid()) returning id into cid;
  if p_kind='logout' then
    -- unieważnienie sesji w bazie (strona w starej wersji straci połączenie)
    begin
      if to_regclass('auth.sessions') is not null then execute 'delete from auth.sessions where user_id=$1' using p_user; end if;
    exception when others then null; end;
    update public.user_presence set logout_at=now() where user_id=p_user;
  end if;
  perform app.audit('polecenie.'||p_kind, nm, '');
  return cid;
end $$;

-- to samo do wszystkich aktywnych kont (poza mną); zwraca liczbę osób
create or replace function public.client_command_all(p_kind text) returns int
language plpgsql security definer set search_path='' as $$
declare u uuid; n int:=0;
begin
  if not app.is_admin() then raise exception 'Polecenia wysyła tylko Administrator' using errcode='42501'; end if;
  for u in select id from public.profiles where active and id<>auth.uid() loop
    perform public.client_command(u,p_kind); n:=n+1;
  end loop;
  return n;
end $$;

-- polecenia czekające na mnie (ostatnie 10 minut)
create or replace function public.my_commands() returns setof public.client_commands
language sql stable security definer set search_path='' as $$
  select * from public.client_commands where target_user=auth.uid() and done_at is null and created_at>now()-interval '10 minutes' order by created_at
$$;

create or replace function public.command_done(p_id uuid, p_answer text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_answer not in ('tak','nie','wykonano') then raise exception 'Niedozwolone'; end if;
  update public.client_commands set done_at=now(), answer=p_answer where id=p_id and target_user=auth.uid() and done_at is null;
end $$;

revoke all on function public.client_command(uuid,text), public.client_command_all(text), public.my_commands(), public.command_done(uuid,text) from public, anon;
grant execute on function public.client_command(uuid,text), public.client_command_all(text), public.my_commands(), public.command_done(uuid,text) to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.client_commands;
  end if;
end $$;
