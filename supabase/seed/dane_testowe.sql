-- =====================================================================
--  Dane testowe panelu pielęgniarek (oznaczone „TEST”).
--  Usunięcie: supabase/seed/usun_dane_testowe.sql (wpisy w dzienniku audytu zostają — tylko dopisywanie).
--  Daty liczone od bieżącego tygodnia. Granice dzielnic są uproszczone (prostokąty), źródło 'test'.
--  Uruchamiane jako Administrator (pierwsze aktywne konto admin) — działają wszystkie reguły bazy.
-- =====================================================================
do $$
declare adm uuid; mon date := date_trunc('week',current_date)::date; tz text := 'Europe/Warsaw';
  s_morf uuid; s_pak uuid; s_zas uuid;
  n_nowak uuid; n_kow uuid; n_kas uuid; n_wis uuid; n_kacz uuid; n_maz uuid; n_paw uuid; n_lis uuid;
  r_waw uuid; r_srod uuid; r_kal uuid; r_rad uuid; o uuid;
begin
  select id into adm from public.profiles where role='admin' and active order by created_at limit 1;
  if adm is null then raise exception 'Brak aktywnego Administratora'; end if;
  if exists(select 1 from public.nurses where full_name like 'TEST %') then raise exception 'Dane testowe już są — najpierw usun_dane_testowe.sql'; end if;
  perform set_config('request.jwt.claim.sub',adm::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',adm,'aal','aal2','role','authenticated')::text,true);

  -- usługi
  insert into public.nurse_services(name,duration_min,buffer_min,price,qualifications) values ('TEST Morfologia + CRP',15,0,60,'') returning id into s_morf;
  insert into public.nurse_services(name,duration_min,buffer_min,price,qualifications) values ('TEST Pakiet badań krwi',20,5,null,'pobieranie krwi') returning id into s_pak;
  insert into public.nurse_services(name,duration_min,buffer_min,price,qualifications) values ('TEST Zastrzyk domięśniowy',10,0,40,'') returning id into s_zas;

  -- dzielnice Warszawy (uproszczone prostokąty)
  insert into public.districts(city,name,rings,source) values
   ('Warszawa','Śródmieście','[[[52.215,20.985],[52.215,21.035],[52.245,21.035],[52.245,20.985]]]','test'),
   ('Warszawa','Wola','[[[52.215,20.93],[52.215,20.985],[52.255,20.985],[52.255,20.93]]]','test'),
   ('Warszawa','Mokotów','[[[52.165,20.98],[52.165,21.06],[52.215,21.06],[52.215,20.98]]]','test'),
   ('Warszawa','Włochy','[[[52.165,20.88],[52.165,20.98],[52.215,20.98],[52.215,20.88]]]','test'),
   ('Warszawa','Ursus','[[[52.165,20.82],[52.165,20.88],[52.215,20.88],[52.215,20.82]]]','test'),
   ('Warszawa','Białołęka','[[[52.29,20.95],[52.29,21.08],[52.36,21.08],[52.36,20.95]]]','test')
  on conflict (city,name) do nothing;

  -- pielęgniarki (przykłady z projektu + różne stany)
  insert into public.nurses(full_name,color,city,status,phone,email,rating) values ('TEST Anna Nowak','#7c5cff','Warszawa','aktywna','500 100 001','nowak@test.invalid',4.9) returning id into n_nowak;
  insert into public.nurses(full_name,color,city,status,phone,email,rating) values ('TEST Anna Kowalska','#2fd6a0','Warszawa','aktywna','500 100 002','kowalska@test.invalid',4.7) returning id into n_kow;
  insert into public.nurses(full_name,color,city,status,phone,email,rating) values ('TEST Anna Kasperczak','#f59e0b','Warszawa','aktywna','500 100 003','kasperczak@test.invalid',4.8) returning id into n_kas;
  insert into public.nurses(full_name,color,city,status,phone,email,rating) values ('TEST Ewa Wiśniewska','#3b82f6','Kalisz','aktywna','500 100 004','wisniewska@test.invalid',5.0) returning id into n_wis;
  insert into public.nurses(full_name,color,city,status,phone,email,rating) values ('TEST Magdalena Kaczmarek','#ec4899','Kalisz','aktywna','500 100 005','kaczmarek@test.invalid',4.5) returning id into n_kacz;
  insert into public.nurses(full_name,color,city,status,phone,email) values ('TEST Joanna Mazur','#14b8a6','Radom','urlop','500 100 006','mazur@test.invalid') returning id into n_maz;
  insert into public.nurses(full_name,color,city,status,phone,email) values ('TEST Monika Pawlak','#8b5cf6','Poznań','do_weryfikacji','500 100 007','pawlak@test.invalid') returning id into n_paw;
  insert into public.nurses(full_name,color,city,status,phone,email,rating) values ('TEST Katarzyna Lis','#ef4444','Łódź','aktywna','500 100 008','lis@test.invalid',4.6) returning id into n_lis;
  insert into public.nurse_service_links values (n_nowak,s_morf),(n_nowak,s_pak),(n_nowak,s_zas),(n_kow,s_morf),(n_kow,s_pak),(n_kas,s_morf),(n_kas,s_zas),
    (n_wis,s_morf),(n_wis,s_pak),(n_kacz,s_morf),(n_maz,s_morf),(n_paw,s_morf),(n_lis,s_morf),(n_lis,s_zas);

  -- obszary (zatwierdzone; Pawlak — czeka na zatwierdzenie; Lis — zatwierdzony + nowy szkic do decyzji)
  insert into public.nurse_areas(nurse_id,shapes,base_lat,base_lng,base_label,status) values
   (n_nowak,'[{"type":"districts","city":"Warszawa","names":["Białołęka","Włochy","Ursus"]}]',52.19,20.93,'Włochy','approved'),
   (n_kow,'[{"type":"city","city":"Warszawa"},{"type":"radius","lat":51.4027,"lng":21.1471,"km":20,"label":"Radom"}]',52.23,21.01,'Śródmieście','approved'),
   (n_kas,'[{"type":"districts","city":"Warszawa","names":["Śródmieście","Mokotów"]}]',52.19,21.02,'Mokotów','approved'),
   (n_wis,'[{"type":"radius","lat":51.7611,"lng":18.091,"km":30,"label":"Kalisz"}]',51.7611,18.091,'Kalisz','approved'),
   (n_kacz,'[{"type":"polygon","points":[[51.745,18.06],[51.745,18.12],[51.78,18.12],[51.78,18.06]]}]',51.762,18.09,'Kalisz — centrum','approved'),
   (n_maz,'[{"type":"radius","lat":51.4027,"lng":21.1471,"km":20,"label":"Radom"}]',51.4027,21.1471,'Radom','approved'),
   (n_lis,'[{"type":"radius","lat":51.7592,"lng":19.456,"km":10,"label":"Łódź"}]',51.7592,19.456,'Łódź','approved');
  insert into public.nurse_areas(nurse_id,shapes,base_lat,base_lng,base_label,status) values
   (n_paw,'[{"type":"radius","lat":52.4064,"lng":16.9252,"km":15,"label":"Poznań"}]',52.4064,16.9252,'Poznań','pending'),
   (n_lis,'[{"type":"radius","lat":51.7592,"lng":19.456,"km":20,"label":"Łódź"}]',51.7592,19.456,'Łódź','pending');

  -- terminarz (od bieżącego tygodnia) + zmiany czekające na zatwierdzenie
  insert into public.nurse_patterns(nurse_id,dow,time_from,time_to,valid_from,status)
   select n_nowak,d,time '08:00',time '11:00',mon,'approved' from unnest(array[1,3,5]) d
   union all select n_kow,d,'10:00','16:00',mon,'approved' from unnest(array[4,7]) d
   union all select n_kas,d,'14:00','18:00',mon,'approved' from unnest(array[2,4]) d
   union all select n_wis,d,'09:00','13:00',mon,'approved' from unnest(array[1,2,3,4,5]) d
   union all select n_kacz,d,'12:00','17:00',mon,'approved' from unnest(array[2,4,6]) d
   union all select n_maz,d,'08:00','12:00',mon,'approved' from unnest(array[1,2,3,4,5]) d
   union all select n_lis,d,'08:00','14:00',mon,'approved' from unnest(array[1,2,3]) d;
  insert into public.nurse_patterns(nurse_id,dow,time_from,time_to,valid_from,status) values (n_lis,5,'08:00','12:00',mon+7,'pending');
  update public.nurse_patterns set end_requested=mon+14 where nurse_id=n_lis and dow=3 and status='approved';
  insert into public.nurse_exceptions(nurse_id,date_from,date_to,kind,time_from,time_to,note,status) values
   (n_kow,mon+10,mon+10,'urlop',null,null,'TEST urlop jednodniowy','approved'),
   (n_nowak,mon+12,mon+12,'dodatkowe','09:00','12:00','TEST dodatkowa sobota','approved'),
   (n_maz,mon,mon+13,'urlop',null,null,'TEST urlop dwutygodniowy','approved'),
   (n_lis,mon+8,mon+8,'wolne',null,null,'TEST prośba o wolne','pending');

  -- cenniki stref (szablony miast) + nadpisanie dla Kowalskiej (strefa 2: 30 zł zamiast 25)
  insert into public.price_zones(city,zone_no,km_from,km_to,price_client,payout) values
   ('Warszawa',1,0,10,30,10),('Warszawa',2,10,20,50,25),('Warszawa',3,20,30,70,40),('Warszawa',4,30,120,150,90),
   ('Kalisz',1,0,10,30,10),('Kalisz',2,10,20,50,25),('Kalisz',3,20,30,70,40),
   ('Radom',1,0,10,30,10),('Radom',2,10,20,50,25),
   ('Łódź',1,0,10,35,12),('Łódź',2,10,20,55,28),
   ('Poznań',1,0,10,35,12),('Poznań',2,10,20,55,28)
  on conflict do nothing;
  insert into public.price_zones(nurse_id,zone_no,payout) values (n_kow,2,30);

  -- reguły przydziału: proporcjonalnie (Warszawa), kolejka z limitem (Śródmieście), po kolei (Kalisz), ręcznie (Radom)
  insert into public.assignment_rules(city,district,kind,accept_timeout_min) values ('Warszawa',null,'weighted',10) returning id into r_waw;
  insert into public.assignment_pool(rule_id,nurse_id,weight,daily_limit,sort_order) values (r_waw,n_nowak,50,10,1),(r_waw,n_kow,30,8,2),(r_waw,n_kas,20,6,3);
  insert into public.assignment_rules(city,district,kind,accept_timeout_min) values ('Warszawa','Śródmieście','queue',15) returning id into r_srod;
  insert into public.assignment_pool(rule_id,nurse_id,weight,queue_limit,sort_order) values (r_srod,n_kas,1,3,1),(r_srod,n_kow,1,null,2);
  insert into public.assignment_rules(city,kind) values ('Kalisz','round_robin') returning id into r_kal;
  insert into public.assignment_pool(rule_id,nurse_id,sort_order) values (r_kal,n_wis,1),(r_kal,n_kacz,2);
  insert into public.assignment_rules(city,kind) values ('Radom','manual') returning id into r_rad;
  insert into public.assignment_pool(rule_id,nurse_id,sort_order) values (r_rad,n_maz,1),(r_rad,n_kow,2);

  -- dokumenty (OC Kasperczak przeterminowane)
  insert into public.nurse_documents(nurse_id,kind,number,valid_until) values
   (n_nowak,'PWZ','TEST 1234567',null),(n_nowak,'OC','TEST OC/2026/01',current_date+200),(n_nowak,'umowa','TEST U/01/2026',null),
   (n_kow,'PWZ','TEST 2345678',null),(n_kow,'OC','TEST OC/2026/02',current_date+90),
   (n_kas,'PWZ','TEST 3456789',null),(n_kas,'OC','TEST OC/2025/03',current_date-5),
   (n_wis,'PWZ','TEST 4567890',null);

  -- zlecenia we wszystkich statusach (kwoty zapisane jak przy prawdziwym zleceniu)
  -- rozliczone (ten miesiąc, do raportu marży)
  insert into public.nurse_orders(client_name,client_phone,address,lat,lng,city,district,service_id,start_at,end_at,nurse_id,status,rule_id,price_service,price_travel,zone_no,distance_km,payout_travel,proposed_at,accepted_at,done_at,settled_at,note)
  values ('TEST Jan Kowalski','600 200 001','TEST ul. Pułkowa 3, Warszawa',52.32,21.0,'Warszawa','Białołęka',s_morf,((mon-7)+time '08:00') at time zone tz,((mon-7)+time '08:15') at time zone tz,n_nowak,'rozliczone',r_waw,60,50,2,14.5,25,now()-interval '8 days',now()-interval '8 days',now()-interval '7 days',now()-interval '6 days','')
  returning id into o; insert into public.order_attempts(order_id,nurse_id,via,result,decided_at,proposed_at) values (o,n_nowak,'regula','przyjete',now()-interval '8 days',now()-interval '8 days');
  -- wykonane (do rozliczenia)
  insert into public.nurse_orders(client_name,client_phone,address,lat,lng,city,district,service_id,start_at,end_at,nurse_id,status,rule_id,price_service,price_travel,zone_no,distance_km,payout_travel,proposed_at,accepted_at,done_at)
  values ('TEST Maria Zielińska','600 200 002','TEST ul. Puławska 10, Warszawa',52.2,21.02,'Warszawa','Mokotów',s_morf,((mon-5)+time '14:00') at time zone tz,((mon-5)+time '14:15') at time zone tz,n_kas,'wykonane',r_waw,60,30,1,1.2,10,now()-interval '6 days',now()-interval '6 days',now()-interval '5 days')
  returning id into o; insert into public.order_attempts(order_id,nurse_id,via,result,decided_at,proposed_at) values (o,n_kas,'regula','przyjete',now()-interval '6 days',now()-interval '6 days');
  -- przyjęte (najbliższy poniedziałek / środa)
  insert into public.nurse_orders(client_name,client_phone,address,lat,lng,city,district,service_id,start_at,end_at,nurse_id,status,rule_id,price_service,price_travel,zone_no,distance_km,payout_travel,proposed_at,accepted_at)
  values ('TEST Piotr Wiśniewski','600 200 003','TEST ul. Globusowa 5, Warszawa',52.185,20.94,'Warszawa','Włochy',s_pak,((mon+7)+time '08:00') at time zone tz,((mon+7)+time '08:25') at time zone tz,n_nowak,'przyjete',r_waw,null,30,1,1.3,10,now()-interval '1 day',now()-interval '1 day')
  returning id into o; insert into public.order_attempts(order_id,nurse_id,via,result,decided_at,proposed_at) values (o,n_kow,'regula','odrzucone',now()-interval '1 day',now()-interval '1 day'),(o,n_nowak,'regula','przyjete',now()-interval '1 day',now()-interval '1 day');
  -- w drodze (dziś)
  insert into public.nurse_orders(client_name,client_phone,address,lat,lng,city,service_id,start_at,end_at,nurse_id,status,rule_id,price_service,price_travel,zone_no,distance_km,payout_travel,proposed_at,accepted_at)
  values ('TEST Halina Nowicka','600 200 004','TEST ul. Górnośląska 2, Kalisz',51.758,18.085,'Kalisz',s_morf,date_trunc('hour',now())+interval '1 hour',date_trunc('hour',now())+interval '75 minutes',n_wis,'w_drodze',r_kal,60,30,1,0.6,10,now()-interval '2 hours',now()-interval '2 hours')
  returning id into o; insert into public.order_attempts(order_id,nurse_id,via,result,decided_at,proposed_at) values (o,n_wis,'regula','przyjete',now()-interval '2 hours',now()-interval '2 hours');
  -- zaproponowane (czeka na akceptację; długi limit, żeby zostało do testów)
  insert into public.nurse_orders(client_name,client_phone,address,lat,lng,city,district,service_id,start_at,end_at,nurse_id,status,rule_id,price_service,price_travel,zone_no,distance_km,payout_travel,proposed_at,expires_at)
  values ('TEST Krystyna Lewandowska','600 200 005','TEST ul. Marszałkowska 100, Warszawa',52.23,21.01,'Warszawa','Śródmieście',s_morf,((mon+9)+time '14:00') at time zone tz,((mon+9)+time '14:15') at time zone tz,n_kas,'zaproponowane',r_srod,60,30,1,4.4,10,now(),now()+interval '7 days')
  returning id into o; insert into public.order_attempts(order_id,nurse_id,via,proposed_at) values (o,n_kas,'regula',now());
  -- nowe, czeka na dyspozytora (Radom — reguła „ręcznie”)
  insert into public.nurse_orders(client_name,client_phone,address,lat,lng,city,service_id,start_at,end_at,status,needs_dispatcher,rule_id,price_service,price_travel)
  values ('TEST Zofia Kamińska','600 200 006','TEST ul. Żeromskiego 1, Radom',51.402,21.147,'Radom',s_morf,((mon+13)+time '11:00') at time zone tz,((mon+13)+time '11:15') at time zone tz,'nowe',true,r_rad,60,150);
  -- nowe po odmowie i braku odpowiedzi (historia prób)
  insert into public.nurse_orders(client_name,client_phone,address,lat,lng,city,district,service_id,start_at,end_at,status,needs_dispatcher,rule_id,price_service,price_travel)
  values ('TEST Adam Mazur','600 200 007','TEST ul. Kasprowicza 50, Warszawa',52.31,20.98,'Warszawa','Białołęka',s_morf,((mon+9)+time '09:00') at time zone tz,((mon+9)+time '09:15') at time zone tz,'nowe',true,r_waw,60,50)
  returning id into o; insert into public.order_attempts(order_id,nurse_id,via,result,decided_at,proposed_at) values (o,n_nowak,'regula','brak_odpowiedzi',now()-interval '3 hours',now()-interval '4 hours'),(o,n_kow,'regula','odrzucone',now()-interval '2 hours',now()-interval '3 hours');

  -- lista oczekujących (adresy bez pokrycia → warstwa „Białe plamy”)
  insert into public.nurse_waitlist(client_name,client_phone,address,lat,lng,city,service_id) values
   ('TEST Barbara Nowak','600 200 008','TEST ul. Powstańców Śląskich 100, Warszawa (Bemowo)',52.24,20.9,'Warszawa',s_morf),
   ('TEST Tomasz Lis','600 200 009','TEST ul. Długa 1, Gdańsk',54.35,18.65,'Gdańsk',s_pak);

  perform app.audit('dane.testowe','panel pielęgniarek','wstawiono dane testowe (TEST)');
end $$;
