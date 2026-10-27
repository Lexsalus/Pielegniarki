/* =====================================================================
   LOGI DZIAŁAŃ (migracja 012) — do szukania błędów.
   Zapisuje: kliknięcia (tekst przycisku / podpowiedź), przejścia między widokami,
   błędy strony i bazy. Bez treści wpisywanej w pola i bez treści czatu.
   Wysyłka paczkami co 15 s, od razu po błędzie i przy zamykaniu karty.
   ===================================================================== */
const LOG={buf:[],busy:false,off:false};
const logDevice=()=>{const u=navigator.userAgent,b=/Edg\//.test(u)?'Edge':/OPR\//.test(u)?'Opera':/Firefox\//.test(u)?'Firefox':/Chrome\//.test(u)?'Chrome':/Safari\//.test(u)?'Safari':'?';
  const o=/Android/.test(u)?'Android':/iPhone|iPad/.test(u)?'iOS':/Windows/.test(u)?'Windows':/Mac OS/.test(u)?'macOS':/Linux/.test(u)?'Linux':'?';
  const pwa=matchMedia('(display-mode: standalone)').matches?' · aplikacja':'';return `${b} / ${o} · ${innerWidth}×${innerHeight}${pwa}`};
function logAdd(kind,label,detail=''){if(!ME||LOG.off)return;
  LOG.buf.push({at:new Date().toISOString(),kind,label:String(label||'').slice(0,300),view:location.hash||'#/',detail:String(detail||'').slice(0,1000),version:typeof APP_VER!=='undefined'?APP_VER:'',device:logDevice()});
  if(LOG.buf.length>300)LOG.buf.splice(0,LOG.buf.length-300);
  if(kind==='error')logFlush()}
async function logFlush(){if(LOG.busy||!LOG.buf.length||!ME)return;LOG.busy=true;const b=LOG.buf.splice(0,200);
  try{const r=await sb.rpc('log_batch',{p:b});if(r.error){if(/log_batch/.test(r.error.message||''))LOG.off=true;else LOG.buf.unshift(...b)}}catch(e){LOG.buf.unshift(...b)}finally{LOG.busy=false}}
setInterval(logFlush,15000);
addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')logFlush()});

/* co kliknięto: podpowiedź / podpis / tekst przycisku; w czacie tylko rodzaj akcji (bez treści) */
function logLabel(el){
  if(el.closest('#chatBox')){const b=el.closest('button,a,textarea');return 'czat: '+(b?.getAttribute('aria-label')||(b?.classList.contains('chi')?'otwórz rozmowę':b?.tagName==='TEXTAREA'?'pole wiadomości':(b?.innerText||'').trim().slice(0,30))||'?')}
  if(el.closest('#ntBox'))return el.matches('button')?'powiadomienia: '+(el.innerText||'').trim().slice(0,40):'powiadomienia: otwórz powiadomienie';
  // tylko krótkie podpisy przycisków / zakładek; większe elementy (mogą zawierać dane pacjentów) — opisowo
  const own=(el.innerText||'').replace(/\s+/g,' ').trim(),small=el.matches('button,.tab,.chip,.nav,a.btn')&&own.length<=60;
  const t=(el.getAttribute('aria-label')||'').trim()||(small?own:'')||(el.getAttribute('data-tip')||el.title||'').trim().slice(0,80)||(el.classList.contains('nzrow')?'karta pielęgniarki: '+(el.querySelector('b')?.innerText||'').slice(0,40):'')||el.name||el.id||(el.tagName.toLowerCase()+(el.classList[0]?'.'+el.classList[0]:''));
  const where=el.closest('#mbox')?.querySelector('.mhead h2')?.innerText;return (where?where+' → ':'')+t}
document.addEventListener('click',e=>{const el=e.target.closest?.('button,a,[onclick],.chip,.tab,.nav,.nzrow,.chi,summary,label,input[type=checkbox],input[type=radio]');if(!el||el.closest('#tip'))return;
  if(el.matches('input[type=checkbox],input[type=radio]'))return logAdd('click',`${el.closest('label')?.innerText?.trim().slice(0,60)||el.name||el.id} = ${el.checked?'tak':'nie'}`);
  logAdd('click',logLabel(el))},true);
document.addEventListener('change',e=>{const el=e.target;if(el.matches?.('select'))logAdd('click',`wybór: ${(el.closest('label')?.childNodes[0]?.textContent||el.name||el.id||'lista').trim().slice(0,60)}`)},true);
addEventListener('hashchange',()=>logAdd('nav',location.hash));
addEventListener('error',e=>logAdd('error',e.message||'Błąd skryptu',`${(e.filename||'').split('/').pop()}:${e.lineno||''}:${e.colno||''} ${e.error?.stack?.split('\n').slice(0,4).join(' | ')||''}`));
addEventListener('unhandledrejection',e=>logAdd('error',String(e.reason?.message||e.reason||'Błąd'),e.reason?.stack?.split('\n').slice(0,4).join(' | ')||''));
{const t0=toast;toast=function(m,err){if(err)logAdd('error',String(m||''),'komunikat na ekranie');return t0.apply(this,arguments)}}
{const lo=$('#logout').onclick;$('#logout').onclick=async e=>{logAdd('info','wylogowanie');await logFlush();return lo(e)}}

/* ---- podgląd logów (Administrator, „Użytkownicy” → 📋) ---- */
const LOGK={click:['Kliknięcie',''],nav:['Widok','b-info'],error:['Błąd','b-bad'],info:['Info','']};
async function logView(uid){const who=AKROWS.find(r=>r.user_id===uid);const name=who?.full_name||who?.email||'';LOG.v={uid,h:24,err:false,name};
  modal('Logi: '+name,`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px"><select class="f" id="lgH" style="width:auto"><option value="1">ostatnia godzina</option><option value="24" selected>24 godziny</option><option value="168">7 dni</option><option value="720">30 dni</option></select>
    <label class="chk"><input type="checkbox" id="lgE"> tylko błędy</label><span style="flex:1"></span><button type="button" class="btn sm" id="lgCsv">Eksport CSV</button><button type="button" class="btn sm" id="lgR">Odśwież</button></div><div id="lgBox"><div class="empty">Wczytywanie…</div></div>`,{ok:'',cancel:'Zamknij',wide:true});
  $('#lgH').onchange=e=>{LOG.v.h=+e.target.value;logLoad()};$('#lgE').onchange=e=>{LOG.v.err=e.target.checked;logLoad()};$('#lgR').onclick=logLoad;$('#lgCsv').onclick=logCsv;logLoad()}
async function logLoad(){const r=await sb.rpc('user_logs_for',{p_user:LOG.v.uid,p_hours:LOG.v.h,p_errors:LOG.v.err});const B=$('#lgBox');if(!B)return;
  if(r.error){B.innerHTML=`<div class="empty">Błąd: ${esc(errMsg(r.error))}</div>`;return}LOG.rows=r.data||[];
  const ne=LOG.rows.filter(x=>x.kind==='error').length;
  const vs=[...new Set(LOG.rows.map(x=>x.version).filter(Boolean))];
  B.innerHTML=LOG.rows.length?`<p class="mut small" style="margin-bottom:6px">${LOG.rows.length} wpisów${ne?` · <b style="color:var(--bad)">${ne} błędów</b>`:''} · najnowsze na górze${vs.length?` · wersje: <b data-notr>${vs.map(v=>'v'+esc(v)).join(', ')}</b>`:''}</p><div class="tw" style="max-height:60vh;overflow:auto"><table class="lgt"><tr><th>Czas</th><th>Rodzaj</th><th>Co</th><th>Widok</th><th>Wersja</th><th>Szczegóły</th></tr>${LOG.rows.map(x=>`<tr class="${x.kind==='error'?'lgerr':''}"><td style="white-space:nowrap">${esc(new Date(x.at).toLocaleString(LOC(),{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}))}</td><td><span class="badge ${LOGK[x.kind]?.[1]||''}">${LOGK[x.kind]?.[0]||esc(x.kind)}</span></td><td data-notr>${esc(x.label)}</td><td class="small mut" data-notr>${esc(x.view)}</td><td class="small" style="white-space:nowrap" data-notr>${x.version?'v'+esc(x.version):'—'}</td><td class="small mut" data-notr>${esc(x.detail)}${x.kind==='error'?`<br>${esc(x.device)}`:''}</td></tr>`).join('')}</table></div>`:'<div class="empty">Brak wpisów w tym okresie</div>'}
function logCsv(){const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';const csv=['czas;rodzaj;co;widok;szczegóły;wersja;urządzenie',...(LOG.rows||[]).map(x=>[x.at,x.kind,x.label,x.view,x.detail,x.version,x.device].map(q).join(';'))].join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv'}));a.download=`logi_${(LOG.v.name||'').replace(/[^\p{L}\p{N}]+/gu,'_')}_${new Date().toISOString().slice(0,10)}.csv`;a.click()}
