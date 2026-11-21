/**
 * CRC private-beta edge: source-only, NOT DEPLOYED.
 *
 * Requires:
 *  - a distinct Access-protected hostname (no unprotected alternate routes);
 *  - Workers VPC Service binding PRIVATE_API pinned to one private origin;
 *  - static ASSETS binding, worker-first routing;
 *  - backend JWT verification + PostgreSQL quota (beta_gateway.py).
 * Never deploy this module to the public sample-only staging Worker.
 */
const TAG = /^#[A-Z0-9]{3,16}$/;
const HOST = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/;
const API_PREFIX = "/api/v1/";
const MAX_JSON_BYTES = 512 * 1024;
const HTML_ANCHOR = '<script src="/app.js" defer></script>';

function json(status, code) {
  return new Response(JSON.stringify({error:{code,message:"درخواست قابل انجام نیست."}}),{
    status,headers:{"Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
      "Referrer-Policy":"no-referrer","X-Robots-Tag":"noindex, nofollow"}
  });
}
function privateHost(value,allowWorkersDev=false){
  if(typeof value!=="string")return null;
  const h=value.trim().toLowerCase();
  if(!HOST.test(h)||!h.includes(".")||h.startsWith(".")||h.includes(".."))
    return null;
  // A protected production workers.dev hostname is supported by Access,
  // allowing a private MVP without purchasing a domain. It is opt-in ONLY.
  // Never reuse our public sample Worker's hostname.
  if(h.endsWith(".workers.dev")){
    if(!allowWorkersDev||! /^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(h))
      return null;
    if(["crc-mvp-stage-20261120.alirezaanari117.workers.dev","crc-coach-ci-stage-20261121.alirezaanari117.workers.dev"].includes(h))
      return null;
  }
  return h;
}
function apiRoute(url,method="GET"){
  if(method==="POST")return url.pathname==="/api/v1/coach/chat"&&url.search===""?url.pathname:null;
  if(method!=="GET")return null;
  // Authenticated operational probe, never an unauthenticated liveness route.
  if(url.pathname==="/api/v1/health/ready"&&url.search==="")
    return url.pathname;
  if(url.pathname==="/api/v1/capabilities"&&url.search==="")
    return url.pathname;
  if(url.pathname==="/api/v1/catalog/cards"&&url.search==="")
    return url.pathname;
  const match=/^\/api\/v1\/players\/([^/]+)\/snapshot$/.exec(url.pathname);
  if(!match)return null;
  let tag;
  try{tag=decodeURIComponent(match[1]).toUpperCase();}
  catch(e){return null;}
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
async function boundedJson(response,maxBytes=MAX_JSON_BYTES){
  const length=response.headers.get("Content-Length");
  if(length!==null&&Number(length)>maxBytes)return null;
  if(!response.headers.get("Content-Type")?.toLowerCase().includes("application/json"))
    return null;
  if(!response.body)return null;
  const reader=response.body.getReader();
  const parts=[];
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
async function routeRequest(request,env){
  let url;
  try{url=new URL(request.url);}catch(e){return json(400,"INVALID_REQUEST");}
  const expected=privateHost(env?.BETA_HOSTNAME,env?.BETA_ALLOW_WORKERS_DEV==="true");
  if(env?.BETA_ENABLED!=="true"||!expected)return json(503,"BETA_NOT_CONFIGURED");
  if(url.protocol!=="https:"||url.hostname.toLowerCase()!==expected||url.port)
    return json(400,"UNTRUSTED_HOST");
  const api=url.pathname==="/api"||url.pathname.startsWith("/api/");
  if(!["GET","HEAD"].includes(request.method)&&!(request.method==="POST"&&url.pathname==="/api/v1/coach/chat"))return json(405,"METHOD_NOT_ALLOWED");
  // Cloudflare Access must protect the entire beta hostname. Even static
  // assets fail closed if its assertion is missing; backend validates the
  // cryptographic signature, not this syntactic edge check.
  const jwt=request.headers.get("Cf-Access-Jwt-Assertion");
  if(!jwt||jwt.length>8192)return json(401,"ACCESS_TOKEN_MISSING");
  if(api){
    if(!["GET","POST"].includes(request.method))return json(405,"METHOD_NOT_ALLOWED");
    const route=apiRoute(url,request.method);
    if(!route)return json(404,"NOT_FOUND");
    if(request.headers.get("Origin")&&request.headers.get("Origin")!=="https://"+expected)
      return json(403,"CROSS_ORIGIN_DENIED");
    if(request.headers.get("Sec-Fetch-Site")==="cross-site")
      return json(403,"CROSS_ORIGIN_DENIED");
    // Access authenticates the browser before this Worker runs. Backend MUST
    // independently verify this signed assertion; mere header presence is not auth.
    if(!env.PRIVATE_API||typeof env.PRIVATE_API.fetch!=="function")
      return json(503,"PRIVATE_ORIGIN_NOT_BOUND");
    const headers=new Headers({Accept:"application/json",
      "Cf-Access-Jwt-Assertion":jwt});
    // VPC Service routing is pinned to its registered host/port regardless of
    // this URL. Build a deterministic Host and path; never use user-supplied
    // target URLs, Authorization, Cookies, or forwarded identity headers.
    let bodyForOrigin;
    if(request.method==="POST"){
      if(env.BETA_AI_CHAT_ENABLED!=="true")return json(503,"AI_COACH_DISABLED");
      if(request.headers.get("Origin")!=="https://"+expected)return json(403,"CROSS_ORIGIN_DENIED");
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
    // Redirects from the private origin are not part of this API contract.
    if(result.status>=300&&result.status<400)return json(502,"PRIVATE_ORIGIN_REDIRECT_DENIED");
    const allowedStatus=result.status>=200&&result.status<=599?result.status:502;
    const safeHeaders=new Headers({
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
      "X-Robots-Tag":"noindex, nofollow",
      "Referrer-Policy":"no-referrer","X-Frame-Options":"DENY",
      "Cross-Origin-Resource-Policy":"same-origin"
    });
    const retry=result.headers.get("Retry-After");
    if(allowedStatus===429&&retry&&/^\d{1,5}$/.test(retry)&&Number(retry)<=86400)
      safeHeaders.set("Retry-After",retry);
    return new Response(body,{status:allowedStatus,headers:safeHeaders});
  }
  if(!env.ASSETS||typeof env.ASSETS.fetch!=="function")
    return json(503,"STATIC_ASSETS_NOT_BOUND");
  if(url.pathname==="/sw.js")return new Response(null,{status:410,headers:{"Cache-Control":"no-store"}});
  let staticResponse;
  try{staticResponse=await env.ASSETS.fetch(request);}
  catch(e){return json(503,"STATIC_ASSETS_UNAVAILABLE");}
  if((url.pathname==="/"||url.pathname==="/index.html")&&staticResponse.ok){
    const html=await staticResponse.text();
    if(!html.includes(HTML_ANCHOR))return json(503,"BETA_ENTRYPOINT_MISSING");
    const adapted=html.replace('<link rel="manifest" href="/manifest.webmanifest">',"")
      .replace(HTML_ANCHOR,
      '<script src="/beta-session.js" defer></script>\n'+HTML_ANCHOR)
      .replace("</head>",'<meta name="crc-mode" content="private-beta"></head>')
      .replace("اتصال خودکار به Supercell هنوز فعال نیست؛ می‌توانی JSON پروفایل خودت را فقط در مرورگر وارد کنی.",
        "در بتای خصوصی، اتصال بازیکن فقط پس از احراز هویت Cloudflare Access و آماده‌بودن Backend فعال می‌شود؛ واردکردن محلی JSON نیز در دسترس است.");
    return new Response(adapted,{status:200,headers:{
      "Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store",
      "Content-Security-Policy":"default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src https://fonts.gstatic.com; img-src 'self' https://api-assets.clashroyale.com; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
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
export {apiRoute,privateHost,routeRequest};
export default {fetch:routeRequest};
