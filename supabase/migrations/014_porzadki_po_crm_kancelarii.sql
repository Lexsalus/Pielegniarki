-- =====================================================================
--  Migracja 014 — ostatnie resztki po CRM kancelarii (po rozdzieleniu z PiK)
--  • uprawnienia kancelarii w role_permissions / permission_overrides
--    (panel korzysta z „nurses”, a reguły bazy z „users” — nadawanie
--    uprawnień — i „audit” — dziennik audytu; te zostają),
--  • pusta tabela z zaszyfrowanymi numerami PESEL i klucz do ich szyfrowania
--    (schemat private — nieużywany przez panel).
--  Bezpieczne do ponownego uruchomienia.
-- =====================================================================
delete from public.permission_overrides where perm not in ('nurses','users','audit');
delete from public.role_permissions where perm not in ('nurses','users','audit');
do $$ begin
  if to_regclass('private.client_pesel') is not null then
    if exists(select 1 from private.client_pesel) then raise exception 'private.client_pesel nie jest pusta — przerwano'; end if;
    drop table private.client_pesel;
  end if;
  if to_regclass('private.app_secrets') is not null then
    delete from private.app_secrets where name='pesel_key';
    if not exists(select 1 from private.app_secrets) then drop table private.app_secrets; end if;
  end if;
end $$;
select app.audit('system.migracja','014_porzadki_po_crm_kancelarii','usunięte uprawnienia kancelarii, tabela PESEL i klucz szyfrowania');
