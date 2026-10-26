// Lokalny „Supabase” do testów: PGlite + schemat + migracje; mini-API dla nakładki supabase-js
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'fs'; import http from 'http';
const ROOT=new URL('../../', import.meta.url).pathname;  // katalog supabase/
const db=new PGlite({extensions:{pgcrypto},parsers:{1082:v=>v,1083:v=>v}});  // date i time jako tekst — jak PostgREST
await db.exec(`create role anon nologin; create role authenticated nologin;
create schema auth; create schema extensions; create extension pgcrypto schema extensions;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid(), auth.jwt() to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
create schema storage; grant usage on schema storage to anon, authenticated;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid());
alter table storage.objects enable row level security; grant select, insert on storage.objects to authenticated;`);
await db.exec(fs.readFileSync(ROOT+'schema.sql','utf8'));
for(const m of fs.readdirSync(ROOT+'migrations').sort())await db.exec(fs.readFileSync(ROOT+'migrations/'+m,'utf8'));
const USERS={'admin@k.test':['11111111-1111-1111-1111-111111111111','admin','Admin'],'jan@k.test':['22222222-2222-2222-2222-222222222222','att','Jan Nowak'],'piotr@k.test':['33333333-3333-3333-3333-333333333333','att','Piotr Wiśniewski'],
 'anna@k.test':['44444444-4444-4444-4444-444444444444','app','Anna Kowalska'],'kasia@k.test':['55555555-5555-5555-5555-555555555555','office','Katarzyna Lis'],'tech@k.test':['66666666-6666-6666-6666-666666666666','tech','Tomasz Kamiński'],'nowy@k.test':['77777777-7777-7777-7777-777777777777',null,''],
 'nowak@k.test':['aaaaaaaa-0000-0000-0000-000000000001','nurse','Anna Nowak'],'kowal@k.test':['aaaaaaaa-0000-0000-0000-000000000002','nurse','Anna Kowalska']};
for(const [e,[id]] of Object.entries(USERS))await db.query('insert into auth.users(id,email) values($1,$2)',[id,e]);
for(const [e,[id,role,name]] of Object.entries(USERS))if(role)await db.query('update public.profiles set role=$2,active=true,full_name=$3 where id=$1',[id,role,name]);
// zgłoszenie ze strony (anon)
const asRole=async(sub,aal,fn)=>{await db.exec('begin');try{await db.exec(`set local role ${sub?'authenticated':'anon'}`);await db.query(`select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)`,[sub||'',JSON.stringify({aal})]);const r=await fn();await db.exec('commit');return r}catch(e){await db.exec('rollback');throw e}};
await asRole(null,'aal1',()=>db.query(`insert into public.leads(category,calc,client_name,phone,email,message,consent) values('SKD',$1,'Zofia Testowa','500100200','z@test.pl','Kredyt gotówkowy z 2023',true)`,[JSON.stringify({name:'Sankcja kredytu darmowego',inputs:[{label:'Kwota wypłacona do ręki',value:30000,unit:'zł'}],outputs:[{label:'Szacowana korzyść',value:15894,unit:'zł',main:true}]})]));
const PK={permission_overrides:['user_id','perm'],currencies:['code'],case_categories:['code'],assignment_pool:['rule_id','nurse_id'],nurse_service_links:['nurse_id','service_id'],nurse_settings:['id']};
const ident=s=>{if(!/^[a-z_][a-z0-9_]*$/.test(s))throw new Error('bad ident '+s);return s};
async function handle(q){
  return asRole(q.sub,q.aal||'aal1',async()=>{
    if(q.kind==='rpc'){const keys=Object.keys(q.args||{}),p=keys.map((k,i)=>`${ident(k)} => $${i+1}`).join(',');
      const r=await db.query(`select * from public.${ident(q.name)}(${p})`,keys.map(k=>q.args[k]!==null&&typeof q.args[k]==='object'?JSON.stringify(q.args[k]):q.args[k]));
      if(r.fields.length===1&&r.fields[0].name===q.name)return r.rows[0]?.[q.name]??null;return r.rows}
    if(q.kind==='storage'){await db.query(`insert into storage.objects(bucket_id,name) values($1,$2)`,[q.bucket,q.path]);return {path:q.path}}
    const T='public.'+ident(q.table),params=[],ph=v=>{params.push(v!==null&&typeof v==='object'?JSON.stringify(v):v);return '$'+params.length};
    const where=(q.filters||[]).map(([op,c,v])=>op==='eq'?`${ident(c)} = ${ph(v)}`:op==='is'?`${ident(c)} is ${v===null?'null':v}`:'true').join(' and ')||'true';
    if(q.op==='select'){let sql=`select * from ${T} where ${where}`;if(q.order)sql+=` order by ${ident(q.order[0])} ${q.order[1]?'asc':'desc'}`;if(q.limit)sql+=` limit ${+q.limit}`;const r=await db.query(sql,params);return r.rows}
    const rows=Array.isArray(q.values)?q.values:[q.values];
    if(q.op==='insert'||q.op==='upsert'){const out=[];for(const row of rows){params.length=0;const cols=Object.keys(row);let sql=`insert into ${T}(${cols.map(ident).join(',')}) values (${cols.map(c=>ph(row[c])).join(',')})`;
      if(q.op==='upsert'){const pk=q.onConflict?q.onConflict.split(',').map(ident):PK[q.table]||['id'];sql+=` on conflict (${pk.join(',')}) do update set ${cols.filter(c=>!pk.includes(c)).map(c=>`${c}=excluded.${c}`).join(',')}`}
      if(q.returning)sql+=' returning *';const r=await db.query(sql,params);out.push(...r.rows)}return out}
    if(q.op==='update'){const row=q.values,set=Object.keys(row).map(c=>`${ident(c)} = ${ph(row[c])}`).join(',');const r=await db.query(`update ${T} set ${set} where ${where} returning *`,params);return q.returning?r.rows:(r.rows.length?[]:[])}
    if(q.op==='delete'){await db.query(`delete from ${T} where ${where}`,params);return []}
  });
}
http.createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');res.setHeader('Content-Type','application/json');
  if(req.method==='OPTIONS'){res.end();return}
  let body='';for await(const ch of req)body+=ch;const q=body?JSON.parse(body):{};
  try{
    if(req.url==='/login'){const u=USERS[q.email];if(!u||q.password!=='Haslo-testowe-123'){res.end(JSON.stringify({error:{message:'Invalid login credentials'}}));return}res.end(JSON.stringify({data:{id:u[0],email:q.email}}));return}
    if(req.url==='/sql'){const r=await db.query(q.sql,q.params||[]);res.end(JSON.stringify({data:r.rows}));return}
    const data=await handle(q);res.end(JSON.stringify({data}));
  }catch(e){res.end(JSON.stringify({error:{message:e.message,code:e.code}}))}
}).listen(9900,()=>console.log('lokalny Supabase: http://localhost:9900'));
