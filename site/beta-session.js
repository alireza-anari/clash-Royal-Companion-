/* Browser adapter for invite-code sessions. The HttpOnly cookie and signing keys
 * are never visible to JavaScript. Only the edge can mint backend assertions. */
(function(root){
  "use strict";
  var enabled=!!(root.document&&root.document.querySelector('meta[name="crc-mode"][content="private-beta"]'));
  if(!enabled)return;
  function permittedPath(value,method="GET"){
    if(typeof value!=="string"||value[0]!=="/"||value.startsWith("//"))return false;
    try{
      var url=new URL(value,root.location.origin);
      if(url.origin!==root.location.origin||url.hash)return false;
      if(method==="POST")return ["/api/v1/coach/chat","/api/v1/vision/jobs"].includes(url.pathname)&&url.search==="";
      if(method==="DELETE")return /^\/api\/v1\/vision\/jobs\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(url.pathname)&&url.search==="";
      if(method!=="GET")return false;
      if(url.pathname==="/api/v1/vision/capabilities"&&url.search==="")return true;
      if(/^\/api\/v1\/vision\/jobs\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(url.pathname)&&url.search==="")return true;
      if(url.pathname==="/api/v1/health/ready"&&url.search==="")return true;
      if(url.pathname==="/api/v1/capabilities"&&url.search==="")return true;
      if(url.pathname==="/api/v1/catalog/cards"&&url.search==="")return true;
      if(/^\/api\/v1\/players\/%23[A-Z0-9]{3,16}\/snapshot$/.test(url.pathname)&&
         (url.search===""||url.search==="?limit=25"))return true;
      return false;
    }catch(e){return false;}
  }
  function blockedResponse(code,status){
    return new Response(JSON.stringify({error:{code:code}}),{
      status:status||403,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
    });
  }
  function createTransport(fetchFn){
    return async function(path,options){
      var method=options&&options.method?String(options.method).toUpperCase():"GET";
      if(!["GET","POST","DELETE"].includes(method))return blockedResponse("BETA_METHOD_DENIED",405);
      if(!permittedPath(path,method))return blockedResponse("BETA_ROUTE_DENIED",403);
      var headers={"Accept":"application/json"},body;
      if(method==="POST"){
        body=options&&options.body;
        var max=path==="/api/v1/vision/jobs"?3*1024*1024:4096;
        if(typeof body!=="string"||body.length>max)return blockedResponse("INVALID_INPUT",422);
        try{
          var parsed=JSON.parse(body);
          if(parsed.consent_to_external_ai!==true)return blockedResponse("AI_CONSENT_REQUIRED",403);
          if(path==="/api/v1/vision/jobs"&&parsed.consent_to_upload!==true)return blockedResponse("VISION_CONSENT_REQUIRED",403);
        }catch(e){return blockedResponse("INVALID_INPUT",422);}
        headers["Content-Type"]="application/json";
      }
      try{
        return await fetchFn(path,{method,headers,body,credentials:"same-origin",cache:"no-store",redirect:"manual"});
      }catch(e){return blockedResponse("BETA_NETWORK_UNAVAILABLE",503);}
    };
  }
  var transport=createTransport(root.fetch.bind(root));
  async function signOut(){
    try{await root.fetch("/api/v1/auth/logout",{method:"POST",credentials:"same-origin",
      headers:{"Accept":"application/json"},cache:"no-store"});}catch(e){}
    root.location.assign("/login");
  }
  function signInAgain(){root.location.assign("/login");}
  root.CRCBetaSession=Object.freeze({
    VERSION:"automatic-session-0.2",enabled:true,fetch:transport,
    createTransport:createTransport,permittedPath:permittedPath,
    signInAgain:signInAgain,signOut:signOut
  });
})(typeof window!=="undefined"?window:globalThis);
