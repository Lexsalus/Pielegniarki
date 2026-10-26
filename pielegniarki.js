'use strict';
/* =====================================================================
   CRM — zakładka „Pielęgniarki” (projekt 23.10.2026, migracja 004)
   Lista · mapa · karta · panel przydziału, zlecenia, dostępność, ustawienia.
   Reguły (kto co widzi, zatwierdzanie, przydział, limity) egzekwuje baza.
   ===================================================================== */
const NZ={D:null,missing:false,sel:null,layer:'obszary',ctab:'obszar',f:{q:'',city:'',svc:'',st:''},scope:{city:'',district:''},rd:null,view:null,week:0,ed:null,ost:'',map:null,timer:null};
const NST={aktywna:'Aktywna',urlop:'Na urlopie',do_weryfikacji:'Do weryfikacji',nieaktywna:'Nieaktywna'};
const NSTB={aktywna:'b-good',urlop:'b-warn',do_weryfikacji:'b-info',nieaktywna:''};
const OST={nowe:'Nowe',zaproponowane:'Zaproponowane',przyjete:'Przyjęte',w_drodze:'W drodze',wykonane:'Wykonane',rozliczone:'Rozliczone'};
const OSTB={nowe:'b-warn',zaproponowane:'b-info',przyjete:'b-acc',w_drodze:'b-acc',wykonane:'b-good',rozliczone:''};
const RK={round_robin:['Po kolei','Każda z puli dostaje po jednym zleceniu.'],weighted:['Proporcjonalnie','Według wag z puli.'],queue:['Kolejka z limitem','Najpierw osoby z limitem (np. pierwsze 10), dalej na zmianę pozostałe.'],manual:['Ręcznie','Dyspozytor wybiera osobę przy każdym zleceniu.']};
const DOWS=['','Pon','Wt','Śr','Czw','Pt','Sob','Niedz'];
const EXK={urlop:'urlop',wolne:'wolne',dodatkowe:'dodatkowe godziny'};
const NCOL=['#7c5cff','#2fd6a0','#f59e0b','#ef4444','#3b82f6','#ec4899','#14b8a6','#8b5cf6','#84cc16','#f97316','#06b6d4','#e11d48','#a855f7','#22c55e','#eab308','#0ea5e9'];
const nurseColor=i=>i<NCOL.length?NCOL[i]:`hsl(${Math.round(i*137.508)%360} 70% 52%)`;
const hm=m=>`${Math.floor(m/60)}:${pad(m%60)}`;
const tmin=t=>{const [h,m]=String(t||'0:0').split(':').map(Number);return h*60+(m||0)};
const monday=(off=0)=>{const d=today();d.setDate(d.getDate()-((d.getDay()+6)%7)+off*7);return d};
const isoDow=d=>((d.getDay()+6)%7)+1;
const fDay=d=>`${DOW[d.getDay()].slice(0,3)}. ${pad(d.getDate())}.${pad(d.getMonth()+1)}`;
const fSlot=s=>{const d=new Date(s);return `${fDay(d)}, ${d.getHours()}:${pad(d.getMinutes())}`};
const nAdmin=()=>permLevel('nurses')===2;
const isNurse=()=>ME?.role==='nurse';
const NN=id=>NZ.D.nurses.find(n=>n.id===id)||{full_name:'—',color:'#64748b',id:''};
const SV=id=>NZ.D.services.find(s=>s.id===id)||{name:'—'};
const nIni=n=>initials(n.full_name||'?');
const nAv=(n,sz=32)=>`<span class="av" style="background:${esc(n.color)};width:${sz}px;height:${sz}px" title="${esc(n.full_name)}">${esc(nIni(n))}</span>`;
const nChip=(id,l)=>{const n=NN(id);return `<span class="nzc" style="background:${esc(n.color)}">${esc(l||nIni(n))}</span>`};
const money2=v=>v==null||v===''?'—':money(v);
const plural=(n,a,b,c)=>`${n} ${n===1?a:[2,3,4].includes(n%10)&&![12,13,14].includes(n%100)?b:c}`;

/* --- style zakładki --- */
document.head.insertAdjacentHTML('beforeend',`<style>
.nzmain{display:grid;grid-template-columns:300px minmax(0,1fr) 360px;gap:14px;align-items:start}
.nzlist{max-height:620px;overflow:auto;padding:10px}
.nzrow{display:flex;gap:10px;align-items:center;padding:9px 8px;border-radius:10px;cursor:pointer;border:1px solid transparent}
.nzrow:hover{background:var(--card2)}.nzrow.on{border-color:var(--accent);background:var(--card2)}
.nzrow .who{flex:1;min-width:0}.nzrow .who b{display:block;font-size:.88rem}.nzrow .who small{display:block;color:var(--mut);font-size:.76rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nzload{width:54px;flex:none;text-align:right;font-size:.72rem;color:var(--mut)}.nzload .bar{height:6px;margin-top:3px}
#nzmap,.nzmap{height:620px;border-radius:var(--r);border:1px solid var(--line);background:var(--card2);overflow:hidden;position:relative;isolation:isolate;z-index:0}
.nzmap.sm{height:460px}
.nzmap .nzoff{position:absolute;inset:0;display:grid;place-items:center;color:var(--mut);text-align:center;padding:20px}
.nzpin{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;color:#fff;font:700 10px 'Plus Jakarta Sans',sans-serif;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)}
.nzc{display:inline-grid;place-items:center;min-width:26px;height:22px;padding:0 6px;border-radius:6px;color:#fff;font-weight:700;font-size:.72rem;margin:2px}
.nzfacts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}
.nzfacts>div{background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:8px 10px;font-size:.8rem;color:var(--mut)}.nzfacts b{display:block;color:var(--txt);font-size:.95rem}
.nzlbl{font-size:.7rem;font-weight:800;letter-spacing:.06em;color:var(--mut);margin:12px 0 6px;text-transform:uppercase}
.nzweek{display:grid;grid-template-columns:44px repeat(7,minmax(0,1fr));gap:4px}
.nzweek .dh{font-size:.76rem;font-weight:700;text-align:center;color:var(--mut);padding:4px 0}
.nzweek .hc{position:relative}.nzweek .hc div{position:absolute;right:4px;font-size:.68rem;color:var(--mut);transform:translateY(-50%)}
.nzweek .col{position:relative;background:var(--bg2);border:1px solid var(--line);border-radius:8px;overflow:hidden}
.nzb{position:absolute;left:3px;right:3px;border-radius:6px;font-size:.68rem;padding:2px 5px;overflow:hidden;line-height:1.25}
.nzb.win{display:flex;align-items:flex-end;background:color-mix(in srgb,var(--good) 22%,transparent);border:1px solid color-mix(in srgb,var(--good) 55%,transparent)}
.nzb.pend{background:transparent;border:1px dashed var(--warn);color:var(--warn)}
.nzb.vis{color:#fff;font-weight:700}
.nzb.buf{background:repeating-linear-gradient(45deg,color-mix(in srgb,var(--mut) 30%,transparent) 0 4px,transparent 4px 8px);left:6px;right:6px}
.nzb.exc{background:color-mix(in srgb,var(--bad) 20%,transparent);border:1px solid color-mix(in srgb,var(--bad) 55%,transparent);color:var(--bad);font-weight:700}
.nzslots{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 10px}
.nzslot{padding:6px 10px;border-radius:8px;border:1px solid var(--line);background:var(--card);cursor:pointer;font-weight:600;font-size:.82rem}
.nzslot.on{background:var(--accent);border-color:var(--accent);color:#fff}
.nzflow{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:.8rem}
.nzflow span{background:var(--card2);border:1px solid var(--line);border-radius:8px;padding:5px 9px}
.nzpool td{padding:6px}.nzpool td:nth-child(2){white-space:nowrap}
.nzcardw .tabs .tab{padding:8px 7px;font-size:.82rem}
@media(max-width:1260px){.nzmain{grid-template-columns:280px minmax(0,1fr)}.nzmain>.nzcardw{grid-column:1/-1}}
@media(max-width:860px){.nzmain{grid-template-columns:1fr}#nzmap{height:420px}.nzweek{grid-template-columns:34px repeat(7,minmax(0,1fr))}}
</style>`);

/* =====================================================================
   DANE
   ===================================================================== */
NZ.load=async()=>{
  NZ.D=null;NZ.missing=false;
  if(!ME||!can('nurses'))return;
  const s=await sb.from('nurse_settings').select('*').limit(1);
  if(s.error){NZ.missing=true;return}
  const T=nAdmin()?['nurse_services','nurses','nurse_service_links','nurse_documents','districts','nurse_areas','nurse_patterns','nurse_exceptions','price_zones','assignment_rules','assignment_pool','nurse_orders','order_attempts','nurse_waitlist']
    :['nurse_services','nurses','nurse_service_links','districts','nurse_areas','nurse_patterns','nurse_exceptions'];
  const rows=await Promise.all(T.map(t=>fetchAll(t)));const R=Object.fromEntries(T.map((t,i)=>[t,rows[i]]));
  const D={cfg:s.data?.[0]||{},services:R.nurse_services||[],nurses:(R.nurses||[]).sort((a,b)=>a.full_name.localeCompare(b.full_name,'pl')),links:R.nurse_service_links||[],docs:R.nurse_documents||[],
    districts:R.districts||[],areas:R.nurse_areas||[],patterns:R.nurse_patterns||[],exceptions:R.nurse_exceptions||[],zones:R.price_zones||[],rules:R.assignment_rules||[],pool:R.assignment_pool||[],
    orders:(R.nurse_orders||[]).sort((a,b)=>String(a.start_at).localeCompare(b.start_at)),attempts:R.order_attempts||[],waitlist:R.nurse_waitlist||[],myOrders:[],myRates:[]};
  D.districts.forEach(d=>{d.c=centroid(d.rings)});
  if(isNurse()){D.me=D.nurses[0]||null;
    const [o,r]=await Promise.all([sb.rpc('my_orders'),sb.rpc('my_rates')]);D.myOrders=o.data||[];D.myRates=r.data||[];}
  NZ.D=D;
};
{const base=reload;reload=async()=>{await base();try{await NZ.load()}catch(e){console.error(e)}}}
const nact=(fn,msg)=>act(fn,msg);
const nsafe=(fn,msg)=>act(fn,msg).catch(()=>{});

/* --- geometria (lustro funkcji bazy: app.area_has) --- */
function centroid(rings){const r=(rings||[])[0]||[];if(!r.length)return null;let a=0,o=0;r.forEach(p=>{a+=+p[0];o+=+p[1]});return [a/r.length,o/r.length]}
function pip(lat,lng,ring){let ins=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const yi=+ring[i][0],xi=+ring[i][1],yj=+ring[j][0],xj=+ring[j][1];if(((yi>lat)!==(yj>lat))&&(lng<(xj-xi)*(lat-yi)/(yj-yi)+xi))ins=!ins}return ins}
const ringsHas=(rings,lat,lng)=>(rings||[]).filter(r=>pip(lat,lng,r)).length%2===1;
const kmBetween=(a1,o1,a2,o2)=>{const r=x=>x*Math.PI/180,h=Math.sin(r(a2-a1)/2)**2+Math.cos(r(a1))*Math.cos(r(a2))*Math.sin(r(o2-o1)/2)**2;return 2*6371*Math.asin(Math.sqrt(h))};
const distOf=city=>NZ.D.districts.filter(d=>d.city.toLowerCase()===String(city||'').toLowerCase());
function shapeGeoms(s){
  if(s.type==='radius')return [{k:'circle',lat:+s.lat,lng:+s.lng,km:+s.km}];
  if(s.type==='polygon')return [{k:'poly',rings:[s.points]}];
  if(s.type==='city')return distOf(s.city).map(d=>({k:'poly',rings:d.rings}));
  if(s.type==='districts')return distOf(s.city).filter(d=>(s.names||[]).includes(d.name)).map(d=>({k:'poly',rings:d.rings}));
  return [];
}
function areaHas(shapes,lat,lng){return (shapes||[]).some(s=>s.type==='radius'?kmBetween(lat,lng,+s.lat,+s.lng)<=+s.km:s.type==='polygon'?pip(lat,lng,s.points):shapeGeoms(s).some(g=>ringsHas(g.rings,lat,lng)))}
function shapeTxt(s){
  if(s.type==='radius')return `${s.label||'punkt'} + ${s.km} km`;
  if(s.type==='polygon')return `własny wielokąt (${(s.points||[]).length} pkt)`;
  if(s.type==='city')return `${s.city} (całe miasto)`;
  if(s.type==='districts')return `${s.city}: ${(s.names||[]).join(', ')}`;
  return '?';
}
const approvedArea=id=>NZ.D.areas.find(a=>a.nurse_id===id&&a.status==='approved');
const openArea=id=>NZ.D.areas.find(a=>a.nurse_id===id&&['draft','pending'].includes(a.status));
const areaTxt=id=>{const a=approvedArea(id);return a&&a.shapes.length?a.shapes.map(shapeTxt).join(' + '):'brak zatwierdzonego obszaru'};
const covers=(id,lat,lng)=>{const a=approvedArea(id);return !!a&&areaHas(a.shapes,lat,lng)};

/* --- dostępność po stronie przeglądarki (do widoku; wolne terminy liczy baza) --- */
function dayPlan(id,d,{pending=true}={}){
  const ds=iso(d),dw=isoDow(d),out={win:[],pend:[],exc:[],vis:[]};
  NZ.D.patterns.filter(p=>p.nurse_id===id&&+p.dow===dw&&ds>=p.valid_from&&(!p.valid_to||ds<=p.valid_to)).forEach(p=>{
    const b={from:tmin(p.time_from),to:tmin(p.time_to),p};(p.status==='approved'?out.win:pending?out.pend:[]).push(b)});
  NZ.D.exceptions.filter(e=>e.nurse_id===id&&ds>=e.date_from&&ds<=e.date_to).forEach(e=>{
    const b={from:e.time_from?tmin(e.time_from):0,to:e.time_to?tmin(e.time_to):1440,e};
    if(e.status!=='approved'){if(pending)out.pend.push(b)}else if(e.kind==='dodatkowe')out.win.push(b);else out.exc.push(b)});
  const ords=isNurse()?NZ.D.myOrders:NZ.D.orders.filter(o=>o.nurse_id===id);
  ords.filter(o=>o.status!=='nowe'&&iso(new Date(o.start_at))===ds).forEach(o=>{const s=new Date(o.start_at),e=new Date(o.end_at);out.vis.push({from:s.getHours()*60+s.getMinutes(),to:e.getHours()*60+e.getMinutes(),o})});
  return out;
}
function weekLoad(id){
  const m=monday(),cap=[],used=NZ.D.orders.filter(o=>o.nurse_id===id&&o.status!=='nowe'&&new Date(o.start_at)>=m&&new Date(o.start_at)<addDays(m,7)).length;
  const lim=NZ.D.cfg.max_visits_per_day||8;let c=0;for(let i=0;i<7;i++){const p=dayPlan(id,addDays(m,i),{pending:false});if(p.win.length&&!p.exc.some(x=>x.from===0&&x.to===1440))c+=lim}
  return {used,cap:c};
}
const loadBar=(id)=>{const {used,cap}=weekLoad(id),pc=cap?Math.min(100,Math.round(used/cap*100)):0;return `<div class="nzload">${used}/${cap}<div class="bar"><i style="width:${pc}%;background:${pc>85?'var(--bad)':pc>60?'var(--warn)':'var(--good)'}"></i></div></div>`};
const visits=id=>NZ.D.orders.filter(o=>o.nurse_id===id&&['wykonane','rozliczone'].includes(o.status)).length;
const pendingFor=id=>NZ.D.areas.filter(a=>a.nurse_id===id&&a.status==='pending').length+NZ.D.patterns.filter(p=>p.nurse_id===id&&(p.status==='pending'||p.end_requested)).length+NZ.D.exceptions.filter(e=>e.nurse_id===id&&e.status==='pending').length;

/* --- strefy: szablon miasta + nadpisania (lustro app.zone) --- */
function zonesFor(id){
  const n=NN(id),t=NZ.D.zones.filter(z=>z.city&&z.city.toLowerCase()===String(n.city).toLowerCase()),o=NZ.D.zones.filter(z=>z.nurse_id===id);
  const nos=[...new Set([...t,...o].map(z=>+z.zone_no))].sort((a,b)=>a-b);
  return nos.map(no=>{const a=t.find(z=>+z.zone_no===no)||{},b=o.find(z=>+z.zone_no===no)||{};
    return {zone_no:no,km_from:b.km_from??a.km_from,km_to:b.km_to??a.km_to,price_client:b.price_client??a.price_client,payout:b.payout??a.payout,tpl:a,ovr:b.id?b:null}}).filter(z=>z.km_to!=null);
}

/* =====================================================================
   MAPA: Leaflet + OpenStreetMap albo Google Maps (ustawienie)
   ===================================================================== */
const loadScript=src=>new Promise((ok,no)=>{if([...document.scripts].some(s=>s.src===src))return ok();const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>no(new Error('Nie udało się wczytać '+src));document.head.appendChild(s)});
const loadCss=href=>{if(![...document.styleSheets].some(s=>s.href===href)){const l=document.createElement('link');l.rel='stylesheet';l.href=href;document.head.appendChild(l)}};
async function mapLib(){
  const c=NZ.D.cfg;
  if(c.map_provider==='google'&&c.google_key){if(!window.google?.maps?.Map)await loadScript(`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(c.google_key)}&v=weekly&language=pl&region=PL`);return 'google'}
  if(!window.L){loadCss('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js')}
  return 'leaflet';
}
async function makeMap(el,{view,onClick,onMove}={}){
  if(!el)return null;
  let kind;try{kind=await mapLib()}catch(e){el.innerHTML=`<div class="nzoff">Mapa niedostępna: ${esc(e.message)}.<br>Pozostałe funkcje działają normalnie.</div>`;return null}
  if(!el.isConnected)return null;
  const v=view||{c:[52.2297,21.0122],z:11};
  if(kind==='leaflet'){
    const m=L.map(el).setView(v.c,v.z);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(m);
    const g=L.layerGroup().addTo(m);if(onClick)m.on('click',e=>onClick(e.latlng.lat,e.latlng.lng));if(onMove)m.on('moveend',()=>onMove({c:[m.getCenter().lat,m.getCenter().lng],z:m.getZoom()}));
    const ev=(l,o)=>{if(o.title)l.bindTooltip(o.title,{sticky:true});if(o.onClick)l.on('click',e=>{L.DomEvent.stopPropagation(e);o.onClick(e.latlng.lat,e.latlng.lng)});return l};
    return {kind,clear:()=>g.clearLayers(),
      poly:(rings,o={})=>ev(L.polygon(rings,{color:o.color||'#7c5cff',weight:o.weight||2,fillOpacity:o.fill??.25,opacity:o.opacity??.9,dashArray:o.dash?'6 6':null,interactive:o.interactive!==false}).addTo(g),o),
      line:(pts,o={})=>L.polyline(pts,{color:o.color||'#7c5cff',weight:2,dashArray:'4 4'}).addTo(g),
      circle:(lat,lng,km,o={})=>ev(L.circle([lat,lng],{radius:km*1000,color:o.color||'#7c5cff',weight:o.weight||2,fillOpacity:o.fill??.12,dashArray:o.dash?'6 6':null,interactive:o.interactive!==false}).addTo(g),o),
      marker:(lat,lng,o={})=>ev(L.marker([lat,lng],{icon:L.divIcon({className:'',html:`<span class="nzpin" style="background:${esc(o.color||'#7c5cff')}">${esc(o.label||'')}</span>`,iconSize:[26,26],iconAnchor:[13,13]})}).addTo(g),o),
      fit:pts=>{if(pts.length)m.fitBounds(pts,{padding:[24,24],maxZoom:13})},
      view:()=>({c:[m.getCenter().lat,m.getCenter().lng],z:m.getZoom()}),destroy:()=>m.remove()};
  }
  const G=google.maps,m=new G.Map(el,{center:{lat:v.c[0],lng:v.c[1]},zoom:v.z,mapTypeControl:false,streetViewControl:false});let ov=[];
  const P=([a,b])=>({lat:+a,lng:+b});if(onClick)m.addListener('click',e=>onClick(e.latLng.lat(),e.latLng.lng()));if(onMove)m.addListener('idle',()=>onMove({c:[m.getCenter().lat(),m.getCenter().lng()],z:m.getZoom()}));
  const ev=(x,o)=>{if(o.onClick)x.addListener('click',e=>o.onClick(e.latLng.lat(),e.latLng.lng()));if(o.title)x.setOptions({title:o.title});ov.push(x);return x};
  return {kind,clear:()=>{ov.forEach(x=>x.setMap(null));ov=[]},
    poly:(rings,o={})=>ev(new G.Polygon({map:m,paths:rings.map(r=>r.map(P)),strokeColor:o.color||'#7c5cff',strokeWeight:o.weight||2,strokeOpacity:o.dash?.5:.9,fillColor:o.color||'#7c5cff',fillOpacity:o.fill??.25,clickable:o.interactive!==false}),o),
    line:(pts,o={})=>{const x=new G.Polyline({map:m,path:pts.map(P),strokeColor:o.color||'#7c5cff',strokeWeight:2});ov.push(x);return x},
    circle:(lat,lng,km,o={})=>ev(new G.Circle({map:m,center:{lat,lng},radius:km*1000,strokeColor:o.color||'#7c5cff',strokeWeight:o.weight||2,fillColor:o.color||'#7c5cff',fillOpacity:o.fill??.12,clickable:o.interactive!==false}),o),
    marker:(lat,lng,o={})=>ev(new G.Marker({map:m,position:{lat,lng},label:{text:o.label||'',color:'#fff',fontSize:'10px',fontWeight:'700'},icon:{path:G.SymbolPath.CIRCLE,scale:13,fillColor:o.color||'#7c5cff',fillOpacity:1,strokeColor:'#fff',strokeWeight:2}}),o),
    fit:pts=>{if(!pts.length)return;const b=new G.LatLngBounds();pts.forEach(p=>b.extend(P(p)));m.fitBounds(b,24);if(pts.length===1)m.setZoom(13)},
    view:()=>({c:[m.getCenter().lat(),m.getCenter().lng()],z:m.getZoom()}),destroy:()=>{}};
}
const drawShape=(M,s,o)=>shapeGeoms(s).forEach(g=>g.k==='circle'?M.circle(g.lat,g.lng,g.km,o):M.poly(g.rings,o));

/* --- adresy i odległości (OpenStreetMap: Nominatim / OSRM; Google: Geocoder / Distance Matrix) --- */
async function geocode(q){
  if((await mapLib())==='google'){const r=await new google.maps.Geocoder().geocode({address:q,region:'pl'});
    return r.results.map(x=>{const c=x.address_components,f=t=>c.find(a=>a.types.includes(t))?.long_name||'';return {label:x.formatted_address,lat:x.geometry.location.lat(),lng:x.geometry.location.lng(),city:f('locality')||f('administrative_area_level_3')}})}
  const r=await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=pl&accept-language=pl&q='+encodeURIComponent(q)).then(x=>x.json());
  return r.map(x=>({label:x.display_name,lat:+x.lat,lng:+x.lon,city:x.address?.city||x.address?.town||x.address?.village||''}));
}
async function roadKm(lat,lng,ids){
  const ns=ids.map(NN).filter(n=>n.base_lat!=null);if(!ns.length)return {};
  if((await mapLib())==='google'){const r=await new google.maps.DistanceMatrixService().getDistanceMatrix({origins:ns.map(n=>({lat:n.base_lat,lng:n.base_lng})),destinations:[{lat,lng}],travelMode:'DRIVING'});
    return Object.fromEntries(ns.map((n,i)=>[n.id,Math.round((r.rows[i].elements[0].distance?.value||0)/100)/10]))}
  const pts=[[lng,lat],...ns.map(n=>[n.base_lng,n.base_lat])].map(p=>p.join(',')).join(';');
  const r=await fetch(`https://router.project-osrm.org/table/v1/driving/${pts}?sources=0&annotations=distance`).then(x=>x.json());
  return Object.fromEntries(ns.map((n,i)=>[n.id,Math.round((r.distances[0][i+1]||0)/100)/10]));
}

/* =====================================================================
   ROUTER ZAKŁADKI
   ===================================================================== */
const NZ_TABS=[['','Widok główny'],['zlecenia','Zlecenia'],['dostepnosc','Dostępność w mieście'],['oczekujacy','Lista oczekujących'],['ustawienia','Ustawienia']];
const NZ_NTABS=[['','Moje zlecenia'],['obszar','Mój obszar'],['terminarz','Dostępność'],['stawki','Stawki']];
ROUTES.pielegniarki=(sub='',id)=>{
  need(can('nurses'),'Zakładka Pielęgniarki wymaga uprawnienia „Pielęgniarki”.');
  if(NZ.missing)return `<div class="ph"><div><h1>Pielęgniarki</h1></div></div><div class="note">Baza nie ma jeszcze tabel tej zakładki. Uruchom migrację <code>supabase/migrations/004_pielegniarki.sql</code> w Supabase SQL Editor (opis w SUPABASE.md).</div>`;
  if(!NZ.D)return `<div class="empty">Wczytywanie…</div>`;
  if(isNurse())return nurseView(sub);
  const pend=NZ.D.orders.filter(o=>o.status==='nowe'&&o.needs_dispatcher).length;
  const tabs=`<div class="tabs">${NZ_TABS.map(([k,l])=>`<a class="tab ${k===sub||(k===''&&['obszar','terminarz','dzielnica'].includes(sub))?'on':''}" href="#/pielegniarki${k?'/'+k:''}">${l}${k==='zlecenia'&&pend?` <span class="badge b-bad">${pend}</span>`:''}${k==='oczekujacy'&&NZ.D.waitlist.filter(w=>!w.resolved_at).length?` <span class="badge">${NZ.D.waitlist.filter(w=>!w.resolved_at).length}</span>`:''}</a>`).join('')}</div>`;
  const V={'':mainView,zlecenia:ordersView,dostepnosc:cityAvailView,oczekujacy:waitView,ustawienia:settingsView,obszar:()=>areaEditor(id),terminarz:()=>calendarView(id),dzielnica:districtEditor}[sub];
  need(V,'Nie ma takiej strony');
  return tabs+V(id);
};
ROUTES.pielegniarki.after=(sub='',id)=>{
  if(!NZ.D||NZ.missing)return;
  clearInterval(NZ.timer);NZ.timer=setInterval(tickCountdowns,1000);tickCountdowns();
  if(isNurse()){if(sub==='obszar')mountEditor();return}
  if(sub==='')mountMain();else if(sub==='obszar')mountEditor();else if(sub==='dzielnica')mountDistrictEditor();
  if(!NZ.ticked){NZ.ticked=1;sb.rpc('nurse_tick').then(r=>{if(r.data>0)reload().then(rerender)})}
};
function tickCountdowns(){
  if(!location.hash.startsWith('#/pielegniarki')){clearInterval(NZ.timer);return}
  let expired=false;
  $$('[data-exp]').forEach(el=>{const s=Math.round((new Date(el.dataset.exp)-Date.now())/1000);if(s<=0){el.textContent='czas minął';if(!el.dataset.done){el.dataset.done=1;expired=true}}else el.textContent=`${Math.floor(s/60)}:${pad(s%60)}`});
  if(expired)sb.rpc('nurse_tick').then(()=>reload()).then(rerender);
}

/* =====================================================================
   WIDOK GŁÓWNY: lista · mapa · karta · panel przydziału
   ===================================================================== */
function mainView(){
  const ns=NZ.D.nurses,c=k=>ns.filter(n=>n.status===k).length;
  return `<div class="ph"><div><h1>Pielęgniarki <span class="mut" style="font-size:.95rem;font-weight:600">${ns.length} łącznie · ${c('aktywna')} aktywne · ${c('urlop')} na urlopie · ${c('do_weryfikacji')} do weryfikacji</span></h1></div>
    <div style="display:flex;gap:8px"><button class="btn" onclick="orderModal()">+ Nowe zlecenie</button><button class="btn pri" onclick="nurseModal()">+ Dodaj pielęgniarkę</button></div></div>
  <div class="nzmain"><div class="card" style="padding:0"><div style="padding:12px 12px 0"><input class="f" id="nzq" placeholder="Szukaj pielęgniarki…" value="${esc(NZ.f.q)}">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:6px">${nzSel('city','Miasto',[...new Set(ns.map(n=>n.city).filter(Boolean))].map(x=>[x,x]))}${nzSel('svc','Usługa',NZ.D.services.map(s=>[s.id,s.name]))}${nzSel('st','Status',Object.entries(NST))}</div></div>
      <div class="nzlist" id="nzlist"></div></div>
    <div><div class="chips" style="margin-bottom:8px" id="nzlayers"></div><div id="nzmap"></div><p class="hint">Kolor pielęgniarki jest ten sam na liście, mapie, w kalendarzu i panelu przydziału. Linia przerywana = zmiana czekająca na decyzję. Piny = punkty bazowe.</p></div>
    <div class="nzcardw"><div class="card" id="nzcard"></div></div></div>
  <div class="card" id="nzrule" style="margin-top:14px"></div>`;
}
const nzSel=(k,l,opts)=>`<select class="f" data-nzf="${k}" style="font-size:.8rem;padding:6px"><option value="">${l}</option>${opts.map(([v,t])=>`<option value="${esc(v)}" ${NZ.f[k]===v?'selected':''}>${esc(t)}</option>`).join('')}</select>`;
const filtered=()=>NZ.D.nurses.filter(n=>(!NZ.f.q||n.full_name.toLowerCase().includes(NZ.f.q.toLowerCase()))&&(!NZ.f.city||n.city===NZ.f.city)&&(!NZ.f.st||n.status===NZ.f.st)&&(!NZ.f.svc||NZ.D.links.some(l=>l.nurse_id===n.id&&l.service_id===NZ.f.svc)));
async function mountMain(){
  $('#nzq').oninput=e=>{NZ.f.q=e.target.value;paintList();drawMain()};
  $$('[data-nzf]').forEach(s=>s.onchange=()=>{NZ.f[s.dataset.nzf]=s.value;paintList();drawMain()});
  if(!NZ.sel||!NN(NZ.sel).id)NZ.sel=NZ.D.nurses[0]?.id||null;
  paintList();paintCard();paintRule();paintLayers();
  NZ.map?.destroy?.();NZ.map=await makeMap($('#nzmap'),{view:NZ.view,onMove:v=>NZ.view=v});drawMain(!NZ.view);
}
function paintList(){
  const L=filtered();
  $('#nzlist').innerHTML=L.length?L.map(n=>`<div class="nzrow ${n.id===NZ.sel?'on':''}" onclick="NZ.pick('${n.id}')">${nAv(n)}<div class="who"><b>${esc(n.full_name)}</b><small>${n.status==='aktywna'?esc(n.city?n.city+': ':'')+esc(areaTxt(n.id).replace(/^[^:]*: /,'')):`<span class="badge ${NSTB[n.status]}">${NST[n.status]}</span>`}${pendingFor(n.id)?' · <span style="color:var(--warn)">zmiana do zatwierdzenia</span>':''}</small></div>${loadBar(n.id)}</div>`).join('')+
    `<p class="hint" style="padding:0 8px">Pokazano ${L.length} z ${NZ.D.nurses.length} · pasek = obciążenie w tygodniu</p>`:'<div class="empty">Brak pielęgniarek — dodaj pierwszą.</div>';
}
NZ.pick=id=>{NZ.sel=id;paintList();paintCard();drawMain();const n=NN(id);if(n.city&&NZ.scope.city!==n.city){NZ.scope={city:n.city,district:''};NZ.rd=null;paintRule()}};
function paintLayers(){$('#nzlayers').innerHTML=[['obszary','Obszary'],['strefy','Strefy cenowe'],['oblozenie','Obłożenie'],['plamy','Białe plamy']].map(([k,l])=>`<button class="chip ${NZ.layer===k?'on':''}" onclick="NZ.layer='${k}';paintLayers();drawMain()">${l}</button>`).join('')}
function drawMain(fit){
  const M=NZ.map;if(!M)return;M.clear();const pts=[],L=filtered();
  if(NZ.layer==='plamy'){
    NZ.D.districts.forEach(d=>{const hit=d.c&&NZ.D.nurses.some(n=>n.status==='aktywna'&&covers(n.id,d.c[0],d.c[1]));M.poly(d.rings,{color:hit?'#64748b':'#ef4444',fill:hit?.05:.35,weight:1,title:`${d.city}: ${d.name}${hit?'':' — brak pokrycia'}`})});
    NZ.D.waitlist.filter(w=>!w.resolved_at&&w.lat!=null).forEach(w=>{M.marker(w.lat,w.lng,{color:'#ef4444',label:'!',title:`Lista oczekujących: ${w.address}`});pts.push([w.lat,w.lng])});
  }
  L.forEach(n=>{
    const on=!NZ.sel||n.id===NZ.sel,a=approvedArea(n.id),op=openArea(n.id);
    let col=n.color;
    if(NZ.layer==='oblozenie'){const {used,cap}=weekLoad(n.id),r=cap?used/cap:0;col=r>.85?'#ef4444':r>.6?'#f59e0b':'#2fd6a0'}
    if(NZ.layer!=='strefy'&&NZ.layer!=='plamy'){
      a&&a.shapes.forEach(s=>drawShape(M,s,{color:col,fill:on?.28:.08,weight:n.id===NZ.sel?3:1.5,opacity:on?.9:.35,title:`${n.full_name}: ${shapeTxt(s)}`,onClick:()=>NZ.pick(n.id)}));
      if(op&&n.id===NZ.sel)op.shapes.forEach(s=>drawShape(M,s,{color:col,fill:0,dash:true,weight:2,interactive:false}));
    }
    if(NZ.layer==='strefy'&&n.base_lat!=null&&on)zonesFor(n.id).slice().reverse().forEach(z=>M.circle(n.base_lat,n.base_lng,+z.km_to,{color:col,fill:.06,weight:1,dash:true,title:`${n.full_name} · strefa ${z.zone_no} (${z.km_from}–${z.km_to} km): klient ${money2(z.price_client)}, pielęgniarka ${money2(z.payout)}`}));
    if(n.base_lat!=null){M.marker(n.base_lat,n.base_lng,{color:n.color,label:nIni(n),title:`${n.full_name} · punkt bazowy ${n.base_label||''}`,onClick:()=>NZ.pick(n.id)});if(on)pts.push([n.base_lat,n.base_lng])}
  });
  if(fit){if(!pts.length)NZ.D.districts.forEach(d=>d.c&&pts.push(d.c));M.fit(pts)}
}

/* --- karta pielęgniarki --- */
function paintCard(){
  const el=$('#nzcard');if(!el)return;const n=NN(NZ.sel);
  if(!n.id){el.innerHTML='<div class="empty">Wybierz pielęgniarkę z listy</div>';return}
  const {used,cap}=weekLoad(n.id),rule=NZ.D.rules.find(r=>r.city.toLowerCase()===String(n.city).toLowerCase()&&!r.district),pool=rule?NZ.D.pool.filter(p=>p.rule_id===rule.id):[],me=pool.find(p=>p.nurse_id===n.id),tot=pool.reduce((s,p)=>s+ +p.weight,0);
  el.innerHTML=`<div style="display:flex;gap:12px;align-items:center">${nAv(n,44)}<div style="flex:1;min-width:0"><h3 style="margin:0">${esc(n.full_name)}</h3><div class="small mut">${esc(n.city||'—')}${n.rating!=null?` · ocena ${String(n.rating).replace('.',',')}`:''} · ${plural(visits(n.id),'wizyta','wizyty','wizyt')}</div></div><span class="badge ${NSTB[n.status]}">${NST[n.status]}</span></div>
    <div class="nzfacts"><div>Zlecenia w tym tygodniu<b>${used} / ${cap}</b></div><div>Udział w przydziale${n.city?` (${esc(n.city)})`:''}<b>${me&&tot&&rule.kind==='weighted'?Math.round(me.weight/tot*100)+' %':me?RK[rule.kind][0]:'—'}</b></div><div style="grid-column:1/-1">Najbliższy wolny termin<b id="nzNext">…</b></div></div>
    <div class="tabs" style="margin:6px 0 10px">${[['obszar','Obszar'],['dostepnosc','Dostępność'],['stawki','Stawki'],['zlecenia','Zlecenia'],['dokumenty','Dokumenty']].map(([k,l])=>`<button class="tab ${NZ.ctab===k?'on':''}" onclick="NZ.ctab='${k}';paintCard()">${l}</button>`).join('')}</div>
    ${CARD[NZ.ctab](n)}<div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap"><button class="btn sm" onclick="nurseModal('${n.id}')">Dane i usługi</button></div>`;
  nextFree(n.id).then(t=>{const x=$('#nzNext');if(x)x.textContent=t});
}
async function nextFree(id){
  const r=await sb.rpc('nurse_free_windows',{p_nurse:id,p_from:iso(today()),p_days:21});if(r.error)return '—';
  const min=Math.min(...NZ.D.services.filter(s=>s.active).map(s=>s.duration_min+s.buffer_min),15),now=Date.now();
  const w=(r.data||[]).map(x=>({s:Math.max(new Date(x.s).getTime(),now),e:new Date(x.e).getTime()})).find(x=>x.e-x.s>=min*60000);
  if(!w)return 'brak w najbliższych 3 tygodniach';const st=NZ.D.cfg.slot_step_min||30,d=new Date(w.s);d.setSeconds(0,0);const m=d.getMinutes();if(m%st)d.setMinutes(m+st-m%st);return fSlot(d);
}
const CARD={};
CARD.obszar=n=>{
  const a=approvedArea(n.id),op=openArea(n.id);
  return `<div class="nzlbl">Okręg działania</div>${a?a.shapes.map(s=>`<span class="chip" style="margin:0 4px 4px 0">${esc(shapeTxt(s))}</span>`).join(''):'<span class="mut">brak zatwierdzonego obszaru</span>'}
    <div class="nzlbl">Punkt bazowy</div>${n.base_lat!=null?esc(n.base_label||`${(+n.base_lat).toFixed(4)}, ${(+n.base_lng).toFixed(4)}`):'<span class="mut">nie ustawiony</span>'}
    <div style="margin-top:10px">${a?'<span class="badge b-good">Obszar zatwierdzony</span>':''} ${op?`<span class="badge ${op.status==='pending'?'b-warn':''}">${op.status==='pending'?'zmiana czeka na decyzję':'szkic'}</span>`:''}</div>
    ${op?`<div class="note" style="margin-top:8px"><b>${op.status==='pending'?'Do zatwierdzenia':'Szkic'}:</b> ${esc(op.shapes.map(shapeTxt).join(' + ')||'pusty')}${op.note?`<br><span class="mut">Uwaga: ${esc(op.note)}</span>`:''}</div>`:''}
    <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap"><a class="btn sm" href="#/pielegniarki/obszar/${n.id}">Edytuj obszar</a>${op?.status==='pending'?`<button class="btn sm pri" onclick="areaDecide('${op.id}',true)">Zatwierdź zmiany</button><button class="btn sm" onclick="areaDecide('${op.id}',false)">Odeślij do poprawy</button>`:''}</div>`;
};
CARD.dostepnosc=n=>patternsBlock(n.id,true)+`<div style="margin-top:10px"><a class="btn sm" href="#/pielegniarki/terminarz/${n.id}">Otwórz terminarz tygodnia</a></div>`;
CARD.stawki=n=>{
  const zs=zonesFor(n.id),ov=NZ.D.zones.some(z=>z.nurse_id===n.id);
  return `<div class="small mut">Strefy liczone od punktu bazowego (${esc(n.base_label||n.city||'—')}). Szablon miasta: ${esc(n.city||'—')}.</div>
    ${zs.length?`<div class="tw"><table style="margin-top:8px"><tr><th>Strefa</th><th>Klient</th><th>Pielęg.</th><th>Marża</th></tr>${zs.map(z=>`<tr><td>${z.zone_no} (${z.km_from}–${z.km_to} km)</td><td>${money2(z.price_client)}${z.ovr?.price_client!=null?' <span class="badge b-warn">ind.</span>':''}</td><td>${money2(z.payout)}${z.ovr?.payout!=null?' <span class="badge b-warn">ind.</span>':''}</td><td><b>${money2(z.price_client-z.payout)}</b></td></tr>`).join('')}</table></div>`:'<div class="note" style="margin-top:8px">Brak cennika stref dla tego miasta — ustaw szablon w Ustawieniach.</div>'}
    <div style="display:flex;gap:8px;align-items:center;margin-top:10px"><span class="badge ${ov?'b-warn':''}">${ov?'Indywidualna stawka włączona':'Stawki z szablonu miasta'}</span><button class="btn sm" onclick="overrideModal('${n.id}')">${ov?'Zmień nadpisanie':'Nadpisz dla tej pielęgniarki'}</button></div>
    <p class="hint">Zlecenie zapisuje kwoty w chwili przydziału — późniejsza zmiana cennika nie rusza historii.</p>`;
};
CARD.zlecenia=n=>{const os=NZ.D.orders.filter(o=>o.nurse_id===n.id).slice(-12).reverse();
  return os.length?os.map(o=>`<div class="dl"><div class="when">${fDT(o.start_at).slice(0,16)}</div><div class="what"><b>#${o.number} · ${esc(SV(o.service_id).name)}</b><small>${esc(o.address)}</small></div><span class="badge ${OSTB[o.status]}">${OST[o.status]}</span></div>`).join(''):'<div class="empty">Brak zleceń</div>'};
CARD.dokumenty=n=>{const ds=NZ.D.docs.filter(d=>d.nurse_id===n.id),has=k=>ds.find(d=>d.kind===k);
  return `<div class="chips">${['PWZ','OC','umowa'].map(k=>{const d=has(k),exp=d?.valid_until&&d.valid_until<iso(today());return `<span class="badge ${d?exp?'b-bad':'b-good':''}">${k}${d?exp?' — wygasło':' ✓':' — brak'}</span>`}).join(' ')}</div>
    ${ds.map(d=>`<div class="dl"><div class="what"><b>${esc(d.kind)}${d.number?' · '+esc(d.number):''}</b><small>${d.valid_until?'ważne do '+fD(d.valid_until):'bez daty ważności'}${d.file_name?' · '+esc(d.file_name):''}</small></div>${d.storage_path?`<button class="btn sm" onclick="nurseDocGet('${d.id}')">Pobierz</button>`:''}<button class="btn sm del" onclick="nurseDocDel('${d.id}')">✕</button></div>`).join('')}
    <button class="btn sm" style="margin-top:10px" onclick="nurseDocModal('${n.id}')">+ Dokument</button>`};

/* --- wzorce i wyjątki (karta + terminarz + panel pielęgniarki) --- */
function patternsBlock(id,compact){
  const ps=NZ.D.patterns.filter(p=>p.nurse_id===id&&(!p.valid_to||p.valid_to>=iso(today()))).sort((a,b)=>a.dow-b.dow||a.time_from.localeCompare(b.time_from));
  const ex=NZ.D.exceptions.filter(e=>e.nurse_id===id&&e.date_to>=iso(today())).sort((a,b)=>a.date_from.localeCompare(b.date_from));
  const adm=nAdmin();
  return `<div class="nzlbl">Wzorzec tygodnia</div>${ps.length?ps.map(p=>`<div class="dl" style="padding:7px 0"><div class="what"><b>${DOWS[p.dow]} ${p.time_from.slice(0,5)}–${p.time_to.slice(0,5)}</b><small>od ${fD(p.valid_from)}${p.valid_to?' do '+fD(p.valid_to):''}${p.end_requested?` · prośba o zakończenie od ${fD(p.end_requested)}`:''}</small></div>
      ${p.status==='pending'?'<span class="badge b-warn">do zatwierdzenia</span>':''}
      ${adm&&p.status==='pending'?`<button class="btn sm pri" onclick="patDecide('${p.id}',true)">Zatwierdź</button><button class="btn sm" onclick="patDecide('${p.id}',false)">Odrzuć</button>`:''}
      ${adm&&p.end_requested?`<button class="btn sm pri" onclick="patEnd('${p.id}',true)">Zatwierdź koniec</button><button class="btn sm" onclick="patEnd('${p.id}',false)">Odrzuć</button>`:''}
      ${adm&&p.status==='approved'&&!p.end_requested?`<button class="btn sm del" onclick="patStop('${p.id}')">Zakończ</button>`:''}
      ${!adm&&p.status==='pending'?`<button class="btn sm del" onclick="patDel('${p.id}')">Usuń</button>`:''}
      ${!adm&&p.status==='approved'&&!p.end_requested?`<button class="btn sm" onclick="patAskEnd('${p.id}')">Poproś o zakończenie</button>`:''}</div>`).join(''):'<div class="mut small">brak</div>'}
    <div class="nzlbl">Wyjątki</div>${ex.length?ex.map(e=>`<div class="dl" style="padding:7px 0"><div class="what"><b>${EXK[e.kind]}: ${fD(e.date_from)}${e.date_to!==e.date_from?' – '+fD(e.date_to):''}</b><small>${e.time_from?e.time_from.slice(0,5)+'–'+e.time_to.slice(0,5):'cały dzień'}${e.note?' · '+esc(e.note):''}</small></div>
      ${e.status==='pending'?'<span class="badge b-warn">do zatwierdzenia</span>':''}${adm&&e.status==='pending'?`<button class="btn sm pri" onclick="excDecide('${e.id}',true)">Zatwierdź</button>`:''}${adm||e.status==='pending'?`<button class="btn sm del" onclick="excDel('${e.id}')">✕</button>`:''}</div>`).join(''):'<div class="mut small">brak</div>'}
    <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap"><button class="btn sm" onclick="patternModal('${id}')">+ Dodaj wzorzec</button><button class="btn sm" onclick="exceptionModal('${id}')">+ Dodaj wyjątek</button></div>
    ${!adm?'<p class="hint">Zmiany wzorca obowiązują od następnego tygodnia i czekają na zatwierdzenie. Już przyjęte wizyty się nie zmieniają.</p>':''}`;
}
const nextMon=()=>iso(monday(1));
function patternModal(id){
  const adm=nAdmin();
  modal('Dodaj wzorzec tygodnia',`<div class="fl">Dni<div class="chips">${DOWS.slice(1).map((d,i)=>`<label class="chk" style="margin-right:6px"><input type="checkbox" name="d${i+1}">${d}</label>`).join('')}</div></div>
    <div class="form" style="margin-top:12px"><label>Od godziny<input class="f" type="time" name="tf" value="08:00" required></label><label>Do godziny<input class="f" type="time" name="tt" value="11:00" required></label>
    <label>Obowiązuje od<input class="f" type="date" name="vf" value="${adm?iso(today()):nextMon()}" ${adm?'':`min="${nextMon()}"`} required></label><label>Do (opcjonalnie)<input class="f" type="date" name="vt"></label></div>
    <p class="hint">${adm?'Wzorzec dodany przez Administratora obowiązuje od razu.':'Wzorzec trafi do zatwierdzenia i zacznie obowiązywać najwcześniej od następnego tygodnia.'}</p>`,
  {ok:'Dodaj',onOk:v=>{const days=[1,2,3,4,5,6,7].filter(d=>v['d'+d]);if(!days.length){toast('Wybierz co najmniej jeden dzień',true);return false}
    return nact(async()=>chk(await sb.from('nurse_patterns').insert(days.map(d=>({nurse_id:id,dow:d,time_from:v.tf,time_to:v.tt,valid_from:v.vf,valid_to:v.vt||null,status:adm?'approved':'pending'})))),adm?'Dodano wzorzec':'Wysłano do zatwierdzenia')}});
}
function exceptionModal(id){
  const adm=nAdmin();
  modal('Dodaj wyjątek',`<div class="form"><label>Rodzaj<select class="f" name="k">${Object.entries(EXK).map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select></label><label>Od dnia<input class="f" type="date" name="df" value="${iso(today())}" min="${iso(today())}" required></label><label>Do dnia<input class="f" type="date" name="dt" value="${iso(today())}" required></label>
    <label>Od godziny<input class="f" type="time" name="tf"></label><label>Do godziny<input class="f" type="time" name="tt"></label><label class="full">Uwaga<input class="f" name="note"></label></div>
    <p class="hint">Bez godzin = cały dzień. „Dodatkowe godziny” wymagają godzin. ${adm?'':'Wyjątek trafi do zatwierdzenia.'}</p>`,
  {ok:'Dodaj',onOk:v=>nact(async()=>chk(await sb.from('nurse_exceptions').insert({nurse_id:id,kind:v.k,date_from:v.df,date_to:v.dt,time_from:v.tf||null,time_to:v.tt||null,note:v.note||'',status:adm?'approved':'pending'})),adm?'Dodano wyjątek':'Wysłano do zatwierdzenia')});
}
const patDecide=(id,ok)=>nsafe(async()=>chk(ok?await sb.from('nurse_patterns').update({status:'approved'}).eq('id',id):await sb.from('nurse_patterns').delete().eq('id',id)),ok?'Wzorzec zatwierdzony':'Wzorzec odrzucony');
const patEnd=(id,ok)=>{const p=NZ.D.patterns.find(x=>x.id===id);nsafe(async()=>chk(await sb.from('nurse_patterns').update(ok?{valid_to:iso(addDays(parseD(p.end_requested),-1)),end_requested:null}:{end_requested:null}).eq('id',id)),ok?'Wzorzec zakończony':'Odrzucono prośbę')};
const patStop=id=>{const d=prompt('Ostatni dzień obowiązywania wzorca (RRRR-MM-DD):',iso(addDays(monday(1),-1)));if(d)nsafe(async()=>chk(await sb.from('nurse_patterns').update({valid_to:d}).eq('id',id)),'Wzorzec zakończony')};
const patAskEnd=id=>{const d=prompt('Od którego dnia wzorzec ma przestać obowiązywać? (RRRR-MM-DD, najwcześniej '+fD(nextMon())+')',nextMon());if(d)nsafe(async()=>chk(await sb.from('nurse_patterns').update({end_requested:d}).eq('id',id)),'Prośba wysłana do zatwierdzenia')};
const patDel=id=>nsafe(async()=>chk(await sb.from('nurse_patterns').delete().eq('id',id)),'Usunięto');
const excDecide=(id)=>nsafe(async()=>chk(await sb.from('nurse_exceptions').update({status:'approved'}).eq('id',id)),'Wyjątek zatwierdzony');
const excDel=id=>nsafe(async()=>chk(await sb.from('nurse_exceptions').delete().eq('id',id)),'Usunięto');
function areaDecide(id,ok){
  if(ok)return nsafe(async()=>chk(await sb.from('nurse_areas').update({status:'approved'}).eq('id',id)),'Obszar zatwierdzony');
  askReason('Odeślij obszar do poprawy','Uwaga dla pielęgniarki',r=>nact(async()=>chk(await sb.from('nurse_areas').update({status:'draft',note:r}).eq('id',id)),'Odesłano do poprawy'),{ok:'Odeślij',danger:false});
}

/* --- terminarz tygodnia --- */
function weekGrid(id){
  const m=monday(NZ.week),days=[...Array(7)].map((_,i)=>addDays(m,i)),plans=days.map(d=>dayPlan(id,d)),buf=NZ.D.cfg.travel_buffer_min||0;
  const all=plans.flatMap(p=>[...p.win,...p.pend,...p.vis,...p.exc.filter(x=>x.to-x.from<1440)]);
  const h0=Math.min(7,...all.map(b=>Math.floor(b.from/60))),h1=Math.max(18,...all.map(b=>Math.ceil(b.to/60))),PX=34,H=(h1-h0)*PX,y=m=>(Math.max(m,h0*60)-h0*60)/60*PX,hh=(a,b)=>Math.max(14,y(b)-y(a));
  const col=(p,d)=>`<div class="col" style="height:${H}px">${p.exc.map(b=>`<div class="nzb exc" style="top:${y(b.from)}px;height:${hh(b.from,Math.min(b.to,h1*60))}px">Wyjątek: ${EXK[b.e.kind]}</div>`).join('')}
    ${p.win.map(b=>`<div class="nzb win" style="top:${y(b.from)}px;height:${hh(b.from,b.to)}px">dostępna ${hm(b.from)}–${hm(b.to)}</div>`).join('')}
    ${p.pend.map(b=>`<div class="nzb pend" style="top:${y(b.from)}px;height:${hh(b.from,Math.min(b.to,h1*60))}px">do zatwierdzenia</div>`).join('')}
    ${p.vis.map(b=>`${buf?`<div class="nzb buf" style="top:${y(b.from-buf)}px;height:${hh(b.from-buf,b.from)}px"></div><div class="nzb buf" style="top:${y(b.to)}px;height:${hh(b.to,b.to+buf)}px"></div>`:''}<div class="nzb vis" style="top:${y(b.from)}px;height:${hh(b.from,b.to)}px;background:${esc(NN(id).color)}">Wizyta ${hm(b.from)}${b.o.status==='zaproponowane'?' (propozycja)':''}</div>`).join('')}</div>`;
  return `<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px"><button class="btn sm" onclick="NZ.week--;rerender()">‹</button><b>${fD(iso(m))} – ${fD(iso(days[6]))}</b><button class="btn sm" onclick="NZ.week++;rerender()">›</button>${NZ.week?`<button class="btn sm" onclick="NZ.week=0;rerender()">Ten tydzień</button>`:''}</div>
    <div class="nzweek"><div></div>${days.map(d=>`<div class="dh ${iso(d)===iso(today())?'st-open':''}">${DOWS[isoDow(d)]} ${pad(d.getDate())}.${pad(d.getMonth()+1)}</div>`).join('')}
    <div class="hc" style="height:${H}px">${[...Array(h1-h0+1)].map((_,i)=>`<div style="top:${i*PX}px">${h0+i}:00</div>`).join('')}</div>${plans.map(col).join('')}</div>
    <div class="nzflow" style="margin-top:10px"><span><span class="dotc" style="background:var(--good)"></span> okno dostępności</span><span><span class="dotc" style="background:${esc(NN(id).color)}"></span> zajęte wizytą</span><span>▨ bufor na dojazd (${buf} min)</span><span><span class="dotc" style="background:var(--bad)"></span> wyjątek</span><span style="border-style:dashed">czeka na zatwierdzenie</span></div>`;
}
function calendarView(id){
  if(isNurse())id=NZ.D.me?.id;const n=NN(id);need(n.id,'Nie ma takiej pielęgniarki');
  return `<div class="ph"><div><h1 style="display:flex;gap:10px;align-items:center">${nAv(n,34)} Dostępność: ${esc(n.full_name)}</h1><p>Powtarzalny wzorzec tygodnia + wyjątki. Wizyty blokują okna, a między wizytami system dolicza bufor na dojazd.</p></div>${isNurse()?'':`<a class="btn" href="#/pielegniarki">← Widok główny</a>`}</div>
    <div class="grid" style="grid-template-columns:minmax(0,1fr) 340px;align-items:start"><div class="card">${weekGrid(id)}</div><div class="card">${patternsBlock(id)}</div></div>`;
}

/* --- panel przydziału zleceń --- */
function ruleDraft(){
  const cities=[...new Set([...NZ.D.nurses.map(n=>n.city),...NZ.D.rules.map(r=>r.city)].filter(Boolean))];
  if(!NZ.scope.city)NZ.scope.city=NN(NZ.sel).city||cities[0]||'';
  const r=NZ.D.rules.find(x=>x.city.toLowerCase()===NZ.scope.city.toLowerCase()&&String(x.district||'').toLowerCase()===String(NZ.scope.district||'').toLowerCase());
  if(!NZ.rd||NZ.rd.key!==NZ.scope.city+'|'+NZ.scope.district)
    NZ.rd={key:NZ.scope.city+'|'+NZ.scope.district,id:r?.id||null,kind:r?.kind||'weighted',timeout:r?.accept_timeout_min??'',pointer:r?.rr_pointer||0,
      pool:r?NZ.D.pool.filter(p=>p.rule_id===r.id).sort((a,b)=>a.sort_order-b.sort_order).map(p=>({...p})):[]};
  return {cities,r};
}
function preview(rd,k=10){
  const P=rd.pool;if(!P.length||rd.kind==='manual')return [];
  const out=[];
  if(rd.kind==='weighted'){const cur=P.map(p=>+p.swrr||0),tot=P.reduce((s,p)=>s+ +p.weight,0);for(let i=0;i<k;i++){P.forEach((p,j)=>cur[j]+=+p.weight);let b=0;cur.forEach((c,j)=>{if(c>cur[b])b=j});cur[b]-=tot;out.push(P[b].nurse_id)}return out}
  const today_=iso(today()),cnt={};NZ.D.attempts.filter(a=>['zaproponowane','przyjete'].includes(a.result)&&iso(new Date(a.proposed_at))===today_&&NZ.D.orders.find(o=>o.id===a.order_id)?.rule_id===rd.id).forEach(a=>cnt[a.nurse_id]=(cnt[a.nurse_id]||0)+1);
  let ptr=rd.pointer;const rr=P.filter(p=>rd.kind==='round_robin'||!p.queue_limit);
  for(let i=0;i<k;i++){
    let pick=null;
    if(rd.kind==='queue')pick=P.find(p=>p.queue_limit&&(cnt[p.nurse_id]||0)<p.queue_limit);
    if(!pick&&rr.length){pick=rr.find(p=>p.sort_order>ptr)||rr[0];ptr=pick.sort_order}
    if(!pick)break;cnt[pick.nurse_id]=(cnt[pick.nurse_id]||0)+1;out.push(pick.nurse_id);
  }
  return out;
}
function paintRule(){
  const el=$('#nzrule');if(!el)return;const {cities,r}=ruleDraft(),rd=NZ.rd,ds=distOf(NZ.scope.city),tot=rd.pool.reduce((s,p)=>s+ +p.weight,0),cfg=NZ.D.cfg;
  const todayOrders=r?NZ.D.attempts.filter(a=>['zaproponowane','przyjete'].includes(a.result)&&iso(new Date(a.proposed_at))===iso(today())&&NZ.D.orders.find(o=>o.id===a.order_id)?.rule_id===r.id):[];
  const pv=preview(rd);
  el.innerHTML=`<h3 style="flex-wrap:wrap">Przydział zleceń: <span style="display:flex;gap:6px;flex-wrap:wrap;flex:1"><select class="f" style="width:auto" onchange="NZ.scope={city:this.value,district:''};NZ.rd=null;paintRule()">${cities.map(c=>`<option ${c===NZ.scope.city?'selected':''}>${esc(c)}</option>`).join('')}<option value="">— inne miasto —</option></select>
      ${NZ.scope.city===''?`<input class="f" style="width:160px" placeholder="nazwa miasta" onchange="NZ.scope={city:this.value.trim(),district:''};NZ.rd=null;paintRule()">`:''}
      <select class="f" style="width:auto" onchange="NZ.scope.district=this.value;NZ.rd=null;paintRule()"><option value="">Całe miasto</option>${ds.map(d=>`<option ${d.name===NZ.scope.district?'selected':''}>${esc(d.name)}</option>`).join('')}</select></span>
      <span class="chips">${Object.entries(RK).map(([k,[l]])=>`<button class="chip ${rd.kind===k?'on':''}" onclick="NZ.rd.kind='${k}';paintRule()">${l}</button>`).join('')}</span></h3>
    ${cfg.overlap_mode==='distance'?'<div class="note info" style="margin-bottom:10px">Ustawienia: przy nakładających się obszarach decyduje <b>odległość</b> — reguła z wagami / kolejką nie jest używana (poza trybem „ręcznie”).</div>':''}
    ${r?'':'<div class="note" style="margin-bottom:10px">Dla tego zakresu nie ma jeszcze reguły. Zlecenia stąd trafiają do dyspozytora.</div>'}
    <div class="grid g2" style="align-items:start"><div><div class="nzlbl">Pula pielęgniarek · ${esc(RK[rd.kind][1])}</div>
      <div class="tw"><table class="nzpool"><tr><th></th><th>Pielęgniarka</th>${rd.kind==='weighted'?'<th>Waga</th><th>Udział</th>':''}<th>Limit dzienny</th>${rd.kind==='queue'?'<th>Kolejka (pierwsze N)</th>':''}<th>Status</th><th></th></tr>
      ${rd.pool.map((p,i)=>{const n=NN(p.nurse_id);return `<tr><td style="white-space:nowrap"><button class="btn sm" ${i?'':'disabled'} onclick="poolMove(${i},-1)">↑</button><button class="btn sm" ${i<rd.pool.length-1?'':'disabled'} onclick="poolMove(${i},1)">↓</button></td><td>${nChip(n.id)} ${esc(n.full_name)}</td>
        ${rd.kind==='weighted'?`<td><input class="f" type="number" min="1" step="1" style="width:70px" value="${+p.weight}" onchange="NZ.rd.pool[${i}].weight=Math.max(1,+this.value||1);paintRule()"></td><td><b>${tot?Math.round(p.weight/tot*100):0} %</b></td>`:''}
        <td><input class="f" type="number" min="1" style="width:70px" placeholder="${cfg.max_visits_per_day}" value="${p.daily_limit??''}" onchange="NZ.rd.pool[${i}].daily_limit=this.value?+this.value:null"></td>
        ${rd.kind==='queue'?`<td><input class="f" type="number" min="1" style="width:80px" placeholder="bez" value="${p.queue_limit??''}" onchange="NZ.rd.pool[${i}].queue_limit=this.value?+this.value:null;paintRule()"></td>`:''}
        <td><span class="badge ${NSTB[n.status]}">${NST[n.status]}</span></td><td><button class="btn sm del" onclick="NZ.rd.pool.splice(${i},1);paintRule()">✕</button></td></tr>`}).join('')}</table></div>
      <div style="display:flex;gap:6px;margin-top:8px"><select class="f" id="nzAddPool" style="width:auto"><option value="">+ dodaj do puli…</option>${NZ.D.nurses.filter(n=>!rd.pool.some(p=>p.nurse_id===n.id)).map(n=>`<option value="${n.id}">${esc(n.full_name)}${n.city?' · '+esc(n.city):''}</option>`).join('')}</select></div></div>
    <div><div class="nzlbl">Podgląd: komu trafi najbliższych 10 zleceń</div>${rd.kind==='manual'?`<div class="note">${RK.manual[1]}</div>`:pv.length?`<div>${pv.map((id,i)=>`<span class="mut small">${i+1}.</span>${nChip(id)}`).join(' ')}</div><p class="hint">Podgląd zakłada, że wszystkie osoby z puli są dostępne. Najpierw działają twarde filtry: obszar, wolny termin, rodzaj badania, limit dzienny.</p>`:'<div class="mut small">Dodaj osoby do puli.</div>'}
      <div class="nzlbl">Limit czasu na przyjęcie</div><div style="display:flex;gap:8px;align-items:center"><input class="f" type="number" min="1" max="240" style="width:80px" placeholder="${cfg.accept_timeout_min}" value="${rd.timeout}" onchange="NZ.rd.timeout=this.value"> <span class="small mut">min (puste = z ustawień: ${cfg.accept_timeout_min} min). Po przekroczeniu zlecenie przechodzi do następnej osoby z puli.</span></div>
      <div class="nzflow" style="margin-top:12px"><span>Nowe zlecenie</span>→<span>Propozycja wg reguły</span>→<span>${rd.timeout||cfg.accept_timeout_min} min bez akceptacji</span>→<span>Następna z puli</span>→<span>Brak chętnych: dyspozytor</span></div>
      ${r?`<p class="small" style="margin-top:12px">Dziś rozdzielono <b>${plural(todayOrders.length,'zlecenie','zlecenia','zleceń')}</b>${todayOrders.length?': '+rd.pool.map(p=>`${nChip(p.nurse_id)} ${todayOrders.filter(a=>a.nurse_id===p.nurse_id).length}`).join(' / '):''}</p>`:''}</div></div>
    <div class="mfoot">${r?`<button class="btn del" onclick="ruleDelete('${r.id}')">Usuń regułę</button>`:''}<button class="btn pri" onclick="ruleSave()">Zapisz regułę</button></div>`;
  const s=$('#nzAddPool');if(s)s.onchange=()=>{if(!s.value)return;NZ.rd.pool.push({nurse_id:s.value,weight:1,daily_limit:null,queue_limit:null,sort_order:0,swrr:0});paintRule()};
}
function poolMove(i,d){const P=NZ.rd.pool,j=i+d;[P[i],P[j]]=[P[j],P[i]];paintRule()}
async function ruleSave(){
  const rd=NZ.rd;if(!NZ.scope.city)return toast('Podaj miasto',true);
  await nsafe(async()=>{
    let id=rd.id;const row={city:NZ.scope.city,district:NZ.scope.district||null,kind:rd.kind,accept_timeout_min:rd.timeout?+rd.timeout:null,updated_by:ME.id,updated_at:new Date().toISOString()};
    if(id)chk(await sb.from('assignment_rules').update(row).eq('id',id));else id=chk(await sb.from('assignment_rules').insert(row).select().single()).id;
    const keep=rd.pool.map(p=>p.nurse_id);
    for(const p of NZ.D.pool.filter(p=>p.rule_id===id&&!keep.includes(p.nurse_id)))chk(await sb.from('assignment_pool').delete().eq('rule_id',id).eq('nurse_id',p.nurse_id));
    if(rd.pool.length)chk(await sb.from('assignment_pool').upsert(rd.pool.map((p,i)=>({rule_id:id,nurse_id:p.nurse_id,weight:+p.weight||1,daily_limit:p.daily_limit||null,queue_limit:p.queue_limit||null,sort_order:i+1}))));
  },'Zapisano regułę przydziału');NZ.rd=null;
}
const ruleDelete=id=>{if(confirm('Usunąć regułę? Zlecenia z tego zakresu trafią do dyspozytora (albo do reguły całego miasta).'))nsafe(async()=>chk(await sb.from('assignment_rules').delete().eq('id',id)),'Usunięto regułę').then(()=>NZ.rd=null)};

/* =====================================================================
   PIELĘGNIARKA: dane, usługi, dokumenty, nadpisanie stawek
   ===================================================================== */
function nurseModal(id){
  const n=id?NN(id):{full_name:'',color:nurseColor(NZ.D.nurses.length),city:'',phone:'',email:'',status:'do_weryfikacji',rating:null,user_id:null};
  const accs=DB.users.filter(u=>u.role==='nurse'&&(!NZ.D.nurses.some(x=>x.user_id===u.id)||u.id===n.user_id));
  const mine=new Set(NZ.D.links.filter(l=>l.nurse_id===id).map(l=>l.service_id));
  modal(id?`Pielęgniarka — ${n.full_name}`:'Dodaj pielęgniarkę',`<div class="form"><label>Imię i nazwisko<input class="f" name="name" required minlength="3" value="${esc(n.full_name)}"></label><label>Kolor<input class="f" type="color" name="color" value="${esc(n.color)}" style="height:38px;padding:3px"></label>
    <label>Miasto<input class="f" name="city" value="${esc(n.city)}" placeholder="np. Warszawa"></label><label>Status<select class="f" name="status">${Object.entries(NST).map(([k,l])=>`<option value="${k}" ${n.status===k?'selected':''}>${l}</option>`).join('')}</select></label>
    <label>Telefon<input class="f" name="phone" value="${esc(n.phone)}"></label><label>E-mail<input class="f" type="email" name="email" value="${esc(n.email)}"></label>
    <label>Ocena (0–5)<input class="f" type="number" name="rating" min="0" max="5" step="0.1" value="${n.rating??''}"></label>
    <label>Konto do panelu pielęgniarki<select class="f" name="user"><option value="">— brak —</option>${accs.map(u=>`<option value="${u.id}" ${u.id===n.user_id?'selected':''}>${esc(u.name)} (${esc(u.email)})</option>`).join('')}</select></label>
    <div class="full fl">Usługi, które wykonuje<div class="chips">${NZ.D.services.map(s=>`<label class="chk" style="margin-right:8px"><input type="checkbox" name="s_${s.id}" ${mine.has(s.id)?'checked':''}>${esc(s.name)}</label>`).join('')||'<span class="mut">Dodaj usługi w Ustawieniach.</span>'}</div></div></div>
    <p class="hint">Konto zakłada Administrator w Supabase (Authentication → Users), a w CRM → Ustawienia → Użytkownicy nadaje rolę „Pielęgniarka”. Pielęgniarka widzi wtedy tylko własny panel: obszar, terminarz, stawki i swoje zlecenia.</p>`,
  {onOk:v=>nact(async()=>{
    const row={full_name:v.name.trim(),color:v.color,city:v.city.trim(),status:v.status,phone:v.phone.trim(),email:v.email.trim(),rating:v.rating===''?null:+v.rating,user_id:v.user||null};
    const nid=id?(chk(await sb.from('nurses').update(row).eq('id',id)),id):chk(await sb.from('nurses').insert(row).select().single()).id;
    const want=NZ.D.services.filter(s=>v['s_'+s.id]).map(s=>s.id);
    for(const s of [...mine].filter(x=>!want.includes(x)))chk(await sb.from('nurse_service_links').delete().eq('nurse_id',nid).eq('service_id',s));
    const add=want.filter(x=>!mine.has(x));if(add.length)chk(await sb.from('nurse_service_links').insert(add.map(s=>({nurse_id:nid,service_id:s}))));
    NZ.sel=nid;
  },id?'Zapisano':'Dodano pielęgniarkę')});
}
function overrideModal(id){
  const zs=zonesFor(id),n=NN(id),ov=NZ.D.zones.filter(z=>z.nurse_id===id),maxNo=Math.max(0,...zs.map(z=>z.zone_no));
  const row=(z,extra)=>`<tr><td>${extra?`<input class="f" type="number" name="no_x" value="${maxNo+1}" style="width:60px">`:z.zone_no}</td><td>${extra?`<input class="f" type="number" step="0.1" name="kf_x" style="width:70px"> – <input class="f" type="number" step="0.1" name="kt_x" style="width:70px">`:`${z.km_from}–${z.km_to} km`}</td>
    <td><input class="f" type="number" min="0" step="1" name="pc_${extra?'x':z.zone_no}" placeholder="${extra?'':z.tpl.price_client??''}" value="${extra?'':z.ovr?.price_client??''}" style="width:90px"></td><td><input class="f" type="number" min="0" step="1" name="po_${extra?'x':z.zone_no}" placeholder="${extra?'':z.tpl.payout??''}" value="${extra?'':z.ovr?.payout??''}" style="width:90px"></td></tr>`;
  modal(`Nadpisanie stawek — ${n.full_name}`,`<div class="tw"><table><tr><th>Strefa</th><th>Zakres</th><th>Cena dla klienta</th><th>Wypłata pielęgniarki</th></tr>${zs.map(z=>row(z)).join('')}${row({},true)}</table></div>
    <p class="hint">Puste pole = kwota z szablonu miasta (szare). Przykład z projektu: strefa 2 wypłata 30 zł zamiast 25 zł — cena dla klienta bez zmian, marża spada. Ostatni wiersz dodaje własną strefę (np. dojazd do innego miasta).</p>`,
  {wide:true,onOk:v=>nact(async()=>{
    for(const z of ov)chk(await sb.from('price_zones').delete().eq('id',z.id));
    const rows=zs.map(z=>({nurse_id:id,zone_no:z.zone_no,price_client:v['pc_'+z.zone_no]===''?null:+v['pc_'+z.zone_no],payout:v['po_'+z.zone_no]===''?null:+v['po_'+z.zone_no]})).filter(r=>r.price_client!=null||r.payout!=null);
    if(v.kf_x!==''&&v.kt_x!==''&&v.pc_x!==''&&v.po_x!=='')rows.push({nurse_id:id,zone_no:+v.no_x,km_from:+v.kf_x,km_to:+v.kt_x,price_client:+v.pc_x,payout:+v.po_x});
    if(rows.length)chk(await sb.from('price_zones').insert(rows));
  },'Zapisano stawki')});
}
function nurseDocModal(id){
  modal('Dodaj dokument',`<div class="form"><label>Rodzaj<select class="f" name="k"><option>PWZ</option><option>OC</option><option value="umowa">Umowa</option><option value="inne">Inne</option></select></label><label>Numer<input class="f" name="no"></label><label>Ważne do<input class="f" type="date" name="vu"></label><label>Plik (opcjonalnie)<input class="f" type="file" name="file" accept=".pdf,.jpg,.jpeg,.png"></label></div>`,
  {ok:'Dodaj',onOk:(v,f)=>nact(async()=>{const file=f.file.files[0];let path=null;
    if(file){if(file.size>10*1048576)throw new Error('Plik większy niż 10 MB');path=`${id}/${Date.now()}-${safeName(file.name)}`;chk(await sb.storage.from('pielegniarki').upload(path,file))}
    chk(await sb.from('nurse_documents').insert({nurse_id:id,kind:v.k,number:v.no||'',valid_until:v.vu||null,storage_path:path,file_name:file?.name||null}))},'Dodano dokument')});
}
async function nurseDocGet(id){const d=NZ.D.docs.find(x=>x.id===id);const r=await sb.storage.from('pielegniarki').createSignedUrl(d.storage_path,60);if(r.error)return toast(errMsg(r.error),true);window.open(r.data.signedUrl,'_blank')}
const nurseDocDel=id=>{if(confirm('Usunąć wpis dokumentu?'))nsafe(async()=>chk(await sb.from('nurse_documents').delete().eq('id',id)),'Usunięto')};

/* =====================================================================
   EDYTOR OBSZARU (pielęgniarka rysuje, admin zatwierdza)
   ===================================================================== */
function edState(id){
  if(NZ.ed&&NZ.ed.nurseId===id)return NZ.ed;
  const n=NN(id),src=openArea(id)||approvedArea(id);
  NZ.ed={nurseId:id,areaId:openArea(id)?.id||null,shapes:JSON.parse(JSON.stringify(src?.shapes||[])),base:src?.base_lat!=null?{lat:src.base_lat,lng:src.base_lng,label:src.base_label}:n.base_lat!=null?{lat:n.base_lat,lng:n.base_lng,label:n.base_label}:null,
    mode:'districts',city:n.city||NZ.D.districts[0]?.city||'',poly:[],km:30,note:openArea(id)?.note||''};
  return NZ.ed;
}
function areaEditor(id){
  if(isNurse())id=NZ.D.me?.id;const n=NN(id);need(n.id,'Nie ma takiej pielęgniarki');const e=edState(id),op=openArea(id),cities=[...new Set([n.city,...NZ.D.districts.map(d=>d.city)].filter(Boolean))];
  return `<div class="ph"><div><h1 style="display:flex;gap:10px;align-items:center">${nAv(n,34)} ${isNurse()?'Mój obszar pracy':'Obszar pracy: '+esc(n.full_name)}</h1><p>Stan: ${op?.status==='pending'?'<span class="badge b-warn">do zatwierdzenia</span>':op?'<span class="badge">szkic</span>':approvedArea(id)?'<span class="badge b-good">zatwierdzony</span>':'<span class="badge">brak obszaru</span>'}</p></div>${isNurse()?'':`<a class="btn" href="#/pielegniarki">← Widok główny</a>`}</div>
  ${e.note?`<div class="note" style="margin-bottom:12px">Uwaga od Administratora: ${esc(e.note)}</div>`:''}
  <div class="grid" style="grid-template-columns:minmax(0,1fr) 330px;align-items:start"><div>
    <div class="toolbar"><span class="chips">${[['districts','Dzielnice'],['polygon','Własny wielokąt'],['radius','Miasto + promień'],['base','Punkt bazowy']].map(([k,l])=>`<button class="chip ${e.mode===k?'on':''}" onclick="NZ.ed.mode='${k}';NZ.ed.poly=[];rerender()">${l}</button>`).join('')}</span>
      ${e.mode==='districts'?`<select class="f" onchange="NZ.ed.city=this.value;rerender()">${cities.map(c=>`<option ${c===e.city?'selected':''}>${esc(c)}</option>`).join('')}</select><button class="btn sm" onclick="edWholeCity()">Całe miasto</button>`:''}
      ${e.mode==='radius'?`<label class="small mut" style="display:flex;gap:6px;align-items:center">Promień <input class="f" type="number" min="1" max="300" value="${e.km}" style="width:80px" onchange="NZ.ed.km=+this.value||1"> km</label>`:''}
      ${e.mode==='polygon'?`<button class="btn sm" onclick="NZ.ed.poly.pop();edDraw()">Cofnij punkt</button><button class="btn sm pri" onclick="edPolyDone()">Zakończ wielokąt</button>`:''}</div>
    <div class="nzmap sm" id="nzedmap"></div><p class="hint">${{districts:'Kliknij dzielnicę, aby ją dodać lub usunąć.',polygon:'Klikaj na mapie, aby wyznaczyć granicę; potem „Zakończ wielokąt”.',radius:'Kliknij punkt na mapie — obszar to koło o podanym promieniu (np. Kalisz + 30 km).',base:'Kliknij miejsce, z którego pielęgniarka wyjeżdża — od niego liczą się strefy cenowe.'}[e.mode]}${distOf(e.city).length||e.mode!=='districts'?'':' <b>Brak granic dzielnic dla tego miasta — Administrator importuje je w Ustawieniach.</b>'}</p></div>
  <div class="card"><div class="nzlbl" style="margin-top:0">Wybrany obszar</div>${e.shapes.length?e.shapes.map((s,i)=>`<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px"><span class="chip" style="flex:1">${esc(shapeTxt(s))}</span><button class="btn sm del" onclick="NZ.ed.shapes.splice(${i},1);rerender()">✕</button></div>`).join(''):'<div class="mut small">nic nie wybrano</div>'}
    <div class="nzlbl">Punkt bazowy</div>${e.base?`<div style="display:flex;gap:6px"><input class="f" value="${esc(e.base.label||'')}" placeholder="opis, np. Włochy" onchange="NZ.ed.base.label=this.value"></div><div class="small mut" style="margin-top:4px">${(+e.base.lat).toFixed(5)}, ${(+e.base.lng).toFixed(5)}</div>`:'<div class="mut small">nie ustawiony — wybierz „Punkt bazowy” i kliknij na mapie</div>'}
    <div class="nzlbl">Status zatwierdzenia</div><div class="nzflow"><span ${op?.status==='draft'?'style="border-color:var(--accent)"':''}>Szkic</span>→<span ${op?.status==='pending'?'style="border-color:var(--warn)"':''}>Do zatwierdzenia</span>→<span ${!op&&approvedArea(id)?'style="border-color:var(--good)"':''}>Zatwierdzony</span></div>
    <div class="mfoot" style="flex-wrap:wrap"><button class="btn" onclick="edSave('draft')">Zapisz szkic</button><button class="btn pri" onclick="edSave('pending')">Wyślij do zatwierdzenia</button>${nAdmin()?`<button class="btn pri" onclick="edSave('approved')">Zatwierdź od razu</button>`:''}</div>
    <p class="hint">Zmiana obszaru nie działa od razu: przechodzi ścieżkę szkic → do zatwierdzenia → zatwierdzony. Nowy obszar widać jako szkic obok obecnego (linia przerywana). Obszar mówi, GDZIE pielęgniarka pracuje; strefy cenowe — ILE kosztuje dojazd.</p></div></div>`;
}
async function mountEditor(){
  NZ.map?.destroy?.();const e=NZ.ed;
  NZ.map=await makeMap($('#nzedmap'),{view:NZ.edView,onMove:v=>NZ.edView=v,onClick:(lat,lng)=>{
    if(e.mode==='polygon'){e.poly.push([lat,lng]);edDraw()}
    else if(e.mode==='radius'){e.shapes.push({type:'radius',lat:+lat.toFixed(6),lng:+lng.toFixed(6),km:e.km,label:e.city||'punkt'});rerender()}
    else if(e.mode==='base'){e.base={lat:+lat.toFixed(6),lng:+lng.toFixed(6),label:e.base?.label||''};rerender()}
  }});
  edDraw(!NZ.edView);
}
function edDraw(fit){
  const M=NZ.map,e=NZ.ed;if(!M||!e)return;M.clear();const n=NN(e.nurseId),pts=[];
  const ds=e.shapes.find(s=>s.type==='districts'&&s.city===e.city),whole=e.shapes.some(s=>s.type==='city'&&s.city===e.city);
  distOf(e.city).forEach(d=>{const on=whole||ds?.names.includes(d.name);M.poly(d.rings,{color:on?n.color:'#64748b',fill:on?.35:.04,weight:1,title:d.name,interactive:e.mode==='districts',onClick:()=>edToggle(d.name)});d.c&&pts.push(d.c)});
  const ap=approvedArea(e.nurseId);ap&&ap.shapes.forEach(s=>drawShape(M,s,{color:'#64748b',fill:0,dash:true,interactive:false}));
  e.shapes.filter(s=>s.type!=='districts'&&!(s.type==='city'&&s.city===e.city)).forEach(s=>drawShape(M,s,{color:n.color,fill:.25,interactive:false}));
  if(e.poly.length){M.line(e.poly,{color:n.color});e.poly.forEach(p=>M.marker(p[0],p[1],{color:n.color,label:''}))}
  if(e.base){M.marker(e.base.lat,e.base.lng,{color:n.color,label:'B',title:'punkt bazowy'});pts.push([e.base.lat,e.base.lng])}
  if(fit)M.fit(pts);
}
function edToggle(name){
  const e=NZ.ed;if(e.shapes.some(s=>s.type==='city'&&s.city===e.city)){e.shapes=e.shapes.filter(s=>!(s.type==='city'&&s.city===e.city));e.shapes.push({type:'districts',city:e.city,names:distOf(e.city).map(d=>d.name)})}
  let s=e.shapes.find(x=>x.type==='districts'&&x.city===e.city);if(!s){s={type:'districts',city:e.city,names:[]};e.shapes.push(s)}
  s.names=s.names.includes(name)?s.names.filter(x=>x!==name):[...s.names,name];if(!s.names.length)e.shapes=e.shapes.filter(x=>x!==s);rerender();
}
function edWholeCity(){const e=NZ.ed;e.shapes=e.shapes.filter(s=>!((s.type==='districts'||s.type==='city')&&s.city===e.city));e.shapes.push({type:'city',city:e.city});rerender()}
function edPolyDone(){const e=NZ.ed;if(e.poly.length<3)return toast('Wielokąt wymaga co najmniej 3 punktów',true);e.shapes.push({type:'polygon',points:e.poly.map(p=>[+p[0].toFixed(6),+p[1].toFixed(6)])});e.poly=[];rerender()}
async function edSave(status){
  const e=NZ.ed;if(status!=='draft'&&!e.shapes.length)return toast('Wybierz obszar',true);if(status!=='draft'&&!e.base)return toast('Ustaw punkt bazowy',true);
  const row={shapes:e.shapes,base_lat:e.base?.lat??null,base_lng:e.base?.lng??null,base_label:e.base?.label||'',status,note:''};
  await nsafe(async()=>{if(e.areaId)chk(await sb.from('nurse_areas').update(row).eq('id',e.areaId));else chk(await sb.from('nurse_areas').insert({...row,nurse_id:e.nurseId}))},
    {draft:'Zapisano szkic',pending:'Wysłano do zatwierdzenia',approved:'Obszar zatwierdzony'}[status]);
  NZ.ed=null;if(status==='approved'&&!isNurse())location.hash='#/pielegniarki';else rerender();
}

/* =====================================================================
   ZLECENIA: lista, raport, nowe zlecenie, dyspozytor
   ===================================================================== */
function ordersView(){
  const all=NZ.D.orders,f=NZ.ost,L=(f==='disp'?all.filter(o=>o.status==='nowe'&&o.needs_dispatcher):f?all.filter(o=>o.status===f):all.filter(o=>o.status!=='rozliczone'||new Date(o.start_at)>addDays(today(),-30))).slice().reverse();
  const m0=new Date(today().getFullYear(),today().getMonth(),1),mo=all.filter(o=>new Date(o.start_at)>=m0&&new Date(o.start_at)<new Date(m0.getFullYear(),m0.getMonth()+1,1)&&['wykonane','rozliczone'].includes(o.status));
  const sum=k=>mo.reduce((s,o)=>s+(+o[k]||0),0);
  return `<div class="ph"><div><h1>Zlecenia</h1><p>Statusy: Nowe → Zaproponowane → Przyjęte → W drodze → Wykonane → Rozliczone</p></div><button class="btn pri" onclick="orderModal()">+ Nowe zlecenie</button></div>
  <div class="grid g4" style="margin-bottom:14px"><div class="tile"><span>Wykonane w tym miesiącu</span><b>${mo.length}</b></div><div class="tile"><span>Dojazdy — klienci</span><b style="font-size:1.4rem">${money(sum('price_travel'))}</b></div><div class="tile"><span>Dojazdy — wypłaty</span><b style="font-size:1.4rem">${money(sum('payout_travel'))}</b></div><div class="tile"><span>Marża na dojazdach</span><b style="font-size:1.4rem;color:var(--good)">${money(sum('margin'))}</b><small class="mut">liczona przy każdym zleceniu</small></div></div>
  <div class="toolbar chips">${[['','Aktywne'],['disp','Czeka na dyspozytora'],...Object.entries(OST)].map(([k,l])=>`<button class="chip ${f===k?'on':''}" onclick="NZ.ost='${k}';rerender()">${l}${k==='disp'?` (${all.filter(o=>o.status==='nowe'&&o.needs_dispatcher).length})`:''}</button>`).join('')}<button class="btn sm" onclick="exportOrdersCsv()">Eksport CSV</button></div>
  <div class="card"><div class="tw"><table><tr><th>#</th><th>Termin</th><th>Klient / adres</th><th>Usługa</th><th>Pielęgniarka</th><th>Status</th><th>Dojazd: klient / pielęg. / marża</th><th></th></tr>
  ${L.map(o=>`<tr><td><b>#${o.number}</b></td><td style="white-space:nowrap">${fDT(o.start_at)}</td><td>${esc(o.client_name)}<br><small class="mut">${esc(o.address)}${o.district?' · '+esc(o.district):''}</small></td><td>${esc(SV(o.service_id).name)}</td>
    <td>${o.nurse_id?`${nChip(o.nurse_id)} ${esc(NN(o.nurse_id).full_name)}`:'<span class="mut">—</span>'}</td>
    <td><span class="badge ${OSTB[o.status]}">${OST[o.status]}</span>${o.needs_dispatcher&&o.status==='nowe'?' <span class="badge b-bad">dyspozytor</span>':''}${o.status==='zaproponowane'?`<br><small class="mut">na przyjęcie: <span data-exp="${o.expires_at}"></span></small>`:''}</td>
    <td class="small">${money2(o.price_travel)} / ${money2(o.payout_travel)} / <b>${money2(o.margin)}</b>${o.zone_no?`<br><span class="mut">strefa ${o.zone_no} · ${o.distance_km} km</span>`:''}</td>
    <td style="white-space:nowrap">${o.status==='nowe'?`<button class="btn sm pri" onclick="dispatchModal('${o.id}')">Przydziel</button>`:''}${o.status==='przyjete'?`<button class="btn sm" onclick="advOrder('${o.id}','w_drodze')">W drodze</button>`:''}${['przyjete','w_drodze'].includes(o.status)?`<button class="btn sm" onclick="advOrder('${o.id}','wykonane')">Wykonane</button>`:''}${o.status==='wykonane'?`<button class="btn sm pri" onclick="advOrder('${o.id}','rozliczone')">Rozlicz</button>`:''}<button class="btn sm" onclick="orderInfo('${o.id}')">Historia</button></td></tr>`).join('')||'<tr><td colspan="8"><div class="empty">Brak zleceń</div></td></tr>'}</table></div></div>`;
}
const advOrder=(id,st)=>nsafe(async()=>chk(await sb.rpc('advance_order',{p_order:id,p_status:st})),'Status: '+OST[st]);
function orderInfo(id){
  const o=NZ.D.orders.find(x=>x.id===id),at=NZ.D.attempts.filter(a=>a.order_id===id).sort((a,b)=>a.proposed_at.localeCompare(b.proposed_at));
  modal(`Zlecenie #${o.number}`,`<dl class="kv"><dt>Klient</dt><dd>${esc(o.client_name)} ${esc(o.client_phone)}</dd><dt>Adres</dt><dd>${esc(o.address)}</dd><dt>Usługa</dt><dd>${esc(SV(o.service_id).name)}</dd><dt>Termin</dt><dd>${fDT(o.start_at)}</dd>
    <dt>Badanie</dt><dd>${o.price_service!=null?money(o.price_service):'wg cennika'}</dd><dt>Dojazd</dt><dd>${money2(o.price_travel)}${o.zone_no?` (strefa ${o.zone_no}, ${o.distance_km} km)`:''}</dd><dt>Wypłata / marża</dt><dd>${money2(o.payout_travel)} / ${money2(o.margin)}</dd></dl>
    <div class="nzlbl">Historia przydziału</div>${at.map(a=>`<div class="dl"><div class="when">${fDT(a.proposed_at).slice(11)}</div><div class="what">${nChip(a.nurse_id)} ${esc(NN(a.nurse_id).full_name)}<small>${{regula:'wg reguły',odleglosc:'najbliższa (odległość)',dyspozytor:'dyspozytor'}[a.via]}</small></div><span class="badge">${esc(a.result.replace('_',' '))}</span></div>`).join('')||'<div class="mut small">brak</div>'}`,{ok:null,cancel:'Zamknij'});
}
async function dispatchModal(id){
  const o=NZ.D.orders.find(x=>x.id===id);const r=await sb.rpc('order_candidates',{p_order:id});if(r.error)return toast(errMsg(r.error),true);
  const c=r.data||[];
  modal(`Przydziel zlecenie #${o.number}`,`<p class="small mut" style="margin-bottom:10px">${fDT(o.start_at)} · ${esc(o.address)} · ${esc(SV(o.service_id).name)}</p>
    ${c.length?c.map(x=>`<label class="nzrow" style="cursor:pointer"><input type="radio" name="n" value="${x.nurse_id}" required>${nAv(NN(x.nurse_id),28)}<div class="who"><b>${esc(NN(x.nurse_id).full_name)}</b><small>${x.distance_km} km od punktu bazowego${x.attempted?' · wcześniej: '+esc(x.attempted.replace(/_/g,' ')):''}</small></div></label>`).join(''):'<div class="note">Nikt nie przechodzi twardych filtrów (obszar, wolny termin, usługa, limit dzienny). Zmień termin albo dodaj klienta do listy oczekujących.</div>'}
    <p class="hint">Przydział ręczny też wymaga akceptacji pielęgniarki (limit czasu jak w regule).</p>`,
  {ok:c.length?'Wyślij propozycję':null,onOk:v=>nact(async()=>chk(await sb.rpc('dispatch_order',{p_order:id,p_nurse:v.n})),'Wysłano propozycję')});
}
function exportOrdersCsv(){
  const rows=[['numer','termin','klient','adres','usluga','pielegniarka','status','strefa','km','dojazd_klient','dojazd_pielegniarka','marza']].concat(NZ.D.orders.map(o=>[o.number,fDT(o.start_at),o.client_name,o.address,SV(o.service_id).name,o.nurse_id?NN(o.nurse_id).full_name:'',OST[o.status],o.zone_no??'',o.distance_km??'',o.price_travel??'',o.payout_travel??'',o.margin??'']));
  const csv=rows.map(r=>r.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(';')).join('\n'),a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv'}));a.download='zlecenia-pielegniarki.csv';a.click();
  sb.rpc('log_event',{p_action:'eksport.raport',p_target:'zlecenia pielęgniarek',p_details:rows.length-1+' wierszy'});
}
/* --- nowe zlecenie: adres → badanie → wolne terminy i cena → przydział --- */
function orderModal(pre={}){
  const svs=NZ.D.services.filter(s=>s.active);
  modal('Nowe zlecenie',`<div class="form"><label>Klient<input class="f" name="client" required minlength="3" value="${esc(pre.client_name||'')}"></label><label>Telefon<input class="f" name="phone" value="${esc(pre.client_phone||'')}"></label>
    <label class="full">Adres wizyty<span style="display:flex;gap:6px"><input class="f" name="addr" id="oaddr" required value="${esc(pre.address||'')}" placeholder="ul. Puławska 10, Warszawa"><button type="button" class="btn" id="ogeo">Znajdź</button></span></label>
    <div class="full" id="ogeores"></div>
    <label>Szer. geogr.<input class="f" name="lat" id="olat" required value="${pre.lat??''}"></label><label>Dł. geogr.<input class="f" name="lng" id="olng" required value="${pre.lng??''}"></label><label>Miasto<input class="f" name="city" id="ocity" value="${esc(pre.city||'')}"></label>
    <label>Badanie<select class="f" name="svc" id="osvc" required>${svs.map(s=>`<option value="${s.id}" ${s.id===pre.service_id?'selected':''}>${esc(s.name)} (${s.duration_min} min)</option>`).join('')}</select></label>
    <label class="full">Uwagi<input class="f" name="note"></label></div>
    <div style="margin-top:12px"><button type="button" class="btn" id="oslots">Pokaż wolne terminy</button></div><div id="oout" style="margin-top:12px"></div><input type="hidden" name="start" id="ostart">`,
  {ok:'Zamów wizytę',wide:true,onOk:async v=>{
    if(!v.start){toast('Wybierz termin',true);return false}
    const id=await nact(async()=>chk(await sb.rpc('create_nurse_order',{p:{client_name:v.client.trim(),client_phone:v.phone.trim(),address:v.addr.trim(),lat:+v.lat,lng:+v.lng,city:v.city.trim(),service_id:v.svc,start_at:v.start,note:v.note||'',road_km:NZ.road||{},price_travel:v.manual?+v.manual:null}})),'Zlecenie utworzone');
    if(pre.waitId)await sb.from('nurse_waitlist').update({resolved_at:new Date().toISOString()}).eq('id',pre.waitId);
    const o=NZ.D.orders.find(x=>x.id===id);if(o)toast(o.status==='zaproponowane'?`#${o.number}: propozycja dla ${NN(o.nurse_id).full_name}`:`#${o.number}: czeka na dyspozytora`);
  }});
  NZ.road={};
  $('#ogeo').onclick=async()=>{const q=$('#oaddr').value.trim();if(q.length<4)return;$('#ogeores').innerHTML='<span class="mut small">Szukam…</span>';
    try{const r=await geocode(q);$('#ogeores').innerHTML=r.length?r.map((x,i)=>`<button type="button" class="chip" data-i="${i}" style="margin:0 6px 6px 0">${esc(x.label.slice(0,90))}</button>`).join(''):'<span class="mut small">Nie znaleziono — wpisz współrzędne ręcznie.</span>';
      $$('#ogeores [data-i]').forEach(b=>b.onclick=()=>{const x=r[+b.dataset.i];$('#olat').value=x.lat.toFixed(6);$('#olng').value=x.lng.toFixed(6);$('#ocity').value=x.city;$('#ogeores').innerHTML=`<span class="small" style="color:var(--good)">✓ ${esc(x.label)}</span>`})}
    catch(e){$('#ogeores').innerHTML=`<span class="small" style="color:var(--bad)">Wyszukiwanie adresu niedostępne (${esc(e.message)}) — wpisz współrzędne ręcznie.</span>`}};
  $('#oslots').onclick=()=>showSlots(pre);
}
async function showSlots(pre){
  const lat=+$('#olat').value,lng=+$('#olng').value,svc=$('#osvc').value,city=$('#ocity').value.trim(),out=$('#oout');$('#ostart').value='';
  if(!lat||!lng||!svc)return toast('Podaj adres (współrzędne) i badanie',true);
  out.innerHTML='<span class="mut small">Sprawdzam obszary i terminarze…</span>';
  const q=road=>sb.rpc('nurse_slots',{p_lat:lat,p_lng:lng,p_service:svc,p_city:city||null,p_road:road||{}});
  let r=await q();if(r.error)return out.innerHTML=`<div class="note">${esc(errMsg(r.error))}</div>`;
  NZ.road={};
  if(NZ.D.cfg.distance_mode==='roads'&&r.data.length){try{NZ.road=await roadKm(lat,lng,[...new Set(r.data.map(x=>x.nurse_id))]);r=await q(NZ.road)}catch(e){toast('Odległość po drogach niedostępna — użyto linii prostej',true)}}
  const sl=r.data||[];
  if(!sl.length){out.innerHTML=`<div class="note"><b>Brak wolnych terminów w okolicy.</b> Adres nie leży w obszarze żadnej aktywnej pielęgniarki wykonującej to badanie albo wszystkie okna są zajęte.</div><button type="button" class="btn" style="margin-top:8px" id="owait">Dodaj do listy oczekujących</button>`;
    $('#owait').onclick=()=>{const f=$('#mform');waitAdd({client_name:f.client.value,client_phone:f.phone.value,address:f.addr.value,lat,lng,city,service_id:svc})};return}
  const by={};sl.forEach(s=>{const k=s.slot_start;(by[k]=by[k]||[]).push(s)});
  const days={};Object.keys(by).sort().forEach(k=>{const d=iso(new Date(k));(days[d]=days[d]||[]).push(k)});
  const sv=SV(svc),ct=Object.keys(by).length;
  out.innerHTML=`<p class="small" style="color:var(--good)">W okolicy są dostępne pielęgniarki (${new Set(sl.map(s=>s.nurse_id)).size}). Wybierz termin (${ct}):</p>`+Object.entries(days).map(([d,ks])=>`<div class="nzlbl">${fDay(parseD(d))}</div><div class="nzslots">${ks.map(k=>`<button type="button" class="nzslot" data-k="${k}">${new Date(k).getHours()}:${pad(new Date(k).getMinutes())}</button>`).join('')}</div>`).join('')+'<div id="oprice"></div>';
  $$('#oout .nzslot').forEach(b=>b.onclick=()=>{$$('#oout .nzslot').forEach(x=>x.classList.remove('on'));b.classList.add('on');$('#ostart').value=b.dataset.k;
    const c=by[b.dataset.k],pr=c.map(x=>x.price_travel).filter(x=>x!=null),pt=pr.length?Math.min(...pr):null,z=c.find(x=>x.price_travel===pt)||c[0];
    $('#oprice').innerHTML=`<div class="card" style="margin-top:10px;background:var(--bg2)"><div class="res"><div class="sub"><span>Badanie</span><b>${sv.price!=null?money(sv.price):'wg cennika'}</b></div>
      <div class="sub"><span>Dojazd${pt!=null?` (strefa ${z.zone_no}, ${z.distance_km} km)`:''}</span><b>${pt!=null?money(pt):`<input class="f" name="manual" type="number" min="0" step="1" required placeholder="wycena indywidualna" style="width:170px">`}</b></div>
      <div class="sub"><span>Razem</span><b>${sv.price!=null&&pt!=null?money(+sv.price+ +pt):(sv.price!=null?money(sv.price)+' + dojazd':'badanie + '+(pt!=null?money(pt):'dojazd'))}</b></div></div>
      <p class="hint">Dostępne w tym terminie: ${c.map(x=>nChip(x.nurse_id)).join(' ')}. Kto dostanie zlecenie, wybiera reguła przydziału; pielęgniarka musi je przyjąć.</p></div>`});
}

/* --- lista oczekujących --- */
function waitAdd(p){closeModal();nsafe(async()=>chk(await sb.from('nurse_waitlist').insert({client_name:p.client_name||'—',client_phone:p.client_phone||'',address:p.address||'—',lat:p.lat||null,lng:p.lng||null,city:p.city||'',service_id:p.service_id||null})),'Dodano do listy oczekujących')}
function waitView(){
  const L=NZ.D.waitlist.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at));
  return `<div class="ph"><div><h1>Lista oczekujących</h1><p>Klienci bez pokrycia w okolicy. Na mapie: warstwa „Białe plamy”.</p></div></div><div class="card"><div class="tw"><table><tr><th>Zgłoszono</th><th>Klient</th><th>Adres</th><th>Usługa</th><th>Powód</th><th>Status</th><th></th></tr>
  ${L.map(w=>`<tr style="${w.resolved_at?'opacity:.5':''}"><td>${fDT(w.created_at)}</td><td>${esc(w.client_name)}<br><small class="mut">${esc(w.client_phone)}</small></td><td>${esc(w.address)}</td><td>${esc(SV(w.service_id).name)}</td><td>${esc(w.reason)}</td><td>${w.resolved_at?'<span class="badge b-good">obsłużone</span>':'<span class="badge b-warn">czeka</span>'}</td>
    <td style="white-space:nowrap">${w.resolved_at?'':`<button class="btn sm pri" onclick="orderModal(Object.assign(NZ.D.waitlist.find(x=>x.id==='${w.id}'),{waitId:'${w.id}'}))">Utwórz zlecenie</button><button class="btn sm" onclick="nsafe(async()=>chk(await sb.from('nurse_waitlist').update({resolved_at:new Date().toISOString()}).eq('id','${w.id}')),'Zamknięto')">Zamknij</button>`}</td></tr>`).join('')||'<tr><td colspan="7"><div class="empty">Brak oczekujących</div></td></tr>'}</table></div></div>`;
}

/* --- dostępność zbiorcza w mieście / dzielnicy --- */
function cityAvailView(){
  const cities=[...new Set([...NZ.D.districts.map(d=>d.city),...NZ.D.nurses.map(n=>n.city)].filter(Boolean))];
  const city=NZ.av?.city||cities[0]||'',dist=NZ.av?.dist||'',ds=distOf(city),d=ds.find(x=>x.name===dist);
  const ns=NZ.D.nurses.filter(n=>n.status==='aktywna'&&(d?d.c&&covers(n.id,d.c[0],d.c[1]):(approvedArea(n.id)?.shapes||[]).some(s=>(s.city||'').toLowerCase()===city.toLowerCase())||n.city===city));
  const m=monday(NZ.week),days=[...Array(7)].map((_,i)=>addDays(m,i));
  return `<div class="ph"><div><h1>Dostępność zbiorcza</h1><p>Suma okien pielęgniarek, które obejmują ten obszar — tak widzi to admin, a klient dostaje z tego listę terminów.</p></div></div>
  <div class="toolbar"><select class="f" onchange="NZ.av={city:this.value,dist:''};rerender()">${cities.map(c=>`<option ${c===city?'selected':''}>${esc(c)}</option>`).join('')}</select><select class="f" onchange="NZ.av={city:'${esc(city)}',dist:this.value};rerender()"><option value="">Całe miasto</option>${ds.map(x=>`<option ${x.name===dist?'selected':''}>${esc(x.name)}</option>`).join('')}</select>
    <button class="btn sm" onclick="NZ.week--;rerender()">‹</button><b>${fD(iso(m))} – ${fD(iso(days[6]))}</b><button class="btn sm" onclick="NZ.week++;rerender()">›</button></div>
  <div class="card"><div class="grid" style="grid-template-columns:repeat(7,minmax(0,1fr));gap:8px">${days.map(day=>{const who=ns.map(n=>({n,p:dayPlan(n.id,day,{pending:false})})).filter(x=>x.p.win.length&&!x.p.exc.some(e=>e.from===0&&e.to===1440));
    return `<div style="border:1px solid var(--line);border-radius:10px;padding:10px;min-height:120px;background:${who.length?'color-mix(in srgb,var(--good) 8%,var(--bg2))':'color-mix(in srgb,var(--bad) 8%,var(--bg2))'}"><b>${DOWS[isoDow(day)]} ${pad(day.getDate())}.${pad(day.getMonth()+1)}</b><div class="small ${who.length?'':'st-overdue'}" style="margin:4px 0">${who.length?who.length+' os.':'brak'}</div>
      ${who.map(x=>`<div class="small">${nChip(x.n.id)} ${x.p.win.map(b=>hm(b.from)+'–'+hm(b.to)).join(', ')}</div>`).join('')}</div>`}).join('')}</div>
    <p class="hint">Obszar: ${d?`dzielnica ${esc(d.name)} (pielęgniarki, których zatwierdzony obszar obejmuje środek dzielnicy)`:`całe miasto ${esc(city)}`}. Dni „brak” to dziury w grafiku — wiadomo, gdzie szukać kolejnych osób. Wizyty i limity sprawdza baza przy wyborze konkretnego terminu.</p></div>`;
}

/* =====================================================================
   USTAWIENIA: mapa, reguły ogólne, usługi, cenniki stref, dzielnice
   ===================================================================== */
function settingsView(){
  const c=NZ.D.cfg,cities=[...new Set([...NZ.D.zones.filter(z=>z.city).map(z=>z.city),...NZ.D.nurses.map(n=>n.city)].filter(Boolean))],zc=NZ.zcity||cities[0]||'';
  const zs=NZ.D.zones.filter(z=>z.city&&z.city.toLowerCase()===zc.toLowerCase()).sort((a,b)=>a.zone_no-b.zone_no);
  const dc={};NZ.D.districts.forEach(d=>dc[d.city]=(dc[d.city]||0)+1);
  const sel=(k,opts)=>`<select class="f" name="${k}">${opts.map(([v,l])=>`<option value="${v}" ${String(c[k])===String(v)?'selected':''}>${l}</option>`).join('')}</select>`;
  return `<div class="grid g2" style="align-items:start"><div class="card"><h3>Ustawienia ogólne</h3><form id="nzcfg" class="form">
    <label>Mapa${sel('map_provider',[['leaflet','Leaflet + OpenStreetMap (bez kosztów API)'],['google','Google Maps (klucz API)']])}</label><label>Klucz Google Maps (przeglądarkowy)<input class="f" name="google_key" value="${esc(c.google_key||'')}" placeholder="AIza…"></label>
    <label>Nakładające się obszary — decyduje${sel('overlap_mode',[['rule','reguła przydziału'],['distance','odległość (najbliższa pielęgniarka)']])}</label>
    <label>Odległość do stref${sel('distance_mode',[['straight','w linii prostej (prościej)'],['roads','po drogach (dokładniej, wolniej)']])}</label>
    <label>Maks. liczba wizyt dziennie<input class="f" type="number" name="max_visits_per_day" min="1" max="50" value="${c.max_visits_per_day}"></label><label>Bufor na dojazd (min)<input class="f" type="number" name="travel_buffer_min" min="0" max="240" value="${c.travel_buffer_min}"></label>
    <label>Limit czasu na przyjęcie (min)<input class="f" type="number" name="accept_timeout_min" min="1" max="240" value="${c.accept_timeout_min}"></label><label>Siatka terminów${sel('slot_step_min',[[10,'co 10 min'],[15,'co 15 min'],[20,'co 20 min'],[30,'co 30 min'],[60,'co godzinę']])}</label>
    <label>Horyzont terminów (dni)<input class="f" type="number" name="horizon_days" min="1" max="90" value="${c.horizon_days}"></label>
    <div class="full mfoot" style="margin-top:0"><button class="btn pri">Zapisz ustawienia</button></div></form>
    <p class="hint">Pielęgniarka zawsze musi zaakceptować zlecenie. Limit dzienny z puli reguły ma pierwszeństwo przed ogólnym. Odległość po drogach: Google Distance Matrix (z kluczem) albo publiczny serwer OSRM (OpenStreetMap; serwer demonstracyjny, bez gwarancji dostępności). Klucz Google ogranicz w Google Cloud do domeny lexsalus.github.io.</p></div>
  <div class="card"><h3>Usługi (badania) <button class="btn sm pri" onclick="serviceModal()">+ Usługa</button></h3><div class="tw"><table><tr><th>Nazwa</th><th>Czas</th><th>Bufor</th><th>Cena</th><th>Kwalifikacje</th><th></th></tr>
    ${NZ.D.services.map(s=>`<tr style="${s.active?'':'opacity:.5'}"><td><b>${esc(s.name)}</b></td><td>${s.duration_min} min</td><td>${s.buffer_min} min</td><td>${s.price!=null?money(s.price):'wg cennika'}</td><td class="small">${esc(s.qualifications)}</td><td><button class="btn sm" onclick="serviceModal('${s.id}')">Edytuj</button></td></tr>`).join('')||'<tr><td colspan="6" class="mut">Brak usług</td></tr>'}</table></div></div></div>
  <div class="grid g2" style="align-items:start;margin-top:14px"><div class="card"><h3>Cennik stref: szablon dla miasta <select class="f" style="width:auto" onchange="NZ.zcity=this.value;rerender()">${cities.map(x=>`<option ${x===zc?'selected':''}>${esc(x)}</option>`).join('')}</select></h3>
    ${zc?`<form id="nzzones"><div class="tw"><table><tr><th>Strefa</th><th>Od km</th><th>Do km</th><th>Klient</th><th>Pielęg.</th><th>Marża</th><th></th></tr>${zs.map((z,i)=>zoneRow(z,i)).join('')}${zoneRow({zone_no:zs.length+1,km_from:zs.length?zs[zs.length-1].km_to:0,km_to:''},zs.length,true)}</table></div>
    <div class="mfoot"><button class="btn pri">Zapisz cennik</button></div></form>`:'<div class="mut">Dodaj pielęgniarkę z miastem, aby ustawić jego cennik.</div>'}
    <p class="hint">Każda strefa ma dwie kwoty: cenę dla klienta i wypłatę dla pielęgniarki; marża liczy się sama. Szablon można nadpisać dla konkretnej pielęgniarki (karta → Stawki). Poza ostatnią strefą: wycena indywidualna przy zleceniu.</p></div>
  <div class="card"><h3>Granice dzielnic <span style="display:flex;gap:6px"><button class="btn sm" onclick="districtImport()">Importuj z OpenStreetMap</button><a class="btn sm" href="#/pielegniarki/dzielnica">Narysuj</a></span></h3>
    ${Object.keys(dc).length?Object.entries(dc).map(([cty,n])=>`<div class="dl"><div class="what"><b>${esc(cty)}</b><small>${n} dzielnic: ${esc(distOf(cty).map(d=>d.name).join(', '))}</small></div><button class="btn sm del" onclick="districtDelCity('${esc(cty)}')">Usuń</button></div>`).join(''):'<div class="mut">Brak — zaimportuj granice dzielnic (np. 18 dzielnic Warszawy).</div>'}
    <p class="hint">Dzielnice służą do zaznaczania obszaru kliknięciem, do warstwy „Białe plamy” i reguł przydziału per dzielnica. Import pobiera granice administracyjne z OpenStreetMap (© współtwórcy OSM).</p></div></div>`;
}
const zoneRow=(z,i,isNew)=>`<tr><td><input class="f" type="number" name="no_${i}" value="${z.zone_no}" style="width:56px"><input type="hidden" name="id_${i}" value="${z.id||''}"></td><td><input class="f" type="number" step="0.1" name="kf_${i}" value="${z.km_from??''}" style="width:72px"></td><td><input class="f" type="number" step="0.1" name="kt_${i}" value="${z.km_to??''}" style="width:72px" ${isNew?'placeholder="nowa"':''}></td>
  <td><input class="f" type="number" min="0" name="pc_${i}" value="${z.price_client??''}" style="width:80px"></td><td><input class="f" type="number" min="0" name="po_${i}" value="${z.payout??''}" style="width:80px"></td><td><b>${z.price_client!=null?money(z.price_client-z.payout):''}</b></td><td>${z.id?`<button type="button" class="btn sm del" onclick="nsafe(async()=>chk(await sb.from('price_zones').delete().eq('id','${z.id}')),'Usunięto strefę')">✕</button>`:''}</td></tr>`;
{const after=ROUTES.pielegniarki.after;ROUTES.pielegniarki.after=(sub,id)=>{after(sub,id);if(sub!=='ustawienia'||!NZ.D)return;
  const f=$('#nzcfg');if(f)f.onsubmit=e=>{e.preventDefault();const v=Object.fromEntries(new FormData(f));
    if(v.map_provider==='google'&&!v.google_key.trim())return toast('Google Maps wymaga klucza API',true);
    nsafe(async()=>chk(await sb.from('nurse_settings').update({map_provider:v.map_provider,google_key:v.google_key.trim(),overlap_mode:v.overlap_mode,distance_mode:v.distance_mode,max_visits_per_day:+v.max_visits_per_day,travel_buffer_min:+v.travel_buffer_min,accept_timeout_min:+v.accept_timeout_min,slot_step_min:+v.slot_step_min,horizon_days:+v.horizon_days,updated_at:new Date().toISOString()}).eq('id',1)),'Zapisano ustawienia')};
  const z=$('#nzzones');if(z)z.onsubmit=e=>{e.preventDefault();const v=Object.fromEntries(new FormData(z)),city=NZ.zcity||$('#nzzones').closest('.card').querySelector('select').value,rows=[];
    for(let i=0;v['no_'+i]!==undefined;i++){if(v['kt_'+i]===''&&!v['id_'+i])continue;rows.push({id:v['id_'+i]||undefined,city,zone_no:+v['no_'+i],km_from:+v['kf_'+i],km_to:+v['kt_'+i],price_client:+v['pc_'+i],payout:+v['po_'+i]})}
    nsafe(async()=>{for(const r of rows){if(r.id)chk(await sb.from('price_zones').update(r).eq('id',r.id));else{delete r.id;chk(await sb.from('price_zones').insert(r))}}},'Zapisano cennik')};
}}
function serviceModal(id){
  const s=id?SV(id):{name:'',duration_min:15,buffer_min:0,qualifications:'',price:null,active:true};
  modal(id?'Usługa':'Nowa usługa',`<div class="form"><label class="full">Nazwa<input class="f" name="name" required value="${esc(s.name)}" placeholder="np. Morfologia + CRP"></label><label>Czas trwania (min)<input class="f" type="number" name="d" min="5" value="${s.duration_min}"></label><label>Bufor po wizycie (min)<input class="f" type="number" name="b" min="0" value="${s.buffer_min}"></label>
    <label>Cena badania (puste = wg cennika)<input class="f" type="number" name="p" min="0" step="0.01" value="${s.price??''}"></label><label class="full">Wymagane kwalifikacje<input class="f" name="q" value="${esc(s.qualifications)}"></label><label class="chk"><input type="checkbox" name="a" ${s.active?'checked':''}>Aktywna</label></div>`,
  {onOk:v=>nact(async()=>{const r={name:v.name.trim(),duration_min:+v.d,buffer_min:+v.b,price:v.p===''?null:+v.p,qualifications:v.q||'',active:!!v.a};chk(id?await sb.from('nurse_services').update(r).eq('id',id):await sb.from('nurse_services').insert(r))},'Zapisano usługę')});
}
/* --- dzielnice: import z OpenStreetMap (Overpass) albo rysowanie --- */
function districtImport(){
  modal('Import granic dzielnic z OpenStreetMap',`<div class="form"><label>Miasto<input class="f" name="city" required placeholder="np. Warszawa"></label><label>Poziom podziału<select class="f" name="lvl"><option value="9">9 — dzielnice (np. 18 dzielnic Warszawy)</option><option value="10">10 — osiedla / obręby</option><option value="11">11 — osiedla (np. Poznań)</option><option value="8">8 — gminy (okolice miasta)</option></select></label></div>
    <p class="hint">Dane pobierane z publicznego API Overpass (OpenStreetMap). Istniejące dzielnice o tych samych nazwach zostaną nadpisane.</p><div id="dimp"></div>`,
  {ok:'Importuj',onOk:async v=>{
    const box=$('#dimp');box.innerHTML='<span class="mut small">Pobieram granice…</span>';
    const q=`[out:json][timeout:90];area["name"="${v.city.trim().replace(/"/g,'')}"]["boundary"="administrative"]["admin_level"~"^(6|7|8)$"]->.a;rel(area.a)["boundary"="administrative"]["admin_level"="${v.lvl}"];out geom;`;
    let js;try{js=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:'data='+encodeURIComponent(q),headers:{'Content-Type':'application/x-www-form-urlencoded'}}).then(r=>r.json())}catch(e){box.innerHTML=`<div class="note">Nie udało się pobrać danych z OpenStreetMap: ${esc(e.message)}</div>`;return false}
    const rows=(js.elements||[]).filter(e=>e.type==='relation'&&e.tags?.name).map(e=>({city:v.city.trim(),name:e.tags.name.replace(/^(Dzielnica|Osiedle)\s+/i,''),source:'osm',
      rings:stitch(e.members.filter(m=>m.type==='way'&&m.geometry).map(m=>m.geometry.map(p=>[+p.lat.toFixed(5),+p.lon.toFixed(5)]))).map(thin).filter(r=>r.length>=4)})).filter(r=>r.rings.length);
    if(!rows.length){box.innerHTML='<div class="note">Brak granic na tym poziomie dla podanego miasta. Spróbuj innego poziomu.</div>';return false}
    await nact(async()=>chk(await sb.from('districts').upsert(rows,{onConflict:'city,name'})),`Zaimportowano ${rows.length} dzielnic`);
  }});
}
function stitch(ways){
  const same=(a,b)=>a&&b&&a[0]===b[0]&&a[1]===b[1],pool=ways.map(w=>w.slice()),rings=[];
  while(pool.length){let r=pool.shift(),g=0;
    while(!same(r[0],r[r.length-1])&&g++<5000){const end=r[r.length-1],i=pool.findIndex(w=>same(w[0],end)||same(w[w.length-1],end));if(i<0)break;const w=pool.splice(i,1)[0];r=r.concat(same(w[0],end)?w.slice(1):w.slice().reverse().slice(1))}
    rings.push(r)}
  return rings;
}
function thin(r){const out=[r[0]];for(let i=1;i<r.length;i++){const p=out[out.length-1];if(Math.abs(r[i][0]-p[0])+Math.abs(r[i][1]-p[1])>0.0003||i===r.length-1)out.push(r[i])}return out}
const districtDelCity=c=>{if(confirm(`Usunąć granice dzielnic: ${c}? Obszary oparte na dzielnicach tego miasta przestaną działać.`))nsafe(async()=>{for(const d of distOf(c))chk(await sb.from('districts').delete().eq('id',d.id))},'Usunięto')};
function districtEditor(){
  NZ.de=NZ.de||{pts:[],city:'',name:''};
  return `<div class="ph"><div><h1>Narysuj dzielnicę</h1><p>Klikaj na mapie, aby wyznaczyć granicę.</p></div><a class="btn" href="#/pielegniarki/ustawienia">← Ustawienia</a></div>
  <div class="grid" style="grid-template-columns:minmax(0,1fr) 300px;align-items:start"><div class="nzmap sm" id="nzdemap"></div><div class="card"><div class="form" style="grid-template-columns:1fr"><label>Miasto<input class="f" id="decity" value="${esc(NZ.de.city)}"></label><label>Nazwa dzielnicy<input class="f" id="dename" value="${esc(NZ.de.name)}"></label></div>
    <p class="small mut" style="margin-top:10px">Punkty: <b id="depts">${NZ.de.pts.length}</b></p><div class="mfoot"><button class="btn" onclick="NZ.de.pts.pop();deDraw()">Cofnij</button><button class="btn pri" onclick="deSave()">Zapisz</button></div></div></div>`;
}
async function mountDistrictEditor(){NZ.map?.destroy?.();NZ.map=await makeMap($('#nzdemap'),{view:NZ.view,onMove:v=>NZ.view=v,onClick:(a,o)=>{NZ.de.pts.push([+a.toFixed(5),+o.toFixed(5)]);deDraw()}});deDraw(!NZ.view)}
function deDraw(fit){const M=NZ.map;if(!M)return;M.clear();NZ.D.districts.forEach(d=>M.poly(d.rings,{color:'#64748b',fill:.05,weight:1,interactive:false,title:d.name}));if(NZ.de.pts.length>2)M.poly([NZ.de.pts],{color:'#7c5cff',fill:.3,interactive:false});else if(NZ.de.pts.length)M.line(NZ.de.pts,{});const p=$('#depts');if(p)p.textContent=NZ.de.pts.length;if(fit)M.fit(NZ.D.districts.map(d=>d.c).filter(Boolean))}
function deSave(){const city=$('#decity').value.trim(),name=$('#dename').value.trim();if(!city||!name||NZ.de.pts.length<3)return toast('Podaj miasto, nazwę i co najmniej 3 punkty',true);
  nsafe(async()=>chk(await sb.from('districts').upsert({city,name,rings:[NZ.de.pts],source:'reczne'},{onConflict:'city,name'})),'Zapisano dzielnicę').then(()=>{NZ.de=null;location.hash='#/pielegniarki/ustawienia'})}

/* =====================================================================
   PANEL PIELĘGNIARKI (rola „Pielęgniarka”)
   ===================================================================== */
function nurseView(sub){
  const n=NZ.D.me;
  if(!n)return `<div class="ph"><div><h1>Panel pielęgniarki</h1></div></div><div class="note">Twoje konto nie jest jeszcze powiązane z kartą pielęgniarki. Poproś Administratora o powiązanie (Pielęgniarki → karta → Dane i usługi → Konto).</div>`;
  const tabs=`<div class="tabs">${NZ_NTABS.map(([k,l])=>`<a class="tab ${k===sub?'on':''}" href="#/pielegniarki${k?'/'+k:''}">${l}${k===''&&NZ.D.myOrders.filter(o=>o.status==='zaproponowane').length?` <span class="badge b-bad">${NZ.D.myOrders.filter(o=>o.status==='zaproponowane').length}</span>`:''}</a>`).join('')}</div>`;
  const head=`<div class="ph"><div><h1 style="display:flex;gap:10px;align-items:center">${nAv(n,36)} ${esc(n.full_name)} <span class="badge ${NSTB[n.status]}">${NST[n.status]}</span></h1><p>${esc(n.city)} · ${esc(areaTxt(n.id))}</p></div></div>`;
  if(sub==='obszar')return tabs+areaEditor(n.id);
  if(sub==='terminarz')return head+tabs+`<div class="grid" style="grid-template-columns:minmax(0,1fr) 340px;align-items:start"><div class="card">${weekGrid(n.id)}</div><div class="card">${patternsBlock(n.id)}</div></div>`;
  if(sub==='stawki')return head+tabs+`<div class="card" style="max-width:620px"><h3>Moje stawki za dojazd</h3><div class="tw"><table><tr><th>Strefa</th><th>Odległość od punktu bazowego</th><th>Wypłata</th></tr>${NZ.D.myRates.map(z=>`<tr><td>${z.zone_no}</td><td>${z.km_from}–${z.km_to} km</td><td><b>${money(z.payout)}</b></td></tr>`).join('')||'<tr><td colspan="3" class="mut">Brak cennika — skontaktuj się z Administratorem.</td></tr>'}</table></div>
    <p class="hint">Punkt bazowy: ${esc(n.base_label||'—')}. Kwota zapisuje się w zleceniu w chwili przydziału.</p></div>`;
  const P=NZ.D.myOrders.filter(o=>o.status==='zaproponowane'),A=NZ.D.myOrders.filter(o=>['przyjete','w_drodze'].includes(o.status)),D=NZ.D.myOrders.filter(o=>['wykonane','rozliczone'].includes(o.status)).slice(-10).reverse();
  const card=(o,act)=>`<div class="entry" style="border-left:3px solid ${o.status==='zaproponowane'?'var(--warn)':'var(--accent)'}"><div class="eh"><b>#${o.number} · ${esc(o.service)} · ${fSlot(o.start_at)}</b><span class="badge ${OSTB[o.status]}">${OST[o.status]}</span></div>
    <div class="small" style="margin-top:4px">${esc(o.address)}${o.status!=='zaproponowane'?' · '+esc(o.client_name)+' '+esc(o.client_phone):''}</div>
    <div class="small mut">${o.zone_no?`Strefa ${o.zone_no} (${o.distance_km} km) · dojazd: ${money(o.payout_travel)}`:''}${o.note?' · '+esc(o.note):''}</div>${act}</div>`;
  return head+tabs+`<div class="grid g2" style="align-items:start"><div><h3 style="margin-bottom:10px">Do akceptacji</h3>${P.map(o=>card(o,`<div class="ea"><button class="btn pri sm" onclick="nsafe(async()=>chk(await sb.rpc('respond_order',{p_order:'${o.id}',p_accept:true})),'Zlecenie przyjęte')">Przyjmij</button><button class="btn sm del" onclick="if(confirm('Odrzucić? Zlecenie trafi do następnej osoby.'))nsafe(async()=>chk(await sb.rpc('respond_order',{p_order:'${o.id}',p_accept:false})),'Odrzucono')">Odrzuć</button><span class="small mut" style="align-self:center">pozostało <b data-exp="${o.expires_at}"></b></span></div>`)).join('')||'<div class="empty">Brak nowych propozycji</div>'}
      <h3 style="margin:16px 0 10px">Ostatnio wykonane</h3>${D.map(o=>card(o,'')).join('')||'<div class="mut small">—</div>'}</div>
    <div><h3 style="margin-bottom:10px">Zaplanowane wizyty</h3>${A.map(o=>card(o,`<div class="ea">${o.status==='przyjete'?`<button class="btn sm" onclick="advOrder('${o.id}','w_drodze')">W drodze</button>`:''}<button class="btn sm pri" onclick="advOrder('${o.id}','wykonane')">Wykonane</button><a class="btn sm" target="_blank" href="https://www.openstreetmap.org/?mlat=${o.lat}&mlon=${o.lng}#map=17/${o.lat}/${o.lng}">Mapa</a></div>`)).join('')||'<div class="empty">Brak zaplanowanych wizyt</div>'}</div></div>
    <p class="hint">Każde zlecenie trzeba przyjąć w wyznaczonym czasie — po nim trafia do następnej osoby. Widzisz tylko własne zlecenia.</p>`;
}
/* licznik w menu: zmiany do zatwierdzenia + zlecenia czekające na dyspozytora / na moją akceptację */
function nzBadge(){
  if(!NZ.D)return 0;
  if(isNurse())return NZ.D.myOrders.filter(o=>o.status==='zaproponowane').length;
  return NZ.D.orders.filter(o=>o.status==='nowe'&&o.needs_dispatcher).length+NZ.D.nurses.reduce((s,n)=>s+pendingFor(n.id),0);
}
