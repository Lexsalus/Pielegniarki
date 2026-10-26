// Nakładka testowa: udaje window.supabase (supabase-js) i kieruje zapytania do lokalnego PGlite
(function(){
const API='http://localhost:9900';
const st=JSON.parse(sessionStorage.getItem('shim')||'{"user":null,"aal":"aal1","factors":{}}');
const saveSt=()=>sessionStorage.setItem('shim',JSON.stringify(st));
const factors=()=>JSON.parse(localStorage.getItem('shim_factors')||'{}');const saveF=f=>localStorage.setItem('shim_factors',JSON.stringify(f));
const post=(u,b)=>fetch(API+u,{method:'POST',body:JSON.stringify(b)}).then(r=>r.json());
const q=b=>post('/q',{...b,sub:st.user?.id||null,aal:st.aal});
class B{constructor(t){this.b={table:t,filters:[],op:'select'}}
  select(){if(this.b.op==='select')this.b.op='select';else this.b.returning=true;return this}
  eq(c,v){this.b.filters.push(['eq',c,v]);return this} is(c,v){this.b.filters.push(['is',c,v]);return this}
  order(c,o){this.b.order=[c,o?.ascending!==false];return this} limit(n){this.b.limit=n;return this}
  single(){this.b.single=true;return this}
  insert(v){this.b.op='insert';this.b.values=v;return this} update(v){this.b.op='update';this.b.values=v;return this}
  upsert(v,o){this.b.op='upsert';this.b.values=v;if(o?.onConflict)this.b.onConflict=o.onConflict;return this} delete(){this.b.op='delete';return this}
  then(res,rej){return q(this.b).then(r=>{if(r.error)return {data:null,error:r.error};let d=r.data;if(this.b.single)d=Array.isArray(d)?d[0]??null:d;if(this.b.op!=='select'&&!this.b.returning)d=null;return {data:d,error:null}}).then(res,rej)}}
window.supabase={createClient(){
  const listeners=[];
  return {
    from:t=>new B(t),
    rpc:(name,args)=>q({kind:'rpc',name,args}).then(r=>r.error?{data:null,error:r.error}:{data:r.data,error:null}),
    storage:{from:bucket=>({upload:(path,file)=>q({kind:'storage',bucket,path}).then(r=>r.error?{data:null,error:r.error}:{data:r.data,error:null}),
      createSignedUrl:(path)=>Promise.resolve({data:{signedUrl:'about:blank#'+encodeURIComponent(path)},error:null})})},
    auth:{
      async signInWithPassword({email,password}){const r=await post('/login',{email,password});if(r.error)return {error:r.error};st.user=r.data;st.aal='aal1';saveSt();return {data:{user:r.data},error:null}},
      async getUser(){return {data:{user:st.user}}},async getSession(){return {data:{session:st.user?{user:st.user}:null}}},
      async signOut(){st.user=null;st.aal='aal1';saveSt();return {}},onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},
      async resetPasswordForEmail(){return {}},async updateUser(){return {}},
      mfa:{
        async getAuthenticatorAssuranceLevel(){return {data:{currentLevel:st.aal,nextLevel:factors()[st.user?.id]?'aal2':'aal1'}}},
        async listFactors(){const f=factors()[st.user?.id];return {data:{totp:f&&f.verified?[{id:f.id,status:'verified'}]:[],all:f?[{id:f.id,factor_type:'totp',status:f.verified?'verified':'unverified'}]:[]}}},
        async enroll(){const f=factors();f[st.user.id]={id:'f-'+st.user.id,verified:false};saveF(f);return {data:{id:'f-'+st.user.id,totp:{qr_code:'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',secret:'JBSWY3DPEHPK3PXP'}},error:null}},
        async challengeAndVerify({code}){if(code!=='123456')return {error:{message:'Invalid TOTP code entered'}};const f=factors();f[st.user.id].verified=true;saveF(f);st.aal='aal2';saveSt();return {data:{},error:null}},
        async unenroll(){return {}}}}
  }}};
})();
