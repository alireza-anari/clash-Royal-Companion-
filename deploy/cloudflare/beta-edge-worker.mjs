/**
 * CRC private-beta edge: invite-code auth, short-lived signed assertions, private VPC origin.
 *
 * No Cloudflare Access subscription or payment method is required by this path.
 * Every beta asset/API request requires a valid HttpOnly session cookie. The
 * Worker signs a short-lived HS256 assertion for the backend; the backend
 * independently verifies it before quota reservation or any upstream request.
 *
 * Required secrets/vars are documented in docs/PRIVATE_BETA_DEPLOYMENT_SP_BETA_05.md.
 * This source is NOT deployed by the public sample-only staging workflow.
 */
const TAG = /^#[A-Z0-9]{3,16}$/;
const HOST = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/;
const API_PREFIX = "/api/v1/";
const MAX_JSON_BYTES = 512 * 1024;
const COOKIE_NAME = "__Host-crc_beta_session";
const SESSION_TTL = 8 * 60 * 60;
const ASSERTION_TTL = 60;
const HTML_ANCHOR = '<script src="/app.js" defer></script>';
const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HEX_KEY = /^(?:[a-f0-9]{2}){32}$/;
const HEX_HASH = /^[a-f0-9]{64}$/;

function json(status, code, extra={}) {
  return new Response(JSON.stringify({error:{code,message:"درخواست قابل انجام نیست."},...extra}),{
    status,headers:{"Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
      "Referrer-Policy":"no-referrer","X-Robots-Tag":"noindex, nofollow"}
  });
}
function privateHost(value,allowWorkersDev=false){
  if(typeof value!=="string")return null;
  const h=value.trim().toLowerCase();
  if(!HOST.test(h)||!h.includes(".")||h.startsWith(".")||h.includes(".."))return null;
  if(h.endsWith(".workers.dev")){
    if(!allowWorkersDev||! /^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(h))return null;
    if(["crc-mvp-stage-20261120.alirezaanari117.workers.dev",
        "crc-coach-ci-stage-20261121.alirezaanari117.workers.dev"].includes(h))return null;
  }
  return h;
}
function apiRoute(url,method="GET"){
  if(method==="POST")return url.pathname==="/api/v1/coach/chat"&&url.search===""?url.pathname:null;
  if(method!=="GET")return null;
  if(url.pathname==="/api/v1/health/ready"&&url.search==="")return url.pathname;
  if(url.pathname==="/api/v1/capabilities"&&url.search==="")return url.pathname;
  if(url.pathname==="/api/v1/catalog/cards"&&url.search==="")return url.pathname;
  const match=/^\/api\/v1\/players\/([^/]+)\/snapshot$/.exec(url.pathname);
  if(!match)return null;
  let tag;
  try{tag=decodeURIComponent(match[1]).toUpperCase();}catch(e){return null;}
  if(!TAG.test(tag))return null;
  if([...url.searchParams.keys()].some(k=>k!=="limit")||url.searchParams.getAll("limit").length>1)return null;
  let limit=25;
  if(url.searchParams.has("limit")){
    const raw=url.searchParams.get("limit");
    if(!/^(?:[1-9]|1\d|2[0-5])$/.test(raw))return null;
    limit=Number(raw);
  }
  return "/api/v1/players/"+encodeURIComponent(tag)+"/snapshot?limit="+limit;
}
function hexBytes(value){
  if(typeof value!=="string"||!HEX_KEY.test(value))return null;
  const bytes=new Uint8Array(value.length/2);
  for(let i=0;i<bytes.length;i++)bytes[i]=parseInt(value.slice(i*2,i*2+2),16);
  return bytes;
}
function b64url(bytes){
  let binary="";
  for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
}
function b64urlText(value){return b64url(new TextEncoder().encode(value));}
function decodeB64url(value){
  if(typeof value!=="string"||!/^[A-Za-z0-9_-]+$/.test(value))return null;
  try{
    const normalized=value.replace(/-/g,"+").replace(/_/g,"/");
    const binary=atob(normalized+"=".repeat((4-normalized.length%4)%4));
    return Uint8Array.from(binary,c=>c.charCodeAt(0));
  }catch(e){return null;}
}
async function hmac(secret, input, usage){
  const key=await crypto.subtle.importKey("raw",secret,{name:"HMAC",hash:"SHA-256"},false,usage);
  return key;
}
async function signJwt(secret,claims){
  const head=b64urlText(JSON.stringify({alg:"HS256",typ:"JWT"}));
  const body=b64urlText(JSON.stringify(claims));
  const signingInput=head+"."+body;
  const key=await hmac(secret,signingInput,["sign"]);
  const signature=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(signingInput)));
  return signingInput+"."+b64url(signature);
}
async function verifyJwt(secret,token,{issuer,audience,maxTtl}){
  if(typeof token!=="string"||token.length>4096)return null;
  const parts=token.split(".");
  if(parts.length!==3)return null;
  const headerBytes=decodeB64url(parts[0]),payloadBytes=decodeB64url(parts[1]),signature=decodeB64url(parts[2]);
  if(!headerBytes||!payloadBytes||!signature||signature.length!==32)return null;
  let header,claims;
  try{
    header=JSON.parse(new TextDecoder().decode(headerBytes));
    claims=JSON.parse(new TextDecoder().decode(payloadBytes));
  }catch(e){return null;}
  if(!header||header.alg!=="HS256"||header.typ!=="JWT"||Object.keys(header).length!==2)return null;
  const signingInput=parts[0]+"."+parts[1];
  const key=await hmac(secret,signingInput,["verify"]);
  const valid=await crypto.subtle.verify("HMAC",key,signature,new TextEncoder().encode(signingInput));
  if(!valid||!claims||typeof claims!=="object")return null;
  const now=Math.floor(Date.now()/1000);
  if(claims.iss!==issuer||claims.aud!==audience||
     typeof claims.sub!=="string"||!SUBJECT.test(claims.sub)||
     !Number.isSafeInteger(claims.iat)||!Number.isSafeInteger(claims.exp)||
     claims.iat>now+15||claims.exp<=now||claims.exp<=claims.iat||
     claims.exp-claims.iat>maxTtl||
     typeof claims.jti!=="string"||!/^[A-Za-z0-9_-]{16,128}$/.test(claims.jti))return null;
  return claims;
}
function authConfig(env,expected){
  const sessionSecret=hexBytes(env?.BETA_SESSION_HMAC_HEX);
  const assertionSecret=hexBytes(env?.BETA_ASSERTION_HMAC_HEX);
  const issuer=env?.BETA_AUTH_ISSUER;
  const audience=env?.BETA_AUTH_AUDIENCE;
  if(!sessionSecret||!assertionSecret||
     env.BETA_SESSION_HMAC_HEX===env.BETA_ASSERTION_HMAC_HEX||
     issuer!=="https://"+expected||
     typeof audience!=="string"||audience.length<8||audience.length>256)return null;
  let invites;
  try{invites=JSON.parse(env.BETA_INVITE_CODES_JSON||"");}catch(e){return null;}
  if(!invites||typeof invites!=="object"||Array.isArray(invites)||Object.keys(invites).length<1||Object.keys(invites).length>1000)return null;
  for(const [hash,subject] of Object.entries(invites)){
    if(!HEX_HASH.test(hash)||typeof subject!=="string"||!SUBJECT.test(subject))return null;
  }
  return {sessionSecret,assertionSecret,issuer,audience,invites};
}
function cookieValue(request){
  const raw=request.headers.get("Cookie")||"";
  if(raw.length>8192)return null;
  const values=raw.split(";").map(x=>x.trim()).filter(x=>x.startsWith(COOKIE_NAME+"="));
  if(values.length!==1)return null;
  const value=values[0].slice(COOKIE_NAME.length+1);
  return value.length>4096?null:value;
}
async function currentSession(request,config){
  const token=cookieValue(request);
  if(!token)return null;
  const claims=await verifyJwt(config.sessionSecret,token,{
    issuer:config.issuer,audience:"crc-beta-session",maxTtl:SESSION_TTL
  });
  return claims?{subject:claims.sub}:null;
}
async function inviteSubject(code,config){
  if(typeof code!=="string"||code.length<32||code.length>128)return null;
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(code)));
  const hash=Array.from(digest,b=>b.toString(16).padStart(2,"0")).join("");
  return config.invites[hash]||null;
}
function cookieHeader(token,maxAge=SESSION_TTL){
  return COOKIE_NAME+"="+token+"; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age="+maxAge;
}
function sameOrigin(request,expected){
  return request.headers.get("Origin")==="https://"+expected&&
    request.headers.get("Sec-Fetch-Site")!=="cross-site";
}
async function handleLogin(request,env,expected,config){
  if(request.method!=="POST")return json(405,"METHOD_NOT_ALLOWED");
  if(!sameOrigin(request,expected))return json(403,"CROSS_ORIGIN_DENIED");
  if(!request.headers.get("Content-Type")?.toLowerCase().includes("application/json"))
    return json(415,"UNSUPPORTED_MEDIA_TYPE");
  const body=await boundedJson(request,1024).catch(()=>null);
  if(body===null)return json(422,"INVALID_INPUT");
  let payload;
  try{payload=JSON.parse(new TextDecoder().decode(body));}catch(e){return json(422,"INVALID_INPUT");}
  if(!payload||Object.keys(payload).some(k=>k!=="invite_code"))return json(422,"INVALID_INPUT");
  const subject=await inviteSubject(payload.invite_code,config);
  if(!subject)return json(401,"INVITE_CODE_INVALID");
  const now=Math.floor(Date.now()/1000);
  const token=await signJwt(config.sessionSecret,{
    iss:config.issuer,aud:"crc-beta-session",sub:subject,
    iat:now,exp:now+SESSION_TTL,jti:crypto.randomUUID()
  });
  return new Response(JSON.stringify({authenticated:true}),{
    status:200,headers:{
      "Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",
      "Set-Cookie":cookieHeader(token),"X-Content-Type-Options":"nosniff",
      "Referrer-Policy":"no-referrer"
    }
  });
}
async function makeAssertion(session,config){
  const now=Math.floor(Date.now()/1000);
  return signJwt(config.assertionSecret,{
    iss:config.issuer,aud:config.audience,sub:session.subject,
    iat:now,exp:now+ASSERTION_TTL,jti:crypto.randomUUID()
  });
}
async function boundedJson(response,maxBytes=MAX_JSON_BYTES){
  const length=response.headers.get("Content-Length");
  if(length!==null&&Number(length)>maxBytes)return null;
  if(!response.headers.get("Content-Type")?.toLowerCase().includes("application/json"))return null;
  if(!response.body)return null;
  const reader=response.body.getReader(),parts=[];
  let total=0;
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>maxBytes){await reader.cancel();return null;}
      parts.push(value);
    }
  }finally{reader.releaseLock();}
  const body=new Uint8Array(total);let offset=0;
  for(const part of parts){body.set(part,offset);offset+=part.byteLength;}
  try{JSON.parse(new TextDecoder().decode(body));}catch(e){return null;}
  return body;
}
async function serveLoginAsset(path,request,env){
  if(!env.ASSETS||typeof env.ASSETS.fetch!=="function")return json(503,"STATIC_ASSETS_NOT_BOUND");
  try{
    const asset=await env.ASSETS.fetch(new Request(new URL(path,request.url),{method:"GET"}));
    if(!asset.ok)return json(503,"LOGIN_ASSET_UNAVAILABLE");
    const headers=new Headers({
      "Content-Type":path.endsWith(".js")?"application/javascript; charset=utf-8":"text/html; charset=utf-8",
      "Cache-Control":"no-store","Content-Security-Policy":"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY",
      "X-Robots-Tag":"noindex, nofollow","Referrer-Policy":"no-referrer"
    });
    return new Response(asset.body,{status:200,headers});
  }catch(e){return json(503,"LOGIN_ASSET_UNAVAILABLE");}
}
async function routeRequest(request,env){
  let url;
  try{url=new URL(request.url);}catch(e){return json(400,"INVALID_REQUEST");}
  const expected=privateHost(env?.BETA_HOSTNAME,env?.BETA_ALLOW_WORKERS_DEV==="true");
  if(env?.BETA_ENABLED!=="true"||!expected)return json(503,"BETA_NOT_CONFIGURED");
  if(url.protocol!=="https:"||url.hostname.toLowerCase()!==expected||url.port)return json(400,"UNTRUSTED_HOST");
  const config=authConfig(env,expected);
  if(!config)return json(503,"BETA_AUTH_NOT_CONFIGURED");
  const api=url.pathname==="/api"||url.pathname.startsWith("/api/");
  if(!["GET","HEAD"].includes(request.method)&&
     !(request.method==="POST"&&["/api/v1/auth/login","/api/v1/auth/logout","/api/v1/coach/chat"].includes(url.pathname)))
    return json(405,"METHOD_NOT_ALLOWED");

  if(request.method==="POST"&&url.pathname==="/api/v1/auth/login")
    return handleLogin(request,env,expected,config);
  if(request.method==="GET"&&url.pathname==="/login")
    return serveLoginAsset("/beta-login.html",request,env);
  if(request.method==="GET"&&url.pathname==="/beta-login.js")
    return serveLoginAsset("/beta-login.js",request,env);

  const session=await currentSession(request,config);
  if(!session){
    if(api)return json(401,"INVITE_SESSION_REQUIRED");
    if(url.pathname==="/sw.js")return new Response(null,{status:410,headers:{"Cache-Control":"no-store"}});
    return Response.redirect("https://"+expected+"/login",303);
  }

  if(request.method==="POST"&&url.pathname==="/api/v1/auth/logout"){
    if(!sameOrigin(request,expected))return json(403,"CROSS_ORIGIN_DENIED");
    return new Response(JSON.stringify({authenticated:false}),{
      status:200,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",
        "Set-Cookie":cookieHeader("",0),"X-Content-Type-Options":"nosniff"}
    });
  }
  if(request.method==="GET"&&url.pathname==="/api/v1/auth/session")
    return new Response(JSON.stringify({authenticated:true}),{
      status:200,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
    });

  if(api){
    if(!["GET","POST"].includes(request.method))return json(405,"METHOD_NOT_ALLOWED");
    const route=apiRoute(url,request.method);
    if(!route)return json(404,"NOT_FOUND");
    if(request.headers.get("Origin")&&request.headers.get("Origin")!=="https://"+expected)
      return json(403,"CROSS_ORIGIN_DENIED");
    if(request.headers.get("Sec-Fetch-Site")==="cross-site")return json(403,"CROSS_ORIGIN_DENIED");
    if(!env.PRIVATE_API||typeof env.PRIVATE_API.fetch!=="function")return json(503,"PRIVATE_ORIGIN_NOT_BOUND");
    const assertion=await makeAssertion(session,config);
    const headers=new Headers({Accept:"application/json","X-CRC-Worker-Assertion":assertion});
    let bodyForOrigin;
    if(request.method==="POST"){
      if(env.BETA_AI_CHAT_ENABLED!=="true")return json(503,"AI_COACH_DISABLED");
      if(!sameOrigin(request,expected))return json(403,"CROSS_ORIGIN_DENIED");
      bodyForOrigin=await boundedJson(request,4096).catch(()=>null);
      if(bodyForOrigin===null)return json(422,"INVALID_INPUT");
      const parsed=JSON.parse(new TextDecoder().decode(bodyForOrigin));
      if(!parsed||parsed.consent_to_external_ai!==true)return json(403,"AI_CONSENT_REQUIRED");
      headers.set("Content-Type","application/json");
      headers.set("Origin","https://"+expected);
    }
    const target="http://"+expected+route;
    let result;
    try{
      result=await env.PRIVATE_API.fetch(new Request(target,{
        method:request.method,headers,body:bodyForOrigin,redirect:"manual",cache:"no-store"
      }));
    }catch(e){return json(503,"PRIVATE_ORIGIN_UNAVAILABLE");}
    const body=await boundedJson(result).catch(()=>null);
    if(body===null)return json(502,"PRIVATE_ORIGIN_INVALID_RESPONSE");
    if(result.status>=300&&result.status<400)return json(502,"PRIVATE_ORIGIN_REDIRECT_DENIED");
    const allowedStatus=result.status>=200&&result.status<=599?result.status:502;
    const safeHeaders=new Headers({
      "Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",
      "X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex, nofollow",
      "Referrer-Policy":"no-referrer","X-Frame-Options":"DENY",
      "Cross-Origin-Resource-Policy":"same-origin"
    });
    const retry=result.headers.get("Retry-After");
    if(allowedStatus===429&&retry&&/^\d{1,5}$/.test(retry)&&Number(retry)<=86400)
      safeHeaders.set("Retry-After",retry);
    return new Response(body,{status:allowedStatus,headers:safeHeaders});
  }

  if(!env.ASSETS||typeof env.ASSETS.fetch!=="function")return json(503,"STATIC_ASSETS_NOT_BOUND");
  if(url.pathname==="/sw.js")return new Response(null,{status:410,headers:{"Cache-Control":"no-store"}});
  let staticResponse;
  try{staticResponse=await env.ASSETS.fetch(request);}catch(e){return json(503,"STATIC_ASSETS_UNAVAILABLE");}
  if((url.pathname==="/"||url.pathname==="/index.html")&&staticResponse.ok){
    const html=await staticResponse.text();
    if(!html.includes(HTML_ANCHOR))return json(503,"BETA_ENTRYPOINT_MISSING");
    const adapted=html.replace('<link rel="manifest" href="/manifest.webmanifest">',"")
      .replace(HTML_ANCHOR,'<script src="/beta-session.js" defer></script>\n'+HTML_ANCHOR)
      .replace("</head>",'<meta name="crc-mode" content="private-beta"></head>')
      .replace("اتصال خودکار به Supercell هنوز فعال نیست؛ می‌توانی JSON پروفایل خودت را فقط در مرورگر وارد کنی.",
        "در بتای خصوصی، ورود با کد دعوت انجام می‌شود و اتصال زنده فقط پس از آماده‌شدن Backend فعال خواهد شد؛ ورود محلی JSON نیز در دسترس است.");
    return new Response(adapted,{status:200,headers:{
      "Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store",
      "Content-Security-Policy":"default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src https://fonts.gstatic.com; img-src 'self' https://api-assets.clashroyale.com; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY",
      "X-Robots-Tag":"noindex, nofollow","Referrer-Policy":"no-referrer"
    }});
  }
  const headers=new Headers(staticResponse.headers);
  headers.set("Cache-Control","no-store");
  headers.set("X-Robots-Tag","noindex, nofollow");
  headers.set("X-Content-Type-Options","nosniff");
  return new Response(staticResponse.body,{status:staticResponse.status,headers});
}
export {apiRoute,privateHost,routeRequest,verifyJwt,signJwt,authConfig};
export default {fetch:routeRequest};
