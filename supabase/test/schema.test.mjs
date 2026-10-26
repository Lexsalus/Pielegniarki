import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'fs';
const db=new PGlite({extensions:{pgcrypto}});
const R=(ok,msg)=>console.log((ok?'✅ ':'❌ ')+msg);
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create schema extensions; create extension pgcrypto schema extensions;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
grant execute on function auth.jwt() to anon, authenticated;
create schema storage; grant usage on schema storage to anon, authenticated;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid());
alter table storage.objects enable row level security; grant select, insert on storage.objects to authenticated;
grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;`);
try{await db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url),'utf8'));R(true,'schema.sql wykonany bez błędów')}catch(e){R(false,'schema.sql: '+e.message);process.exit(1)}
for(const m of fs.readdirSync(new URL('../migrations/', import.meta.url)).sort()){try{await db.exec(fs.readFileSync(new URL('../migrations/'+m, import.meta.url),'utf8'));R(true,'migracja '+m)}catch(e){R(false,'migracja '+m+': '+e.message);process.exit(1)}}
const U={admin:'11111111-1111-1111-1111-111111111111',jan:'22222222-2222-2222-2222-222222222222',piotr:'33333333-3333-3333-3333-333333333333',anna:'44444444-4444-4444-4444-444444444444',kasia:'55555555-5555-5555-5555-555555555555',tech:'66666666-6666-6666-6666-666666666666'};
for(const [k,id] of Object.entries(U))await db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)`,[id,k+'@k.test',{full_name:k}]);
R((await db.query('select count(*)::int n from public.profiles where not active')).rows[0].n===6,'trigger: 6 profili, nieaktywne do zatwierdzenia');
await db.exec(`update public.profiles set active=true, role=case email when 'admin@k.test' then 'admin' when 'jan@k.test' then 'att' when 'piotr@k.test' then 'att' when 'anna@k.test' then 'app' when 'kasia@k.test' then 'office' else 'tech' end`);
let AAL='aal2';
const as=async(who,sql,params=[])=>{await db.exec(`set role ${who==='anon'?'anon':'authenticated'}`);await db.query(`select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)`,[who==='anon'?'':U[who],JSON.stringify({aal:AAL})]);try{return await db.query(sql,params)}finally{await db.exec('reset role')}};
const fails=async(who,sql,params=[])=>{try{await as(who,sql,params);return null}catch(e){return e.message}};
// --- sprawy i numeracja
const c1=(await as('admin',`select public.create_case('SKD','Jan','Kowalski',$1,'80010112345','123','j@k.pl','Warszawa',250000,5000,10) id`,[U.jan])).rows[0].id;
const c2=(await as('kasia',`select public.create_case('SKD','Ewa','Druga',$1) id`,[U.piotr])).rows[0].id;
const nums=(await db.query(`select case_number from public.cases order by created_at`)).rows.map(r=>r.case_number);
R(nums.join()==='SKD-2026-0001,SKD-2026-0002',`numeracja: ${nums.join(', ')}`);
R(!!await fails('anna',`select public.create_case('CIV','X','Y',$1)`,[U.jan]),'aplikant nie zakłada spraw');
R((await db.query(`select count(*)::int n from public.case_stages where case_id=$1`,[c1])).rows[0].n===10,'10 etapów z szablonu');
R(!!await fails('admin',`update public.cases set case_number='X' where id=$1`,[c1]),'numer sprawy niezmienny');
// --- zespół
await as('admin',`insert into public.case_members(case_id,user_id,role,access_finance) values($1,$2,'app',false)`,[c1,U.anna]);
R(!!await fails('admin',`insert into public.case_members(case_id,user_id,role) values($1,$2,'lead')`,[c1,U.piotr]),'drugi pełnomocnik prowadzący → odrzucony');
R(!!await fails('jan',`insert into public.case_members(case_id,user_id,role) values($1,$2,'app')`,[c1,U.piotr]),'dodaje do zespołu tylko Administrator');
// --- widoczność
R((await as('anna',`select * from public.cases`)).rows.length===1,'aplikant widzi tylko swoją sprawę');
R((await as('anna',`select * from public.case_finance`)).rows.length===0,'aplikant: brak danych finansowych sprawy');
await as('admin',`insert into public.payments(case_id,amount) values($1,10000)`,[c1]);
const pay=(await db.query('select id from public.payments')).rows[0].id;
for(const [t,a,st,who] of [['sales',3000,'planned',null],['marketing',2000,'planned',null],['attorney',1000,'planned',U.jan],['company',4000,'planned',null]])
  await as('admin',`insert into public.allocations(payment_id,case_id,recipient_type,amount,status,recipient_user_id,recipient_name) values($1,$2,$3,$4,$5,$6,$7)`,[pay,c1,t,a,st,who,t==='sales'?'Kamil Nowicki':null]);
R(!!await fails('admin',`insert into public.allocations(payment_id,case_id,recipient_type,amount) values($1,$2,'other',1)`,[pay,c1]),'suma podziału > wpływ → odrzucone');
await as('admin',`update public.allocations set status='approved' where payment_id=$1`,[pay]);
R((await db.query(`select count(*)::int n from public.allocations where status='approved'`)).rows[0].n===4,'bilans 0 zł → zatwierdzenie możliwe');
const p2=(await as('admin',`insert into public.payments(case_id,amount) values($1,5000) returning id`,[c2])).rows[0].id;
R(!!await fails('admin',`insert into public.allocations(payment_id,case_id,recipient_type,recipient_user_id,amount,status) values($1,$2,'attorney',$3,1000,'approved')`,[p2,c2,U.piotr]),'niepełny podział nie może być „zatwierdzone”');
const ja=(await as('jan',`select recipient_type,amount from public.allocations`)).rows;
R(ja.length===1&&+ja[0].amount===1000,`pełnomocnik widzi tylko swoją pozycję: ${JSON.stringify(ja)}`);
R((await as('anna',`select * from public.allocations`)).rows.length===0&&(await as('anna',`select * from public.payments`)).rows.length===0,'aplikant: 0 wpłat i alokacji');
R((await as('anna',`select * from public.attorney_fees`)).rows.length===0,'aplikant: brak wynagrodzenia/success fee');
// --- PESEL
R((await as('jan',`select pesel_masked from public.clients`)).rows[0]?.pesel_masked==='800101*****','PESEL maskowany w tabeli');
R(!!await fails('jan',`select public.reveal_pesel((select client_id from public.cases where id=$1))`,[c1]),'pełnomocnik bez uprawnienia nie odsłoni PESEL');
R((await as('admin',`select public.reveal_pesel((select client_id from public.cases where id=$1)) p`,[c1])).rows[0].p==='80010112345','Administrator odsłania PESEL (zaszyfrowany w bazie)');
R(!!await fails('jan',`select * from private.client_pesel`),'tabela z PESEL niedostępna przez API');
// --- wpisy, blokady, korekty
const st1=(await db.query(`select id from public.case_stages where case_id=$1 and sort_order=1`,[c1])).rows[0].id;
const e1=(await as('anna',`insert into public.case_entries(case_id,stage_id,type,title) values($1,$2,'czynność','Analiza umowy') returning id`,[c1,st1])).rows[0].id;
await as('anna',`update public.case_entries set description='poprawka' where id=$1`,[e1]);
R((await db.query(`select count(*)::int n from public.entry_versions where entry_id=$1`,[e1])).rows[0].n===1,'edycja roboczego wpisu → wersja zapisana');
R((await fails('anna',`delete from public.case_entries where id=$1`,[e1]))?.includes('permission denied'),'aplikant DELETE → odmowa (brak uprawnienia w bazie)');
R(!!await fails('anna',`update public.case_entries set deleted_at=now(),delete_reason='test test' where id=$1`,[e1]),'aplikant soft delete → odmowa');
{const r=await as('piotr',`update public.case_entries set title='x' where id=$1`,[e1]);const t=(await db.query('select title from public.case_entries where id=$1',[e1])).rows[0].title;R(r.affectedRows===0&&t!=='x',`pełnomocnik spoza sprawy: UPDATE zmienił ${r.affectedRows} wierszy (RLS ukrywa wiersz)`)}
await as('jan',`select public.approve_stage($1)`,[st1]);
R((await db.query(`select locked from public.case_entries where id=$1`,[e1])).rows[0].locked===true,'pełnomocnik prowadzący zatwierdza etap → wpisy zablokowane');
R(!!await fails('anna',`update public.case_entries set title='zmiana' where id=$1`,[e1]),'zmiana zatwierdzonego wpisu → odmowa');
R(!!await fails('admin',`update public.case_entries set title='zmiana' where id=$1`,[e1]),'Administrator bez uzasadnienia → odmowa');
await as('anna',`insert into public.correction_requests(entry_id,case_id,reason,proposed_title) values($1,$2,'literówka w tytule','Analiza umowy kredytowej')`,[e1,c1]);
const kr=(await db.query(`select id from public.correction_requests`)).rows[0].id;
R(!!await fails('jan',`select public.decide_correction($1,true)`,[kr]),'decyzja o korekcie: nie-Administrator → odmowa');
await as('admin',`select public.decide_correction($1,true)`,[kr]);
R((await db.query(`select title from public.case_entries where id=$1`,[e1])).rows[0].title==='Analiza umowy kredytowej','korekta zatwierdzona, oryginał w wersjach');
await as('admin',`update public.case_entries set deleted_at=now(),delete_reason='duplikat wpisu' where id=$1`,[e1]);
R((await as('anna',`select * from public.case_entries where id=$1`,[e1])).rows.length===0,'soft delete: znika z widoku roboczego');
R((await db.query(`select details from public.audit_log where action='wpis.usuniety'`)).rows[0]?.details.includes('Analiza umowy'),'usunięta treść zachowana w audycie');
// konflikt interesów
const st=n=>db.query(`select id from public.case_stages where case_id=$1 and sort_order=$2`,[c1,n]).then(r=>r.rows[0].id);
await as('jan',`select public.approve_stage($1)`,[await st(2)]);await as('jan',`select public.approve_stage($1)`,[await st(3)]);
R(!!await fails('jan',`select public.approve_stage($1)`,[await st(4)]),'kontrola konfliktu bez wyniku → blokada');
await as('jan',`select public.approve_stage($1,'brak konfliktu (strona przeciwna: Bank X)')`,[await st(4)]);
R((await db.query(`select status from public.case_stages where id=$1`,[await st(5)])).rows[0].status==='open','po wyniku „brak konfliktu” otwiera się kolejny etap');
// --- terminy
R(!!await fails('jan',`insert into public.deadlines(case_id,type,title,final_due_date,responsible_user_id) values($1,'statutory','Odpowiedź',current_date+1,$2)`,[c1,U.jan]),'termin ustawowy bez drugiej osoby → odrzucony');
const d1=(await as('jan',`insert into public.deadlines(case_id,type,title,trigger_date,term_length,term_unit,computed_due_date,final_due_date,responsible_user_id,second_controller_id) values($1,'statutory','Odpowiedź na pozew',current_date-13,14,'dni',current_date+1,current_date+1,$2,$3) returning id`,[c1,U.jan,U.anna])).rows[0].id;
R(!!await fails('jan',`update public.deadlines set controller_confirmed_at=now() where id=$1`,[d1]),'datę potwierdza tylko wyznaczony kontroler');
await as('anna',`update public.deadlines set controller_confirmed_at=now() where id=$1`,[d1]);
R(!!await fails('jan',`update public.deadlines set final_due_date=final_due_date+2 where id=$1`,[d1]),'zmiana daty bez uzasadnienia → odrzucona');
await as('jan',`update public.deadlines set final_due_date=final_due_date+2, change_reason='sąd przedłużył termin' where id=$1`,[d1]);
R((await db.query(`select controller_confirmed_at from public.deadlines where id=$1`,[d1])).rows[0].controller_confirmed_at===null,'po zmianie daty ustawowego — ponowna kontrola');
R(!!await fails('jan',`update public.deadlines set status='done',completed_at=current_date where id=$1`,[d1]),'„Wykonano” bez załącznika → odrzucone');
await as('admin',`insert into public.deadlines(case_id,type,title,final_due_date,responsible_user_id) values($1,'internal','Wniosek dowodowy',current_date-3,$2)`,[c1,U.jan]);
const n1=await db.query('select public.run_deadline_reminders() n');const cnt1=(await db.query('select count(*)::int n from public.notifications')).rows[0].n;
await db.query('select public.run_deadline_reminders()');const cnt2=(await db.query('select count(*)::int n from public.notifications')).rows[0].n;
R(cnt1===cnt2,`przypomnienia: każde dokładnie raz (${cnt1} = ${cnt2})`);
R((await as('admin',`select title from public.notifications where event_type='deadline.overdue'`)).rows.length>0,'przekroczony termin → eskalacja do Administratora');
R((await as('anna',`select * from public.notifications where event_type='payment.new'`)).rows.length===0,'aplikant nie dostaje powiadomień o wpłatach');
R(!!await fails('jan',`select public.run_deadline_reminders()`),'zadanie przypomnień niewywoływalne z API');
// --- odebranie dostępu
const m=(await db.query(`select id from public.case_members where user_id=$1`,[U.anna])).rows[0].id;
await as('admin',`update public.case_members set revoked_at=now(),revoked_by=$2 where id=$1`,[m,U.admin]);
R((await as('anna',`select * from public.cases`)).rows.length===0,'po odebraniu dostępu aplikant nie widzi sprawy (natychmiast)');
R((await as('anna',`select * from public.notifications where case_id is not null`)).rows.length===0,'po odebraniu dostępu — stare powiadomienia niedostępne');
// --- obsługa techniczna
R((await as('tech',`select * from public.cases`)).rows.length===0&&(await as('tech',`select * from public.clients`)).rows.length===0,'obsługa techniczna: 0 spraw i klientów');
await as('tech',`insert into public.emergency_access(reason) values('awaria indeksu wyszukiwania')`);
const em=(await db.query('select id from public.emergency_access')).rows[0].id;
R(!!await fails('admin',`update public.emergency_access set status='granted',valid_until=now()+interval '5 hours' where id=$1`,[em]),'dostęp awaryjny dłużej niż 60 min → odrzucony');
await as('admin',`update public.emergency_access set status='granted',valid_until=now()+interval '60 minutes',decided_by=$2 where id=$1`,[em,U.admin]);
R((await as('tech',`select * from public.cases`)).rows.length===2,'dostęp awaryjny po zgodzie — czasowy wgląd');
// --- uprawnienia
await as('admin',`insert into public.permission_overrides(user_id,perm,level,reason) values($1,'initial_fee',1,'rozliczenie sprawy SKD')`,[U.anna]);
R((await db.query(`select count(*)::int n from public.audit_log where action='uprawnienia.zmiana'`)).rows[0].n===1,'nadanie uprawnienia w audycie');
R(!!await fails('jan',`insert into public.permission_overrides(user_id,perm,level,reason) values($1,'audit',2,'chcę widzieć')`,[U.jan]),'nadawać uprawnienia może tylko Administrator');
R(!!await fails('admin',`update public.profiles set role='att' where id=$1`,[U.admin]),'nie można usunąć ostatniego Administratora');
// --- zgłoszenia ze strony (anon)
await as('anon',`insert into public.leads(category,calc,client_name,phone,consent) values('SKD','{"name":"SKD"}','Zofia Test','500100200',true)`);
R(true,'anonimowy formularz: INSERT zgłoszenia działa');
R(!!await fails('anon',`select * from public.leads`),'anonimowy nie odczyta zgłoszeń');
R(!!await fails('anon',`insert into public.leads(category,client_name,phone,consent,status) values('SKD','X Y','500100200',true,'przyjęte')`),'anonimowy nie ustawi statusu');
R(!!await fails('anon',`select * from public.cases`),'anonimowy: brak dostępu do spraw');
R(!!await fails('anon',`select public.reveal_pesel(gen_random_uuid())`),'anonimowy: brak dostępu do funkcji');
R((await as('kasia',`select * from public.leads`)).rows.length===1&&(await as('anna',`select * from public.leads`)).rows.length===0,'zgłoszenia widzi Biuro, aplikant nie');
// --- audyt
R(!!await fails('admin',`update public.audit_log set details='x' where id=1`),'UPDATE audytu → odmowa (Administrator)');
let su=null;try{await db.query(`delete from public.audit_log where id=1`)}catch(e){su=e.message}
R(!!su,'DELETE audytu odrzucony nawet dla właściciela bazy (trigger)');
const v=(await as('admin',`select * from public.verify_audit_chain()`)).rows[0];
R(v.ok,`łańcuch skrótów poprawny (${v.checked} wpisów)`);
await db.exec(`alter table public.audit_log disable trigger audit_no_update; update public.audit_log set details='zmienione' where id=3; alter table public.audit_log enable trigger audit_no_update;`);
const v2=(await as('admin',`select * from public.verify_audit_chain()`)).rows[0];
R(!v2.ok&&v2.broken_at==3,`manipulacja wykryta przy wpisie #${v2.broken_at}`);
R(!!await fails('jan',`select * from public.verify_audit_chain()`),'weryfikacja audytu: tylko z uprawnieniem');
const h=(await as('admin',`select text from public.case_history where case_id=$1 order by id`,[c1])).rows.map(r=>r.text);
R(h.some(t=>t.startsWith('Administrator dołączył'))&&h.some(t=>t.startsWith('Nadano zakres'))&&h.some(t=>t.startsWith('Odebrano dostęp')),'historia zespołu: dołączono / zakres / odebrano');

// --- 2FA egzekwowane w bazie (migracja 002)
AAL='aal1';
R((await as('admin',`select * from public.cases`)).rows.length===0,'Administrator bez 2FA (aal1): 0 spraw');
R((await as('jan',`select * from public.cases`)).rows.length===0,'pełnomocnik bez 2FA: 0 spraw');
R((await as('kasia',`select * from public.leads`)).rows.length===1,'biuro (2FA niewymagane) działa w aal1');
R(!!await fails('admin',`select public.reveal_pesel((select client_id from public.cases limit 1))`),'aal1: funkcje wrażliwe odrzucone');
AAL='aal2';
R((await as('admin',`select * from public.cases`)).rows.length===2,'Administrator z 2FA (aal2): widzi sprawy');
// --- magazyn akt
await as('admin',`insert into public.case_members(case_id,user_id,role,access_finance) values($1,$2,'app',false)`,[c2,U.anna]);
R(!(await fails('anna',`insert into storage.objects(bucket_id,name) values('akta',$1)`,[c2+'/x/v1-pozew.pdf'])),'aplikant w zespole: zapis pliku do akt sprawy');
R(!!await fails('anna',`insert into storage.objects(bucket_id,name) values('akta',$1)`,[c1+'/x/v1-pozew.pdf']),'aplikant spoza sprawy: zapis do akt odrzucony');
R((await as('jan',`select * from storage.objects`)).rows.length===0,'pełnomocnik spoza sprawy nie widzi plików');
R((await as('piotr',`select * from storage.objects`)).rows.length===1,'pełnomocnik prowadzący widzi plik w aktach');
R(!!await fails('anna',`insert into storage.objects(bucket_id,name) values('akta','zla-sciezka/plik.pdf')`),'zła ścieżka pliku odrzucona');
await fails('admin',`delete from storage.objects`);R((await db.query('select count(*)::int n from storage.objects')).rows[0].n===1,'pliki w aktach bez kasowania (DELETE nic nie usuwa)');

// =====================================================================
// --- Pielęgniarki (migracja 004)
// =====================================================================
Object.assign(U,{nowak:'aaaaaaaa-0000-0000-0000-000000000001',kowal:'aaaaaaaa-0000-0000-0000-000000000002',kasp:'aaaaaaaa-0000-0000-0000-000000000003'});
for(const k of ['nowak','kowal','kasp']){await db.query(`insert into auth.users(id,email) values($1,$2)`,[U[k],k+'@k.test']);await db.query(`update public.profiles set role='nurse',active=true,full_name=$2 where id=$1`,[U[k],k])}
const one=async(who,sql,p=[])=>(await as(who,sql,p)).rows[0];
const sq=(a1,o1,a2,o2)=>JSON.stringify([[[a1,o1],[a1,o2],[a2,o2],[a2,o1]]]);
await as('admin',`insert into public.districts(city,name,rings) values('Testowo','A',$1),('Testowo','B',$2)`,[sq(52,21,52.1,21.1),sq(52,21.1,52.1,21.2)]);
const svc=(await one('admin',`insert into public.nurse_services(name,duration_min,buffer_min,price) values('Morfologia + CRP',15,0,60) returning id`)).id;
const N={};
for(const [k,nm,lng] of [['nowak','Anna Nowak',21.02],['kowal','Anna Kowalska',21.06],['kasp','Anna Kasperczak',21.15]]){
  N[k]=(await one('admin',`insert into public.nurses(user_id,full_name,city,status,base_lat,base_lng) values($1,$2,'Testowo','aktywna',52.05,$3) returning id`,[U[k],nm,lng])).id;
  await as('admin',`insert into public.nurse_service_links values($1,$2)`,[N[k],svc]);
}
await as('admin',`insert into public.price_zones(city,zone_no,km_from,km_to,price_client,payout) values('Testowo',1,0,10,30,10),('Testowo',2,10,20,50,25),('Testowo',3,20,30,70,40)`);
R((await as('anna',`select * from public.nurses`)).rows.length===0&&!!await fails('anna',`insert into public.nurses(full_name) values('Ktoś Obcy')`),'aplikant: brak dostępu do pielęgniarek');
R(!!await fails('anon',`select * from public.nurse_orders`)&&!!await fails('anon',`select * from public.nurses`),'anonimowy: brak dostępu do pielęgniarek i zleceń');
R((await as('kowal',`select full_name from public.nurses`)).rows.map(r=>r.full_name).join()==='Anna Kowalska','pielęgniarka widzi tylko własną kartę');
// --- obszar: szkic → do zatwierdzenia → zatwierdzony
const ar1=(await one('nowak',`insert into public.nurse_areas(nurse_id,shapes,base_lat,base_lng,base_label) values($1,'[{"type":"districts","city":"Testowo","names":["A"]}]',52.05,21.02,'A') returning id`,[N.nowak])).id;
R(!!await fails('nowak',`insert into public.nurse_areas(nurse_id,shapes) values($1,'[]')`,[N.kowal]),'pielęgniarka nie zmieni cudzego obszaru');
R(!!await fails('nowak',`update public.nurse_areas set status='approved' where id=$1`,[ar1]),'pielęgniarka nie zatwierdzi sama obszaru');
await as('nowak',`update public.nurse_areas set status='pending' where id=$1`,[ar1]);
R((await as('admin',`select * from public.notifications where event_type='nurse.area'`)).rows.length===1,'wysłanie do zatwierdzenia → powiadomienie Administratora');
R(!(await one('admin',`select app.nurse_covers($1,52.05,21.05) v`,[N.nowak])).v,'obszar niezatwierdzony nie działa');
await as('admin',`update public.nurse_areas set status='approved' where id=$1`,[ar1]);
R((await one('admin',`select app.nurse_covers($1,52.05,21.05) v`,[N.nowak])).v&&!(await one('admin',`select app.nurse_covers($1,52.05,21.15) v`,[N.nowak])).v,'zatwierdzony obszar: dzielnica A tak, B nie');
R(!!await fails('admin',`update public.nurse_areas set shapes='[]' where id=$1`,[ar1]),'zatwierdzony obszar niezmienny (zmiana = nowy szkic)');
await as('admin',`insert into public.nurse_areas(nurse_id,shapes,status) values($1,'[{"type":"city","city":"Testowo"}]','approved'),($2,'[{"type":"polygon","points":[[52,21.1],[52,21.2],[52.1,21.2],[52.1,21.1]]}]','approved')`,[N.kowal,N.kasp]);
const ar2=(await one('admin',`insert into public.nurse_areas(nurse_id,shapes,status) values($1,'[{"type":"radius","lat":52.05,"lng":21.02,"km":3}]','approved') returning id`,[N.nowak])).id;
R((await one('admin',`select status from public.nurse_areas where id=$1`,[ar1])).status==='archived','nowy zatwierdzony obszar archiwizuje poprzedni');
await as('admin',`update public.nurse_areas set status='archived' where id=$1`,[ar2]);await as('admin',`insert into public.nurse_areas(nurse_id,shapes,status) values($1,'[{"type":"districts","city":"Testowo","names":["A"]}]','approved')`,[N.nowak]);
R((await one('admin',`select app.nurse_covers($1,52.05,21.15) v`,[N.kowal])).v&&(await one('admin',`select app.nurse_covers($1,52.05,21.15) v`,[N.kasp])).v,'obszar „całe miasto” i własny wielokąt');
// --- terminarz: od następnego tygodnia, do zatwierdzenia
const MON=(await db.query(`select (date_trunc('week',current_date)+interval '7 days')::date::text d`)).rows[0].d;
R(!!await fails('nowak',`insert into public.nurse_patterns(nurse_id,dow,time_from,time_to,valid_from) values($1,1,'08:00','11:00',current_date)`,[N.nowak]),'zmiana terminarza w bieżącym tygodniu → odrzucona');
const pt1=(await one('nowak',`insert into public.nurse_patterns(nurse_id,dow,time_from,time_to,valid_from) values($1,1,'08:00','11:00',$2) returning id`,[N.nowak,MON])).id;
R(!!await fails('nowak',`update public.nurse_patterns set status='approved' where id=$1`,[pt1]),'pielęgniarka nie zatwierdzi sama terminarza');
R((await one('admin',`select count(*)::int n from public.nurse_free_windows($1,$2::date,1)`,[N.nowak,MON])).n===0,'wzorzec niezatwierdzony nie daje terminów');
await as('admin',`update public.nurse_patterns set status='approved' where id=$1`,[pt1]);
await as('admin',`insert into public.nurse_patterns(nurse_id,dow,time_from,time_to,valid_from,status) values($1,1,'08:00','11:00',$3,'approved'),($2,1,'08:00','11:00',$3,'approved')`,[N.kowal,N.kasp,MON]);
R(!!await fails('nowak',`update public.nurse_patterns set time_to='12:00' where id=$1`,[pt1]),'zatwierdzony wzorzec: pielęgniarka tylko prosi o zakończenie');
// --- sloty dla adresu
const slots=async(lat,lng,extra='')=>(await as('admin',`select * from public.nurse_slots(${lat},${lng},$1,null,$2::date,1${extra})`,[svc,MON])).rows;
let s1=await slots(52.05,21.07);
R(s1.length===12&&s1.every(r=>+r.price_travel===30&&+r.zone_no===1),`adres w A: 2 pielęgniarki × 6 terminów 8:00–10:30, strefa 1 / 30 zł (${s1.length})`);
R((await slots(52.5,21.5)).length===0,'adres poza obszarami → brak terminów');
R(!!await fails('nowak',`select * from public.nurse_slots(52.05,21.07,$1)`,[svc]),'pielęgniarka nie odpytuje wolnych terminów innych');
const ex=(await one('admin',`insert into public.nurse_exceptions(nurse_id,date_from,date_to,kind,status) values($1,$2,$2,'urlop','approved') returning id`,[N.kowal,MON])).id;
R((await slots(52.05,21.07)).length===6,'urlop zdejmuje terminy pielęgniarki');
await as('admin',`delete from public.nurse_exceptions where id=$1`,[ex]);
R(!!await fails('kowal',`insert into public.nurse_exceptions(nurse_id,date_from,date_to,kind,status) values($1,$2,$2,'urlop','approved')`,[N.kowal,MON]),'wyjątek pielęgniarki czeka na zatwierdzenie');
// --- przydział: proporcjonalnie, akceptacja, odrzucenie, limit czasu, dyspozytor
const rule=(await one('admin',`insert into public.assignment_rules(city,kind) values('Testowo','weighted') returning id`)).id;
await as('admin',`insert into public.assignment_pool(rule_id,nurse_id,weight,sort_order) values($1,$2,2,1),($1,$3,1,2)`,[rule,N.nowak,N.kowal]);
const at=h=>`(('${MON}'::date+'${h}'::time) at time zone 'Europe/Warsaw')`;
const order=async(h,extra={})=>(await one('admin',`select public.create_nurse_order($1) id`,[JSON.stringify({client_name:'Jan Klient',address:'ul. Testowa 1',lat:52.05,lng:21.07,city:'Testowo',service_id:svc,start_at:(await db.query(`select ${at(h)}::text t`)).rows[0].t,...extra})])).id;
const O=id=>db.query(`select * from public.nurse_orders where id=$1`,[id]).then(r=>r.rows[0]);
const o1=await order('08:00');let x=await O(o1);
R(x.status==='zaproponowane'&&x.nurse_id===N.nowak,'nowe zlecenie → propozycja wg wag (Nowak 2 : Kowalska 1)');
R(+x.price_travel===30&&+x.payout_travel===10&&+x.margin===20&&+x.price_service===60,'kwoty zapisane w zleceniu: dojazd 30 zł, wypłata 10 zł, marża 20 zł');
R((await as('nowak',`select * from public.notifications where event_type='order.proposed'`)).rows.length===1,'pielęgniarka dostaje powiadomienie o zleceniu');
R((await as('nowak',`select * from public.nurse_orders`)).rows.length===0&&(await as('nowak',`select * from public.my_orders()`)).rows.length===1,'pielęgniarka: zlecenia tylko przez własny panel');
R(!('margin' in (await as('nowak',`select * from public.my_orders()`)).rows[0]),'panel pielęgniarki bez ceny dla klienta i marży');
R((await as('kowal',`select * from public.my_orders()`)).rows.length===0&&!!await fails('kowal',`select public.respond_order($1,true)`,[o1]),'cudzego zlecenia nie widać i nie da się przyjąć');
await as('nowak',`select public.respond_order($1,false)`,[o1]);x=await O(o1);
R(x.status==='zaproponowane'&&x.nurse_id===N.kowal,'odrzucenie → następna osoba z puli');
await as('kowal',`select public.respond_order($1,true)`,[o1]);x=await O(o1);
R(x.status==='przyjete'&&x.accepted_at,'pielęgniarka przyjmuje zlecenie');
const o2=await order('08:00');x=await O(o2);
R(x.nurse_id===N.nowak,'ten sam termin: Kowalska zajęta (wizyta + dojazd) → Nowak');
await db.query(`update public.nurse_orders set expires_at=now()-interval '1 minute' where id=$1`,[o2]);
R(!!await fails('nowak',`select public.run_order_timeouts()`),'zadanie limitu czasu niewywoływalne z API');
await db.query('select public.run_order_timeouts()');x=await O(o2);
R(x.status==='nowe'&&x.needs_dispatcher&&!x.nurse_id,'brak akceptacji w limicie czasu, brak innych chętnych → dyspozytor');
R((await db.query(`select result from public.order_attempts where order_id=$1`,[o2])).rows.map(r=>r.result).join()==='brak_odpowiedzi','próba zapisana jako „brak odpowiedzi”');
R((await as('admin',`select * from public.notifications where event_type='order.dispatch'`)).rows.length>=1,'dyspozytor dostaje powiadomienie');
R((await as('admin',`select * from public.order_candidates($1)`,[o2])).rows.map(r=>r.nurse_id+':'+r.attempted).join()===N.nowak+':brak_odpowiedzi'&&!!await fails('nowak',`select * from public.order_candidates($1)`,[o2]),'dyspozytor widzi kandydatów (z historią odmów); pielęgniarka nie');
R(!!await fails('admin',`select public.dispatch_order($1,$2)`,[o2,N.kasp]),'dyspozytor: pielęgniarka spoza obszaru → odrzucone');
await as('admin',`select public.dispatch_order($1,$2)`,[o2,N.nowak]);x=await O(o2);
R(x.status==='zaproponowane'&&x.nurse_id===N.nowak,'dyspozytor przydziela ręcznie (nadal wymaga akceptacji)');
// --- statusy
R(!!await fails('kowal',`select public.advance_order($1,'rozliczone')`,[o1]),'pielęgniarka nie rozlicza zlecenia');
await as('kowal',`select public.advance_order($1,'w_drodze')`,[o1]);await as('kowal',`select public.advance_order($1,'wykonane')`,[o1]);await as('admin',`select public.advance_order($1,'rozliczone')`,[o1]);
R((await O(o1)).status==='rozliczone','statusy: przyjęte → w drodze → wykonane → rozliczone');
await as('admin',`update public.price_zones set price_client=35 where city='Testowo' and zone_no=1`);
R(+(await O(o1)).price_travel===30,'zmiana cennika nie zmienia zapisanych zleceń');
// --- nadpisanie stawki dla pielęgniarki
await as('admin',`insert into public.price_zones(nurse_id,zone_no,payout) values($1,1,15)`,[N.kowal]);
const z=await one('admin',`select * from app.zone($1,1.0)`,[N.kowal]);
R(+z.price_client===35&&+z.payout===15,'nadpisanie: inna wypłata, cena dla klienta z szablonu');
R((await as('kowal',`select * from public.price_zones`)).rows.length===0&&+(await as('kowal',`select * from public.my_rates()`)).rows[0].payout===15,'pielęgniarka widzi tylko swoje wypłaty (my_rates)');
// --- nakładające się obszary: odległość
await as('admin',`update public.nurse_settings set overlap_mode='distance'`);
const o3=await order('09:30');x=await O(o3);
R(x.nurse_id===N.kowal&&(await db.query(`select via from public.order_attempts where order_id=$1`,[o3])).rows[0].via==='odleglosc','tryb „odległość”: najbliższa pielęgniarka');
await as('admin',`update public.nurse_settings set overlap_mode='rule'`);
// --- kolejka z limitem
await as('admin',`update public.assignment_rules set kind='queue' where id=$1`,[rule]);await as('admin',`update public.assignment_pool set queue_limit=1 where rule_id=$1 and nurse_id=$2`,[rule,N.nowak]);
const o4=await order('10:30');
R((await O(o4)).nurse_id===N.kowal,'kolejka z limitem: limit Nowak wyczerpany → kolejna osoba');
await as('admin',`update public.assignment_rules set kind='manual' where id=$1`,[rule]);
const o5=await order('10:30');x=await O(o5);
R(x.status==='nowe'&&x.needs_dispatcher,'reguła „ręcznie” → zlecenie czeka na dyspozytora');
// --- limit dzienny
await as('admin',`update public.nurse_settings set max_visits_per_day=1`);
R((await slots(52.05,21.07)).filter(r=>r.nurse_id===N.kowal).length===0,'limit dzienny wyczerpany → brak terminów');
await as('admin',`update public.nurse_settings set max_visits_per_day=8`);
R(!!await fails('admin',`select public.create_nurse_order($1)`,[JSON.stringify({client_name:'Jan Klient',address:'Daleko 1',lat:52.5,lng:21.5,city:'Testowo',service_id:svc,start_at:(await db.query(`select ${at('08:00')}::text t`)).rows[0].t})]),'adres bez pokrycia → zlecenie odrzucone (lista oczekujących)');
await as('nowak',`update public.nurse_settings set overlap_mode='distance'`).catch(()=>{});
R((await db.query('select overlap_mode from public.nurse_settings')).rows[0].overlap_mode==='rule','ustawienia zmienia tylko Administrator');
R((await db.query(`select count(*)::int n from public.audit_log where action like 'zlecenie.%' or action like 'pielegniark%'`)).rows[0].n>10,'operacje na pielęgniarkach i zleceniach w audycie');
