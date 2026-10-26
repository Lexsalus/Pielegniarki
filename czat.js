/* =====================================================================
   KOMUNIKATOR WEWNĘTRZNY (migracja 006)
   Dymek w prawym dolnym rogu → lista osób (zielona kropka = zalogowana) i wątków zleceń.
   Rozmowa 1:1 albo wątek przy zleceniu. ✓ wysłane · ✓✓ doręczone · ✓✓ (kolor) przeczytane.
   Pielęgniarka pisze tylko z Administratorem / dyspozytorem; Administrator — z każdym (pilnuje baza).
   ===================================================================== */
const CH={state:null,open:false,view:'list',with:null,order:null,num:null,msgs:[],readers:[],rt:null,missing:false};
document.body.insertAdjacentHTML('beforeend',`<button id="chatFab" type="button" hidden data-tip="Wiadomości">💬<span class="dot" hidden></span></button><div id="chatBox" role="dialog" aria-label="Wiadomości"></div>`);
const chatName=id=>(CH.state?.contacts||[]).find(c=>c.user_id===id)?.full_name||DB?.users?.find(u=>u.id===id)?.name||'—';
const chatTime=v=>{const d=new Date(v),t=new Date();return d.toDateString()===t.toDateString()?`${d.getHours()}:${pad(d.getMinutes())}`:`${pad(d.getDate())}.${pad(d.getMonth()+1)} ${d.getHours()}:${pad(d.getMinutes())}`};
const chatSt=c=>c.status||(c.online?'online':'offline');
const CHST={online:'Zalogowany teraz',busy:'Zajęty — może odpowiedzieć później',offline:'Niezalogowany — wiadomość zostanie doręczona po zalogowaniu'};
const CHSTS={online:'zalogowany',busy:'zajęty',offline:'niezalogowany'};
const chatUnread=()=>(CH.state?.contacts||[]).reduce((s,c)=>s+c.unread,0)+(CH.state?.orders||[]).reduce((s,t)=>s+t.unread,0);
function chatBadge(){const f=$('#chatFab');if(!f)return;f.hidden=!ME||CH.missing;const n=chatUnread(),d=f.querySelector('.dot');d.hidden=!n;d.textContent=n>99?'99+':n}
/* przycisk wątku przy zleceniu (lista zleceń, panel pielęgniarki) */
function chatBtn(oid,num){if(CH.missing)return '';const u=(CH.state?.orders||[]).find(t=>t.order_id===oid)?.unread||0;
  return `<button class="btn sm" type="button" data-tip="Wątek zlecenia: rozmowa pielęgniarki z Administratorem / dyspozytorem" onclick="chatOpenOrder('${oid}',${+num})">💬${u?` <span class="badge b-bad">${u}</span>`:''}</button>`}

async function chatSync(){
  if(!ME)return;
  const r=await sb.rpc('chat_state');
  if(r.error){if(/chat_state/.test(r.error.message||''))CH.missing=true;chatBadge();return}
  CH.missing=false;CH.state=r.data||{contacts:[],orders:[]};chatBadge();chatAvail();
  if(CH.open){if(CH.view==='list')chatDraw();else await chatLoad()}
}
async function chatLoad(){
  const args=CH.view==='dm'?{p_with:CH.with}:{p_order:CH.order};
  const [h,rd]=await Promise.all([sb.rpc('chat_history',args),CH.view==='order'?sb.rpc('chat_order_readers',{p_order:CH.order}):Promise.resolve({data:[]})]);
  if(h.error){toast(errMsg(h.error),true);return}
  CH.msgs=h.data||[];CH.readers=rd.data||[];chatDraw();
  const unreadHere=CH.view==='dm'?CH.msgs.some(m=>m.sender_id===CH.with&&!m.read_at):CH.msgs.some(m=>m.sender_id!==ME.id);
  if(CH.open&&document.visibilityState==='visible'&&unreadHere){await sb.rpc('chat_read',args);
    if(CH.view==='dm')CH.msgs.forEach(m=>{if(m.sender_id===CH.with&&!m.read_at)m.read_at=new Date().toISOString()});
    const c=CH.view==='dm'?(CH.state?.contacts||[]).find(x=>x.user_id===CH.with):(CH.state?.orders||[]).find(x=>x.order_id===CH.order);if(c)c.unread=0;
    (DB.notifs||[]).forEach(n=>{if(n.link===(CH.view==='dm'?'czat:u:'+CH.with:'czat:o:'+CH.order)&&!n.read_at)n.read_at=new Date().toISOString()});
    chatBadge();renderShell()}
}
const chatDT=v=>{const d=new Date(v);return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()} ${d.getHours()}:${pad(d.getMinutes())}`};
/* pod wiadomością: data i godzina wysłania oraz doręczenia / odczytu */
function chatMeta(m){
  const sent=`<span>Wysłano ${chatDT(m.created_at)}</span>`;
  if(m.sender_id!==ME.id)return sent+(m.delivered_at&&!m.order_id?`<span>Odebrano ${chatDT(m.delivered_at)}</span>`:'');
  if(m.order_id){const rs=CH.readers.filter(r=>r.user_id!==ME.id&&new Date(r.last_read_at)>=new Date(m.created_at));
    return sent+(rs.length?`<span class="ck rd">✓✓</span><span>Przeczytali: ${esc(rs.map(r=>r.full_name).join(', '))}</span>`:`<span class="ck">✓</span>`)}
  return sent+(m.read_at?`<span class="ck rd">✓✓</span><span>Przeczytano ${chatDT(m.read_at)}</span>`:m.delivered_at?`<span class="ck">✓✓</span><span>Doręczono ${chatDT(m.delivered_at)}</span>`:`<span class="ck">✓</span><span>Czeka na doręczenie</span>`)}
function chatDraw(){
  const B=$('#chatBox');B.classList.toggle('show',CH.open);if(!CH.open)return;
  const head=(t,back)=>`<div class="chh">${back?`<button class="icon-btn" type="button" onclick="chatList()" aria-label="Wróć">←</button>`:''}<b>${t}</b><button class="icon-btn" type="button" onclick="chatClose()" aria-label="Zamknij">✕</button></div>`;
  if(CH.view==='list'){const S=CH.state||{contacts:[],orders:[]};
    B.innerHTML=head('Wiadomości')+`<div class="chl">${S.contacts.length?`<div class="chsec">Osoby</div>`+S.contacts.map(c=>`<button type="button" class="chi" onclick="chatOpenUser('${c.user_id}')"><span class="av sm" style="position:relative">${esc(initials(c.full_name))}<i class="ond ${chatSt(c)}" data-tip="${CHST[chatSt(c)]}"></i></span><span class="cht"><b>${esc(c.full_name)} ${typeof devIcon==='function'?devIcon(c.device):''}</b><small>${esc(c.last_body||ROLES[c.role]||'')}</small></span>${c.unread?`<span class="cnt">${c.unread}</span>`:''}</button>${c.phone?`<a class="chtel" href="tel:${esc(c.phone.replace(/[^+0-9]/g,''))}" data-tip="Zadzwoń: ${esc(c.phone)}" onclick="event.stopPropagation()">📞</a>`:''}`).map(x=>`<div class="chrow">${x}</div>`).join(''):'<div class="empty small">Brak osób, z którymi możesz pisać</div>'}
      ${S.orders.length?`<div class="chsec">Wątki zleceń</div>`+S.orders.map(t=>`<button type="button" class="chi" onclick="chatOpenOrder('${t.order_id}',${t.number})"><span class="av sm">#</span><span class="cht"><b>Zlecenie #${t.number}</b><small>${esc(t.last_body||'')}</small></span>${t.unread?`<span class="cnt">${t.unread}</span>`:''}</button>`).join(''):''}</div>`;
    return}
  const title=CH.view==='dm'?esc(chatName(CH.with)):`Zlecenie #${CH.num}`;
  const cc=CH.view==='dm'&&(CH.state?.contacts||[]).find(c=>c.user_id===CH.with);
  B.innerHTML=head(title+(cc?` <small class="mut st-${chatSt(cc)}">● ${CHSTS[chatSt(cc)]}</small>${cc.phone?` <a class="chtel" href="tel:${esc(cc.phone.replace(/[^+0-9]/g,''))}" data-tip="Zadzwoń">📞 ${esc(cc.phone)}</a>`:''}`:''),true)+
    `<div class="chm" id="chMsgs">${CH.msgs.map(m=>`<div class="msg ${m.sender_id===ME.id?'me':''}">${CH.view==='order'&&m.sender_id!==ME.id?`<small class="who">${esc(chatName(m.sender_id))}</small>`:''}<div class="bub">${esc(m.body).replace(/\n/g,'<br>')}</div><small class="meta">${chatMeta(m)}</small></div>`).join('')||'<div class="empty small">Brak wiadomości — napisz pierwszą.</div>'}</div>
    <form class="chf" onsubmit="event.preventDefault();chatSend()"><textarea id="chIn" rows="2" maxlength="4000" placeholder="Napisz wiadomość… (Enter — wyślij, Shift+Enter — nowa linia)"></textarea><button class="btn pri" type="submit">Wyślij</button></form>`;
  const M=$('#chMsgs');M.scrollTop=M.scrollHeight;const I=$('#chIn');
  I.value=CH.draft||'';I.oninput=()=>CH.draft=I.value;
  I.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();chatSend()}};setTimeout(()=>I.focus(),20);
}
async function chatSend(){const I=$('#chIn'),t=I.value.trim();if(!t)return;I.disabled=true;
  const r=await sb.rpc('chat_send',CH.view==='dm'?{p_to:CH.with,p_body:t}:{p_order:CH.order,p_body:t});I.disabled=false;
  if(r.error)return toast(errMsg(r.error),true);CH.draft='';await chatLoad();chatSync()}
function chatOpenUser(id){CH.open=true;CH.view='dm';CH.with=id;CH.order=null;CH.msgs=[];CH.draft='';chatDraw();chatLoad()}
function chatOpenOrder(id,num){CH.open=true;CH.view='order';CH.order=id;CH.num=num;CH.with=null;CH.msgs=[];CH.draft='';chatDraw();chatLoad()}
function chatList(){CH.view='list';CH.with=CH.order=null;chatDraw();chatSync()}
function chatClose(){CH.open=false;chatDraw()}
$('#chatFab').onclick=()=>{if(CH.open)return chatClose();CH.open=true;CH.view='list';chatDraw();chatSync()};
addEventListener('keydown',e=>{if(e.key==='Escape'&&CH.open&&!$('#modal').classList.contains('show'))chatClose()});

/* odświeżanie: na żywo (Supabase Realtime), a dodatkowo co 10 s */
function chatStart(){chatSync();
  if(!CH.rt&&typeof sb.channel==='function'){try{CH.rt=sb.channel('czat').on('postgres_changes',{event:'*',schema:'public',table:'chat_messages'},()=>chatSync()).subscribe(st=>{CH.live=st==='SUBSCRIBED'})}catch(e){console.warn('realtime',e)}}}
function chatStop(){CH.open=false;CH.state=null;chatDraw();chatBadge();if(CH.rt){try{sb.removeChannel(CH.rt)}catch(e){}CH.rt=null}CH.live=false}
/* zapasowe sprawdzanie: co 30 s, gdy działa połączenie na żywo, inaczej co 10 s */
setInterval(()=>{if(!ME||document.visibilityState!=='visible')return;CH.tick=(CH.tick||0)+1;if(!CH.live||CH.tick%3===0)chatSync()},10000);
{const base=renderShell;renderShell=function(){base.apply(this,arguments);if(ME&&!CH.started){CH.started=true;chatStart()}chatBadge()}}
{const lo=$('#logout').onclick;$('#logout').onclick=async e=>{chatStop();CH.started=false;await lo(e)}}

/* status Administratora / dyspozytora: Dostępny / Zajęty / Niewidoczny (menu po kliknięciu nazwy u góry) */
const MYST={online:['🟢','Dostępny'],busy:['🟠','Zajęty'],invisible:['⚪','Niewidoczny']};
function chatMe(){const b=$('#meBox');if(!b||!ME)return;const m=CH.state?.me;b.classList.toggle('stbox',!!m?.can_status);
  b.querySelector('.mystat')?.remove();if(!m?.can_status)return;
  b.insertAdjacentHTML('beforeend',`<span class="mystat" data-tip="Twój status: ${MYST[m.status][1]} — kliknij, aby zmienić">${MYST[m.status][0]}</span>`)}
document.addEventListener('click',async e=>{const mb=e.target.closest?.('#meBox.stbox'),it=e.target.closest?.('[data-myst]');$('#stMenu')?.remove();
  if(it){const r=await sb.rpc('set_my_status',{p_status:it.dataset.myst});if(r.error)return toast(errMsg(r.error),true);if(CH.state?.me)CH.state.me.status=it.dataset.myst;chatMe();toast('Status: '+MYST[it.dataset.myst][1]);return}
  if(!mb)return;const r=mb.getBoundingClientRect();
  document.body.insertAdjacentHTML('beforeend',`<div id="stMenu" style="top:${r.bottom+6}px;right:${innerWidth-r.right}px">${Object.entries(MYST).map(([k,[i,l]])=>`<button type="button" data-myst="${k}" class="${CH.state?.me?.status===k?'on':''}">${i} ${l}<small>${{online:'widoczny jako zalogowany',busy:'widoczny jako zajęty',invisible:'dla wszystkich wyglądasz na niezalogowanego'}[k]}</small></button>`).join('')}</div>`)});
{const base=chatBadge;chatBadge=function(){base();chatMe()}}

/* „X jest dostępny”: Administrator / dyspozytor zalogował się ze statusem Dostępny albo zmienił status na Dostępny */
function chatChime(){try{const A=window.AudioContext||window.webkitAudioContext;if(!A)return;const c=CH.ac||(CH.ac=new A());if(c.state==='suspended')c.resume();
  const t=c.currentTime,o=c.createGain();o.gain.value=.16;o.connect(c.destination);
  [[659.25,0],[987.77,.13],[1318.5,.26]].forEach(([f,d],i)=>{const g=c.createGain(),s=c.createOscillator(),h=c.createOscillator(),hg=c.createGain();
    s.type='sine';s.frequency.value=f;h.type='triangle';h.frequency.value=f*2;hg.gain.value=.12;
    g.gain.setValueAtTime(0,t+d);g.gain.linearRampToValueAtTime(i===2?.9:.7,t+d+.02);g.gain.exponentialRampToValueAtTime(.001,t+d+(i===2?.9:.45));
    s.connect(g);h.connect(hg);hg.connect(g);g.connect(o);s.start(t+d);h.start(t+d);s.stop(t+d+1);h.stop(t+d+1)})}catch(e){}}
function chatAvail(){const L=(CH.state?.contacts||[]).filter(c=>c.staff);const first=!CH.av;CH.av=CH.av||{};
  const fresh=L.filter(c=>c.available_at&&c.available_at!==CH.av[c.user_id]&&!first&&Date.now()-new Date(c.available_at)<180000);
  L.forEach(c=>{if(c.available_at)CH.av[c.user_id]=c.available_at});
  if(fresh.length){toast('🟢 '+fresh.map(c=>c.full_name).join(', ')+' — '+(fresh.length>1?'są dostępni':'jest dostępny'));chatChime()}}
{const st=chatStop;chatStop=function(){st();CH.av=null}}

/* lewy pasek → „Aktywni”: liczba innych osób zalogowanych teraz; nikt → czerwona kropka */
function chatOnlineNav(){const a=document.querySelector('#side a[href="#/aktywni"]');if(!a)return;a.querySelector('.onl')?.remove();if(!CH.state)return;
  const n=(CH.state.contacts||[]).filter(c=>c.online).length;
  a.insertAdjacentHTML('beforeend',n?`<span class="cnt n onl" data-tip="Zalogowanych teraz (bez Ciebie): ${n}">${n}</span>`:`<span class="onl offdot" data-tip="Nikt inny nie jest teraz zalogowany"></span>`)}
{const b2=chatBadge;chatBadge=function(){b2();chatOnlineNav()}}
