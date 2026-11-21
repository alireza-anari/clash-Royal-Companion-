var CARD_LIBRARY=JSON.parse(CATALOG_JSON);
var LIBRARY_MAP=new Map(CARD_LIBRARY.cards.map(function(c){return [c.id,c]}));
function respond(content,type,status){
  return new Response(content,{status:status||200,headers:{
  "Content-Type":type,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer","X-Robots-Tag":"noindex, nofollow",
  "Cross-Origin-Resource-Policy":"same-origin"}});
}
function jsonResponse(obj,status){return respond(JSON.stringify(obj),"application/json; charset=utf-8",status);}
function error(code,message,status){return jsonResponse({error:{code:code,message:message},mode:"sample-only",supercell_live:false},status||400);}
function factsFor(ids){
 if(!Array.isArray(ids)||ids.length!==8||ids.some(function(x){return !Number.isSafeInteger(x);})||new Set(ids).size!==8)return {status:422,error:"دک باید دقیقاً ۸ کارت یکتا داشته باشد.",code:"INVALID_DECK"};
 var chosen=ids.map(function(id){return LIBRARY_MAP.get(id);});
 if(chosen.some(function(c){return !c||c.type==="support";}))return {status:422,error:"یک یا چند کارت ناشناخته یا نامعتبر است.",code:"UNKNOWN_CARD"};
 var costs=chosen.map(function(c){return c.elixir;});
 var missing=chosen.filter(function(c){return !Number.isInteger(c.elixir)||c.elixir<0;}).map(function(c){return c.id;});
 if(missing.length)return {status:200,facts:{average_elixir:null,cycle_cost_four_cheapest:null,unknown_card_ids:missing,expensive_cards_count:null,cheap_cards_count:null},valid:true};
 var cycle=costs.slice().sort(function(a,b){return a-b;}).slice(0,4).reduce(function(a,b){return a+b;},0);
 return {status:200,valid:true,facts:{average_elixir:costs.reduce(function(a,b){return a+b;},0)/8,cycle_cost_four_cheapest:cycle,unknown_card_ids:[],expensive_cards_count:costs.filter(function(x){return x>=5;}).length,cheap_cards_count:costs.filter(function(x){return x<=2;}).length}};
}
async function serve(request){
  var url=new URL(request.url),path=url.pathname;
  if(request.method==="GET"&&path==="/")return new Response(HTML,{status:200,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","X-Frame-Options":"DENY","Content-Security-Policy":"default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src https://fonts.gstatic.com; img-src 'self' https://api-assets.clashroyale.com; worker-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"}});
  if(request.method==="GET"&&path==="/styles.css")return respond(CSS,"text/css; charset=utf-8");
  if(request.method==="GET"&&path==="/app.js")return respond(APP,"application/javascript; charset=utf-8");
  if(request.method==="GET"&&path==="/battle-insights.js")return respond(BATTLE_INSIGHTS,"application/javascript; charset=utf-8");
  if(request.method==="GET"&&path==="/offline-coach.js")return respond(OFFLINE_COACH,"application/javascript; charset=utf-8");
  if(request.method==="GET"&&path==="/coach-chat.js")return respond(COACH_CHAT,"application/javascript; charset=utf-8");
  if(request.method==="GET"&&path==="/owned-options.js")return respond(OWNED_OPTIONS,"application/javascript; charset=utf-8");
  if(request.method==="GET"&&path==="/backend-client.js")return respond(BACKEND_CLIENT,"application/javascript; charset=utf-8");
  if(request.method==="GET"&&path==="/catalog.json")return respond(CATALOG_JSON,"application/json; charset=utf-8");
  if(request.method==="GET"&&path==="/guides.json")return respond(GUIDES_JSON,"application/json; charset=utf-8");
  if(request.method==="GET"&&path==="/manifest.webmanifest")return respond(MANIFEST,"application/manifest+json; charset=utf-8");
  if(request.method==="GET"&&path==="/icon.svg")return respond(ICON_SVG,"image/svg+xml; charset=utf-8");
  if(request.method==="GET"&&path==="/sw.js")return new Response(SW,{headers:{"Content-Type":"application/javascript; charset=utf-8","Cache-Control":"no-store","Service-Worker-Allowed":"/","X-Content-Type-Options":"nosniff"}});
  if(request.method==="GET"&&path==="/health")return jsonResponse({status:"ok",service:"crc-mvp-site",version:"0.2.0",mode:"sample-only",supercell_live:false});
  if(request.method==="GET"&&path==="/api/v1/health/live")return jsonResponse({status:"ok"});
  if(request.method==="GET"&&path==="/api/v1/health/ready")return jsonResponse({status:"sample-only",live_supercell:false});
  if(request.method==="GET"&&path==="/api/v1/capabilities")return jsonResponse({schema_version:"1.0",live_lookup_enabled:false,provider:null,player_tag_verifies_ownership:false,battle_log_full_history:false,safe_public_exposure:false,mode:"sample-only"});
  if(request.method==="GET"&&path==="/api/cards")return jsonResponse({mode:"sample-only",cards:CARD_LIBRARY.cards.filter(function(c){return c.type!=="support";}).map(function(c){return {id:c.id,name:c.name,elixir:c.elixir};}),sample_decks:CARD_LIBRARY.predefined});
  if(request.method==="GET"&&path==="/api/v1/catalog/cards")return jsonResponse({items:CARD_LIBRARY.cards.map(function(c){return {id:c.id,name:c.name,elixir_cost:c.elixir,type:c.type,icon_url:c.icon};}),catalog_version:CARD_LIBRARY.revision,source:{provider:"local-seed",stale:true},mode:"sample-only"});
  if(request.method==="GET"&&path.startsWith("/api/v1/players/"))return error("LIVE_BACKEND_NOT_CONFIGURED","ارتباط زنده بازیکن در محیط Cloudflare رایگان فعال نشده است.",503);
  if(request.method==="POST"&&(path==="/api/analyze"||path==="/api/v1/decks/validate"||path==="/api/v1/analyses")){
    var raw=await request.text();if(raw.length>6000)return error("PAYLOAD_TOO_LARGE","درخواست بیش از حد بزرگ است.",413);
    var data;try{data=JSON.parse(raw);}catch(e){return error("INVALID_JSON","JSON نامعتبر است.",400);}
    var ids=path==="/api/v1/analyses"?data&&data.deck&&data.deck.card_ids:data&&data.card_ids;
    var check=factsFor(ids);
    if(check.status!==200)return error(check.code,check.error,check.status);
    if(path==="/api/v1/decks/validate")return jsonResponse({valid:check.valid,errors:[],metrics:check.facts,mode:"sample-only"});
    if(path==="/api/v1/analyses")return jsonResponse({engine_version:"arithmetic-sample-0.2",ruleset_version:"unreviewed",facts:check.facts,findings:[],recommendations:[],mode:"sample-only",disclaimer:"Sample card data; no tactical coaching or win prediction."});
    return jsonResponse({valid:check.valid,facts:check.facts,mode:"sample-only"});
  }
  if(request.method==="GET"&&path==="/favicon.ico")return new Response(null,{status:204});
  return error("NOT_FOUND","این مسیر در سایت آزمایشی موجود نیست.",404);
}
addEventListener("fetch",function(event){event.respondWith(serve(event.request));});
