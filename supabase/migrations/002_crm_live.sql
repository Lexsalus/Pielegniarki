-- =====================================================================
--  Migracja 002 — CRM na żywo
--  1) 2FA egzekwowane w bazie: Administrator, Pełnomocnik i Obsługa techniczna
--     mają dostęp do danych tylko w sesji z drugim składnikiem (aal2).
--  2) Prywatny magazyn plików „akta” (Supabase Storage) z regułami dostępu per sprawa.
-- =====================================================================

-- 1) sesja spełnia wymagania (aktywne konto + 2FA dla ról, które go wymagają)
create or replace function app.session_ok() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.active
    and (p.role not in ('admin','att','tech') or coalesce(auth.jwt()->>'aal','aal1')='aal2'))
$$;
create or replace function app.my_role() returns text language sql stable security definer set search_path='' as $$
  select role from public.profiles where id=auth.uid() and app.session_ok()
$$;
create or replace function app.is_admin() returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select role='admin' from public.profiles where id=auth.uid()),false) and app.session_ok()
$$;
create or replace function app.perm(p text) returns int language sql stable security definer set search_path='' as $$
  select case when not app.session_ok() then 0 else coalesce(
    (select level from public.permission_overrides o where o.user_id=auth.uid() and o.perm=p and (o.valid_until is null or o.valid_until>=current_date)),
    (select level from public.role_permissions r join public.profiles u on u.role=r.role where u.id=auth.uid() and r.perm=p),0) end
$$;
create or replace function app.can_case(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
  select case
    when not app.session_ok() then false
    when app.is_admin() or app.perm('cases_all')=2 then true
    when app.my_role()='tech' then app.emergency_active()
    else (app.member(cid)).id is not null end
$$;
create or replace function app.case_flag(cid uuid, flag text) returns boolean language sql stable security definer set search_path='' as $$
  select case when not app.session_ok() then false when app.is_admin() then true else coalesce((
    select case flag
      when 'documents' then m.access_documents and app.perm('documents')>0
      when 'actions'   then m.access_actions and app.perm('entries')>0
      when 'finance'   then m.access_finance
      when 'approve'   then m.can_approve
      when 'lead'      then m.role='lead' end
    from public.case_members m where m.case_id=cid and m.user_id=auth.uid() and m.revoked_at is null and (m.end_date is null or m.end_date>=current_date) limit 1),false) end
$$;
-- powiadomienia i własne wnioski też tylko w poprawnej sesji
drop policy if exists r on public.notifications;
create policy r on public.notifications for select to authenticated using (app.session_ok() and recipient_id=auth.uid() and (case_id is null or app.can_case(case_id)));
drop policy if exists r on public.correction_requests;
create policy r on public.correction_requests for select to authenticated using (app.session_ok() and (app.is_admin() or requested_by=auth.uid()));

-- 2) magazyn akt: ścieżka pliku = <id sprawy>/<id dokumentu>/v<nr>-<nazwa>
create or replace function app.path_case(p text) returns uuid language sql immutable as $$
  select case when split_part(p,'/',1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(p,'/',1)::uuid end
$$;
insert into storage.buckets(id,name,public,file_size_limit) values ('akta','akta',false,26214400) on conflict (id) do nothing;
drop policy if exists akta_read on storage.objects;
drop policy if exists akta_insert on storage.objects;
create policy akta_read on storage.objects for select to authenticated
  using (bucket_id='akta' and app.can_case(app.path_case(name)) and app.case_flag(app.path_case(name),'documents'));
create policy akta_insert on storage.objects for insert to authenticated
  with check (bucket_id='akta' and app.can_case(app.path_case(name)) and app.case_flag(app.path_case(name),'documents'));
-- (brak polityk UPDATE/DELETE: plików w aktach nie nadpisuje się ani nie kasuje — nowa wersja = nowy plik)

grant execute on all functions in schema app to authenticated;
revoke all on all functions in schema app from public, anon;
select app.audit('system.migracja','002_crm_live','2FA w bazie (aal2) + magazyn akt');
