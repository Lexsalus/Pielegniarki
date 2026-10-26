-- =====================================================================
--  Migracja 006 — wewnętrzny komunikator.
--  • Rozmowy 1:1: Administrator / dyspozytor (uprawnienie „Pielęgniarki” = pełne)
--    pisze z każdym; pielęgniarka tylko z Administratorem i dyspozytorem
--    (pielęgniarki między sobą nie).
--  • Wątek przy zleceniu: Administrator / dyspozytor + pielęgniarka przypisana do zlecenia.
--  • Doręczenie (delivered_at) i odczyt (read_at; w wątku — chat_reads).
--  • Bez załączników. Nowa wiadomość → powiadomienie w dzwonku (jedno na rozmowę).
--  Zapis tylko przez funkcje; odczyt tylko uczestnicy rozmowy.
-- =====================================================================

-- poziom uprawnienia „Pielęgniarki” dowolnego konta (jak app.perm dla bieżącego)
create or replace function app.nurse_lvl(uid uuid) returns int language sql stable security definer set search_path='' as $$
  select case when not exists(select 1 from public.profiles where id=uid and active) then 0 else coalesce(
    (select level from public.permission_overrides o where o.user_id=uid and o.perm='nurses' and (o.valid_until is null or o.valid_until>=current_date)),
    (select r.level from public.role_permissions r join public.profiles u on u.role=r.role where u.id=uid and r.perm='nurses'),0) end
$$;
create or replace function app.can_chat(a uuid, b uuid) returns boolean language sql stable security definer set search_path='' as $$
  select a is not null and b is not null and a<>b and app.nurse_lvl(a)>=1 and app.nurse_lvl(b)>=1 and (app.nurse_lvl(a)=2 or app.nurse_lvl(b)=2)
$$;
create or replace function app.order_chat_ok(uid uuid, oid uuid) returns boolean language sql stable security definer set search_path='' as $$
  select app.nurse_lvl(uid)=2 or exists(select 1 from public.nurse_orders o join public.nurses n on n.id=o.nurse_id where o.id=oid and n.user_id=uid and app.nurse_lvl(uid)>=1)
$$;

create table public.chat_messages(
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id),
  recipient_id uuid references public.profiles(id),
  order_id uuid references public.nurse_orders(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  read_at timestamptz,
  check ((recipient_id is null) <> (order_id is null))
);
create index chat_dm_idx on public.chat_messages(least(sender_id,recipient_id), greatest(sender_id,recipient_id), created_at) where recipient_id is not null;
create index chat_rcp_idx on public.chat_messages(recipient_id) where read_at is null;
create index chat_order_idx on public.chat_messages(order_id, created_at) where order_id is not null;
create table public.chat_reads(
  user_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid not null references public.nurse_orders(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key(user_id, order_id)
);
alter table public.chat_messages enable row level security;
alter table public.chat_reads enable row level security;
revoke all on public.chat_messages, public.chat_reads from anon, authenticated;
grant select on public.chat_messages, public.chat_reads to authenticated;
create policy r on public.chat_messages for select to authenticated using (app.session_ok() and (
  sender_id=auth.uid() or recipient_id=auth.uid() or (order_id is not null and app.order_chat_ok(auth.uid(), order_id))));
create policy r on public.chat_reads for select to authenticated using (app.session_ok() and app.order_chat_ok(auth.uid(), order_id));

-- wysłanie: p_to (rozmowa 1:1) albo p_order (wątek zlecenia)
create or replace function public.chat_send(p_to uuid default null, p_order uuid default null, p_body text default '') returns public.chat_messages
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); m public.chat_messages; nm text; nn text; num bigint; r uuid;
begin
  if me is null or not app.session_ok() then raise exception 'Brak aktywnej sesji' using errcode='42501'; end if;
  if (p_to is null)=(p_order is null) then raise exception 'Wybierz rozmowę'; end if;
  if length(btrim(coalesce(p_body,'')))=0 then raise exception 'Pusta wiadomość'; end if;
  if length(p_body)>4000 then raise exception 'Wiadomość za długa (maks. 4000 znaków)'; end if;
  if p_to is not null and not app.can_chat(me,p_to) then raise exception 'Nie możesz pisać do tej osoby' using errcode='42501'; end if;
  if p_order is not null and not app.order_chat_ok(me,p_order) then raise exception 'Brak dostępu do wątku tego zlecenia' using errcode='42501'; end if;
  insert into public.chat_messages(sender_id,recipient_id,order_id,body) values(me,p_to,p_order,btrim(p_body)) returning * into m;
  select coalesce(nullif(full_name,''),email) into nm from public.profiles where id=me;
  nn:=left(regexp_replace(m.body,'\s+',' ','g'),140);
  if p_to is not null then
    insert into public.notifications(recipient_id,event_type,title,body,link,dedupe_key)
      values(p_to,'czat.wiadomosc','Wiadomość od '||nm,nn,'czat:u:'||me,'czat:'||p_to||':u:'||me)
    on conflict (dedupe_key) do update set title=excluded.title, body=excluded.body, created_at=now(), read_at=null;
  else
    select number into num from public.nurse_orders where id=p_order;
    -- pielęgniarka pisze → Administrator / dyspozytor; Administrator / dyspozytor pisze → pielęgniarka ze zlecenia
    for r in
      select n.user_id from public.nurse_orders o join public.nurses n on n.id=o.nurse_id where o.id=p_order and app.nurse_lvl(me)=2 and n.user_id is not null and n.user_id<>me
      union
      select p.id from public.profiles p where app.nurse_lvl(me)<2 and p.active and p.id<>me and app.nurse_lvl(p.id)=2
    loop
      insert into public.notifications(recipient_id,event_type,title,body,link,dedupe_key)
        values(r,'czat.zlecenie','Zlecenie #'||num||': wiadomość od '||nm,nn,'czat:o:'||p_order,'czat:'||r||':o:'||p_order)
      on conflict (dedupe_key) do update set title=excluded.title, body=excluded.body, created_at=now(), read_at=null;
    end loop;
  end if;
  return m;
end $$;

-- stan komunikatora: lista kontaktów i wątków; przy okazji potwierdza doręczenie wiadomości do mnie
create or replace function public.chat_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); res jsonb;
begin
  if me is null or not app.session_ok() then return jsonb_build_object('contacts','[]'::jsonb,'orders','[]'::jsonb); end if;
  update public.chat_messages set delivered_at=now() where recipient_id=me and delivered_at is null;
  select jsonb_build_object(
    'contacts', coalesce((select jsonb_agg(c order by c.unread desc, c.last_at desc nulls last, c.full_name) from (
      select u.id as user_id, coalesce(nullif(u.full_name,''),u.email) as full_name, u.role,
        coalesce(p.last_seen > now()-interval '2 minutes' and p.logout_at is null,false) as online,
        (select count(*) from public.chat_messages m where m.sender_id=u.id and m.recipient_id=me and m.read_at is null)::int as unread,
        (select max(m.created_at) from public.chat_messages m where (m.sender_id=u.id and m.recipient_id=me) or (m.sender_id=me and m.recipient_id=u.id)) as last_at,
        (select left(m.body,80) from public.chat_messages m where (m.sender_id=u.id and m.recipient_id=me) or (m.sender_id=me and m.recipient_id=u.id) order by m.created_at desc limit 1) as last_body
      from public.profiles u left join public.user_presence p on p.user_id=u.id
      where app.can_chat(me,u.id)) c),'[]'::jsonb),
    'orders', coalesce((select jsonb_agg(t order by t.unread desc, t.last_at desc) from (
      select o.id as order_id, o.number, max(m.created_at) as last_at,
        count(*) filter (where m.sender_id<>me and m.created_at > coalesce(cr.last_read_at,'-infinity'))::int as unread,
        (array_agg(left(m.body,80) order by m.created_at desc))[1] as last_body
      from public.chat_messages m join public.nurse_orders o on o.id=m.order_id
      left join public.chat_reads cr on cr.order_id=o.id and cr.user_id=me
      where m.order_id is not null and app.order_chat_ok(me,o.id)
      group by o.id, o.number, cr.last_read_at) t),'[]'::jsonb)) into res;
  return res;
end $$;

-- odczyt rozmowy 1:1 albo wątku zlecenia (wiadomości do mnie: doręczone + przeczytane)
create or replace function public.chat_read(p_with uuid default null, p_order uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();
begin
  if me is null or not app.session_ok() then raise exception 'Brak aktywnej sesji' using errcode='42501'; end if;
  if p_with is not null then
    update public.chat_messages set delivered_at=coalesce(delivered_at,now()), read_at=now() where sender_id=p_with and recipient_id=me and read_at is null;
    update public.notifications set read_at=now() where recipient_id=me and dedupe_key='czat:'||me||':u:'||p_with and read_at is null;
  elsif p_order is not null then
    if not app.order_chat_ok(me,p_order) then raise exception 'Brak dostępu do wątku tego zlecenia' using errcode='42501'; end if;
    insert into public.chat_reads(user_id,order_id,last_read_at) values(me,p_order,now()) on conflict (user_id,order_id) do update set last_read_at=now();
    update public.notifications set read_at=now() where recipient_id=me and dedupe_key='czat:'||me||':o:'||p_order and read_at is null;
  end if;
end $$;

-- kto czytał wątek zlecenia (do potwierdzeń odczytu)
create or replace function public.chat_order_readers(p_order uuid) returns table(user_id uuid, full_name text, last_read_at timestamptz)
language sql stable security definer set search_path='' as $$
  select r.user_id, coalesce(nullif(p.full_name,''),p.email), r.last_read_at from public.chat_reads r join public.profiles p on p.id=r.user_id
  where r.order_id=p_order and app.session_ok() and app.order_chat_ok(auth.uid(),p_order)
$$;

-- historia rozmowy 1:1 albo wątku zlecenia (ostatnie 300 wiadomości)
create or replace function public.chat_history(p_with uuid default null, p_order uuid default null) returns setof public.chat_messages
language sql stable security definer set search_path='' as $$
  select * from (select m.* from public.chat_messages m
    where app.session_ok() and (
      (p_with is not null and ((m.sender_id=auth.uid() and m.recipient_id=p_with) or (m.sender_id=p_with and m.recipient_id=auth.uid())))
      or (p_order is not null and m.order_id=p_order and app.order_chat_ok(auth.uid(),p_order)))
    order by m.created_at desc limit 300) x order by created_at
$$;
revoke all on function public.chat_send(uuid,uuid,text), public.chat_state(), public.chat_read(uuid,uuid), public.chat_order_readers(uuid), public.chat_history(uuid,uuid) from public, anon;
grant execute on function public.chat_send(uuid,uuid,text), public.chat_state(), public.chat_read(uuid,uuid), public.chat_order_readers(uuid), public.chat_history(uuid,uuid) to authenticated;

-- wiadomości na żywo (Supabase Realtime), jeśli publikacja istnieje
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;
