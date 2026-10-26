-- =====================================================================
--  Migracja 009 — poprawki z przeglądu bezpieczeństwa (26.10.2026).
--  1) Zgłoszenia ze strony (leads, pozostałość po CRM kancelarii): koniec zapisu
--     bez logowania — panel z nich nie korzysta.
--  2) Lista kont (profiles): każdy widzi siebie; Administrator / dyspozytor — wszystkich;
--     pozostali tylko osoby, z którymi mogą pisać w komunikatorze.
--     (Pielęgniarka nie widzi już e-maili i ról innych pielęgniarek.)
--  3) Stała ścieżka wyszukiwania (search_path) dla 7 funkcji pomocniczych.
--  4) Powiadomienia na żywo (Realtime) — panel nie musi co minutę pobierać całej bazy.
-- =====================================================================

-- 1) leads: bez zapisu anonimowego
drop policy if exists anon_insert on public.leads;
revoke insert on public.leads from anon;

-- 2) profiles: kto kogo widzi
drop policy if exists r on public.profiles;
create policy r on public.profiles for select to authenticated using (
  id = auth.uid() or app.nurse_lvl(auth.uid()) = 2 or app.can_chat(auth.uid(), id));

-- 3) stała ścieżka wyszukiwania
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='app' and p.proname in ('audit_readonly','path_case','rings_has','km','pip','member_guard','align')
  loop execute format('alter function %s set search_path = %L', f, ''); end loop;
end $$;

-- 4) powiadomienia na żywo
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
