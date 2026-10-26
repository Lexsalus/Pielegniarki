-- =====================================================================
--  Migracja 003 — zdarzenia audytu zgłaszane przez CRM + audyt zmian sprawy
-- =====================================================================
-- Eksporty i pobrania plików dzieją się w przeglądarce; CRM zgłasza je do audytu.
-- Dozwolone tylko wybrane typy zdarzeń (nie da się podrobić np. „uprawnienia.zmiana”).
create or replace function public.log_event(p_action text, p_target text, p_details text default '') returns void
language plpgsql security definer set search_path='' as $$
begin
  if not app.session_ok() then raise exception 'Brak aktywnej sesji' using errcode='42501'; end if;
  if p_action not in ('eksport.raport','eksport.ics','dokument.pobranie','logowanie','wylogowanie','logowanie.2fa_konfiguracja') then
    raise exception 'Niedozwolony typ zdarzenia' using errcode='42501'; end if;
  perform app.audit(p_action, left(coalesce(p_target,''),200), left(coalesce(p_details,''),500));
end $$;
revoke all on function public.log_event(text,text,text) from public, anon;
grant execute on function public.log_event(text,text,text) to authenticated;

-- logowanie bez 2FA też jest zdarzeniem (konta wymagające 2FA mają wtedy aal1 — dopuszczamy tylko te dwa typy)
create or replace function public.log_login(p_action text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or p_action not in ('logowanie','wylogowanie','logowanie.2fa_konfiguracja') then raise exception 'Niedozwolone' using errcode='42501'; end if;
  perform app.audit(p_action, coalesce((select full_name from public.profiles where id=auth.uid()),''), '');
end $$;
revoke all on function public.log_login(text) from public, anon;
grant execute on function public.log_login(text) to authenticated;

-- zmiana kategorii / statusu sprawy trafia także do audytu
create or replace function app.case_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.category_code is distinct from old.category_code then perform app.audit('sprawa.kategoria',new.case_number,old.category_code||' → '||new.category_code); end if;
  if new.status is distinct from old.status then perform app.audit('sprawa.status',new.case_number,old.status||' → '||new.status); end if;
  return new;
end $$;
drop trigger if exists case_audit on public.cases;
create trigger case_audit after update on public.cases for each row execute function app.case_audit();
grant execute on all functions in schema app to authenticated;
revoke all on all functions in schema app from public, anon;
select app.audit('system.migracja','003_audit_events','log_event, log_login, audyt zmian sprawy');
