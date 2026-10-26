-- =====================================================================
--  Migracja 010 — usunięcie pustych pozostałości po CRM kancelarii.
--  CRM kancelarii (PiK) ma od 26.10.2026 własną bazę; w CRMKP zostały jego puste
--  tabele, funkcje i reguły. Panel pielęgniarek z nich nie korzysta.
--  ZOSTAJĄ (wspólne): konta (profiles), role i uprawnienia (role_permissions,
--  permission_overrides), powiadomienia (bez pola „sprawa”), dziennik audytu.
--  Bezpiecznik: migracja przerywa się, jeśli w tabelach spraw / zgłoszeń są dane.
-- =====================================================================
do $$ begin
  if exists(select 1 from public.cases) or exists(select 1 from public.leads) or exists(select 1 from public.clients)
     or exists(select 1 from public.documents) or exists(select 1 from public.payments) or exists(select 1 from public.deadlines) then
    raise exception 'W tabelach CRM kancelarii są dane — przerywam (najpierw je przenieś albo usuń świadomie)';
  end if;
end $$;

-- 1) powiadomienia: reguła odczytu i funkcja bez sprawdzania spraw; pole „sprawa” znika
drop policy if exists r on public.notifications;
create policy r on public.notifications for select to authenticated using (app.session_ok() and recipient_id=auth.uid());
create or replace function app.notify(rcp uuid, ev text, cid uuid, ttl text, bdy text, prio text default 'normalne', act boolean default false, dkey text default null) returns void
language plpgsql security definer set search_path='' as $$
begin   -- cid (dawniej: sprawa) zostaje w podpisie dla zgodności wywołań, nie jest używany
  if rcp is null then return; end if;
  insert into public.notifications(recipient_id,event_type,title,body,priority,requires_action,dedupe_key)
  values (rcp,ev,ttl,bdy,prio,act,dkey) on conflict (dedupe_key) do nothing;
end $$;
alter table public.notifications drop column if exists case_id;

-- 2) pliki spraw (folder „akta”): reguły dostępu znikają — folder jest pusty i bez reguł niedostępny
drop policy if exists akta_read on storage.objects;
drop policy if exists akta_insert on storage.objects;

-- 3) zadanie w tle: przypomnienia o terminach spraw
do $$ begin
  if to_regclass('cron.job') is not null then
    execute $q$select cron.unschedule(jobid) from cron.job where jobname='przypomnienia-terminy'$q$;
  end if;
end $$;

-- 4) funkcje CRM kancelarii
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and p.proname in ('create_case','reveal_pesel','approve_stage','decide_correction','log_case_open','run_deadline_reminders'))
       or (n.nspname='app' and p.proname in ('case_flag','emergency_active','case_number_of','member','hist','case_before_insert','case_after_insert',
            'case_before_update','case_audit','client_history','member_change','member_guard','entry_guard','entry_next_action','doc_version','doc_guard',
            'deadline_guard','allocation_guard','payment_after','correction_after','can_case','path_case'))
  loop execute format('drop function %s cascade', f); end loop;
end $$;

-- 5) tabele CRM kancelarii (puste)
drop table if exists public.allocation_versions, public.allocations, public.attorney_fees, public.payments,
  public.correction_requests, public.entry_versions, public.document_versions, public.deadline_versions,
  public.deadlines, public.documents, public.case_entries, public.case_stages, public.case_history,
  public.case_members, public.case_finance, public.leads, public.cases, public.clients, public.case_counters,
  public.case_categories, public.process_template_stages, public.currencies, public.holidays,
  public.emergency_access cascade;

do $$ begin perform app.audit('baza.porzadki','CRMKP','usunięto puste tabele i funkcje CRM kancelarii (migracja 010)'); exception when others then null; end $$;
