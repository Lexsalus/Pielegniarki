-- =====================================================================
--  Migracja 013 — wylogowanie przez Administratora działa natychmiast,
--  także na stronach w starej wersji panelu.
--  Przy ⏏ Wyloguj zapisujemy czas (profiles.sessions_revoked_at); każda
--  „przepustka” logowania (JWT) wydana wcześniej jest od razu odrzucana
--  przez app.session_ok() — a na niej opierają się wszystkie reguły dostępu.
--  Nowe logowanie (późniejsza przepustka) działa normalnie.
-- =====================================================================
alter table public.profiles add column if not exists sessions_revoked_at timestamptz;

create or replace function app.session_ok() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.active
    and (p.role not in ('admin','att','tech') or coalesce(auth.jwt()->>'aal','aal1')='aal2')
    and (p.sessions_revoked_at is null
         or coalesce((auth.jwt()->>'iat')::bigint, 9223372036854775807) > floor(extract(epoch from p.sessions_revoked_at))::bigint))
$$;

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
    update public.profiles set sessions_revoked_at=now() where id=p_user;   -- natychmiast: wcześniejsze przepustki odrzucane
    begin
      if to_regclass('auth.sessions') is not null then execute 'delete from auth.sessions where user_id=$1' using p_user; end if;
    exception when others then null; end;
    update public.user_presence set logout_at=now() where user_id=p_user;
  end if;
  perform app.audit('polecenie.'||p_kind, nm, '');
  return cid;
end $$;
