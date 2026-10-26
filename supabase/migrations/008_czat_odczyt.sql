-- =====================================================================
--  Migracja 008 — powiadomienie w dzwonku o przeczytaniu wiadomości (rozmowy 1:1).
--  Gdy odbiorca otworzy rozmowę i przeczyta nowe wiadomości, nadawca dostaje
--  „Przeczytane przez: X” (jedno powiadomienie na rozmowę, z ostatnią przeczytaną
--  wiadomością). Bez osobnego powiadomienia o doręczeniu. Otwarcie rozmowy z tą
--  osobą oznacza powiadomienie jako odczytane.
-- =====================================================================
create or replace function public.chat_read(p_with uuid default null, p_order uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); n int; last text; nm text;
begin
  if me is null or not app.session_ok() then raise exception 'Brak aktywnej sesji' using errcode='42501'; end if;
  if p_with is not null then
    with u as (update public.chat_messages set delivered_at=coalesce(delivered_at,now()), read_at=now()
               where sender_id=p_with and recipient_id=me and read_at is null returning body, created_at)
    select count(*), (array_agg(left(regexp_replace(body,'\s+',' ','g'),140) order by created_at desc))[1] into n, last from u;
    update public.notifications set read_at=now() where recipient_id=me and dedupe_key in ('czat:'||me||':u:'||p_with, 'czatodczyt:'||me||':'||p_with) and read_at is null;
    if n>0 then
      select coalesce(nullif(full_name,''),email) into nm from public.profiles where id=me;
      insert into public.notifications(recipient_id,event_type,title,body,link,dedupe_key)
        values(p_with,'czat.odczyt','Przeczytane przez: '||nm,last,'czat:u:'||me,'czatodczyt:'||p_with||':'||me)
      on conflict (dedupe_key) do update set title=excluded.title, body=excluded.body, created_at=now(), read_at=null;
    end if;
  elsif p_order is not null then
    if not app.order_chat_ok(me,p_order) then raise exception 'Brak dostępu do wątku tego zlecenia' using errcode='42501'; end if;
    insert into public.chat_reads(user_id,order_id,last_read_at) values(me,p_order,now()) on conflict (user_id,order_id) do update set last_read_at=now();
    update public.notifications set read_at=now() where recipient_id=me and dedupe_key='czat:'||me||':o:'||p_order and read_at is null;
  end if;
end $$;
revoke all on function public.chat_read(uuid,uuid) from public, anon;
grant execute on function public.chat_read(uuid,uuid) to authenticated;
