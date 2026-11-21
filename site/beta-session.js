/* Browser-only Access session adapter for a separate, protected beta hostname.
 * Loaded by beta-edge-worker.mjs HTML rewrite, NOT by public sample staging.
 * No JWT, cookie value, Supercell key or internal token is read by JavaScript.
 */
(function(root){
  "use strict";
  var enabled=!!(root.document&&root.document.querySelector('meta[name="crc-mode"][content="private-beta"]'));
  if(!enabled)return;

  function permittedPath(value){
    if(typeof value!=="string"||value[0]!=="/"||value.startsWith("//"))return false;
    try{
      var url=new URL(value,root.location.origin);
      if(url.origin!==root.location.origin||url.hash)return false;
      if(url.pathname==="/api/v1/health/ready"&&url.search==="")return true;
      if(url.pathname==="/api/v1/capabilities"&&url.search==="")return true;
      if(url.pathname==="/api/v1/catalog/cards"&&url.search==="")return true;
      if(/^\/api\/v1\/players\/%23[A-Z0-9]{3,16}\/snapshot$/.test(url.pathname)&&
         (url.search===""||url.search==="?limit=25"))return true;
      // Legacy normalized routes may not be enabled on beta; do not
      // accidentally turn the browser into a generic HTTP proxy.
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
      if(!permittedPath(path))return blockedResponse("BETA_ROUTE_DENIED",403);
      if(options&&options.method&&options.method.toUpperCase()!=="GET")
        return blockedResponse("BETA_METHOD_DENIED",405);
      var response;
      try{
        response=await fetchFn(path,{
          method:"GET",headers:{"Accept":"application/json"},
          credentials:"same-origin",cache:"no-store",redirect:"manual"
        });
      }catch(e){
        return blockedResponse("BETA_NETWORK_UNAVAILABLE",503);
      }
      if(!response||response.type==="opaqueredirect"||response.status===0||
         (response.status>=300&&response.status<400))
        return blockedResponse("ACCESS_LOGIN_REQUIRED",401);
      var contentType=response.headers&&response.headers.get("content-type")||"";
      if(response.ok&&!contentType.toLowerCase().includes("application/json"))
        return blockedResponse("ACCESS_LOGIN_REQUIRED",401);
      return response;
    };
  }
  var transport=createTransport(root.fetch.bind(root));
  function signInAgain(){
    // Only a direct user click should call this: a full top-level navigation
    // lets Access handle its login session without exposing its cookie to JS.
    root.location.reload();
  }
  root.CRCBetaSession=Object.freeze({
    VERSION:"access-cookie-0.1",
    enabled:true,
    fetch:transport,
    createTransport:createTransport,
    permittedPath:permittedPath,
    signInAgain:signInAgain
  });
})(typeof window!=="undefined"?window:globalThis);
