-- =====================================================================
--  Usunięcie danych testowych panelu pielęgniarek (wstawionych przez dane_testowe.sql).
--  Usuwa: rekordy „TEST …”, dzielnice ze źródłem 'test', reguły przydziału i cenniki miast,
--  które zostały wyłącznie dla testowych pielęgniarek. Wpisy w dzienniku audytu zostają.
-- =====================================================================
do $$
declare adm uuid; tn uuid[]; tr uuid[];
begin
  select id into adm from public.profiles where role='admin' and active order by created_at limit 1;
  perform set_config('request.jwt.claim.sub',adm::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',adm,'aal','aal2','role','authenticated')::text,true);
  select array_agg(id) into tn from public.nurses where full_name like 'TEST %';
  tn := coalesce(tn,'{}');
  select array_agg(distinct rule_id) into tr from public.assignment_pool where nurse_id=any(tn);
  delete from public.order_attempts where nurse_id=any(tn) or order_id in (select id from public.nurse_orders where client_name like 'TEST %' or nurse_id=any(tn));
  delete from public.nurse_orders where client_name like 'TEST %' or nurse_id=any(tn);
  delete from public.nurse_waitlist where client_name like 'TEST %';
  delete from public.assignment_pool where nurse_id=any(tn);
  delete from public.assignment_rules r where r.id=any(coalesce(tr,'{}')) and not exists(select 1 from public.assignment_pool p where p.rule_id=r.id);
  delete from public.price_zones where nurse_id=any(tn);
  delete from public.price_zones z where z.city is not null and not exists(select 1 from public.nurses n where lower(n.city)=lower(z.city) and not (n.id=any(tn)));
  delete from public.nurse_documents where nurse_id=any(tn);
  delete from public.nurse_exceptions where nurse_id=any(tn);
  delete from public.nurse_patterns where nurse_id=any(tn);
  update public.nurse_areas set status='archived' where nurse_id=any(tn) and status='approved';
  delete from public.nurse_areas where nurse_id=any(tn);
  delete from public.nurse_service_links where nurse_id=any(tn) or service_id in (select id from public.nurse_services where name like 'TEST %');
  delete from public.nurses where id=any(tn);
  delete from public.nurse_services s where s.name like 'TEST %' and not exists(select 1 from public.nurse_orders o where o.service_id=s.id);
  delete from public.districts where source='test';
  perform app.audit('dane.testowe','panel pielęgniarek','usunięto dane testowe (TEST)');
end $$;
