/* Clash Royale Companion — public test frontend. No secrets and no player-data uploads. */
(function(){
"use strict";
var $ = function(id){return document.getElementById(id);};
var deck = [], activeSlot=0, deckSource="sample", filter="all", catalog=[], predefined={}, guides={}, player=null, battles=null, modalCard=null, profileSource="file", battlesSource="file", liveFetchedAt=null;
var pageNames={home:"داشبورد",deck:"دک من",coach:"مربی",cards:"بانک کارت‌ها",player:"پروفایل بازیکن",battles:"تاریخچه نبردها",roadmap:"نقشه راه محصول"};
var PAGE_IDS=Object.keys(pageNames);
var toastTimer=null;

var crcFilter="all",crcConnecting=false,crcLiveBusy=false;
function crcTagSaved(){try{return tagFormat(localStorage.getItem("crc.playerTag")||"");}catch(e){return null;}}
function crcStep(n){var d=$("crcOnboard");d.querySelectorAll("[data-crc-step]").forEach(s=>s.hidden=Number(s.dataset.crcStep)!==n);$("crcDots").textContent=n===0?"● ○ ○":n===1?"● ● ○":"● ● ●";$("crcSkip").hidden=n===3;}
function crcSaved(){try{var v=JSON.parse(localStorage.getItem("crc.savedDecks")||"[]");return Array.isArray(v)?v.filter(d=>Array.isArray(d)&&d.length===8&&d.every(Number.isSafeInteger)&&new Set(d).size===8&&d.every(id=>getCard(id))).slice(0,20):[];}catch(e){return [];}}
function crcSaveDecks(v){try{localStorage.setItem("crc.savedDecks",JSON.stringify(v));return true;}catch(e){notify("ذخیره‌سازی مرورگر در دسترس نیست.");return false;}}
function crcDeckTab(tab){["crcActiveDeck","crcEditDeck","crcSavedDecks"].forEach(id=>$(id).setAttribute("aria-pressed",String(id===tab)));$("crcDeckEditor").hidden=tab!=="crcEditDeck";$("crcSavedList").hidden=tab!=="crcSavedDecks";if(tab==="crcSavedDecks")crcRenderSaved();}
function crcRenderSaved(){var items=crcSaved(),el=$("crcSavedList");el.innerHTML=items.length?items.map((d,i)=>'<div class="crc-saved-row"><div class="crc-battle-cards">'+d.map(id=>art(getCard(id))).join("")+'</div><button type="button" class="btn ghost" data-saved-load="'+i+'">باز کردن</button><button type="button" class="btn ghost" data-saved-remove="'+i+'">حذف</button></div>').join(""):'<p class="small">هنوز دکی ذخیره نشده است.</p>';el.querySelectorAll("[data-saved-load]").forEach(b=>b.addEventListener("click",()=>{setDeck(items[Number(b.dataset.savedLoad)],"manual");crcDeckTab("crcEditDeck");}));el.querySelectorAll("[data-saved-remove]").forEach(b=>b.addEventListener("click",()=>{if(crcSaveDecks(items.filter((_,i)=>i!==Number(b.dataset.savedRemove))))crcRenderSaved();}));}
function crcOpenOnboard(){if(crcLiveBusy)return;var d=$("crcOnboard");crcStep(0);$("crcTag").value="";$("crcError").textContent="";if(!d.open)d.showModal();}
function crcQuickAction(key){if(coachBusy)return;var action={coachMetrics:"deck",coachOwnedOptions:"suggestions",coachBattleReport:"style",coachReport:"overview"}[key]||"overview";var question={deck:"دک فعلی و نقش هر هشت کارت من را با توجه به داده‌های واقعی تحلیل کن.",suggestions:"با توجه به کارت‌های موجود، سطح، کمیابی و فرم‌های بازشده بهترین تغییر دک را پیشنهاد بده.",style:"سبک بازی و عملکرد من را فقط بر اساس شواهد قابل انتساب نبردها تحلیل کن.",overview:"برای پیشرفت من برنامه عملی اولویت‌بندی‌شده ارائه کن."}[action];crcCoachToolsOpen(false);askCoachChat(question,action);}
function crcOwn(id){return player&&Array.isArray(player.cards)?player.cards.find(c=>c.id===id):null;}
function crcLevel(id){var c=crcOwn(id);return c&&Number.isInteger(c.level)?'<span class="crc-level">سطح ثبت‌شده '+safe(c.level)+'</span>':"";}
function crcRarity(id){var c=crcOwn(id),r=c&&String(c.rarity||"").toLowerCase();return ["common","rare","epic","legendary","champion"].includes(r)?r:"unknown";}
function crcMetric(label,value){return '<div class="crc-stat"><b>'+safe(value)+'</b><small>'+safe(label)+'</small></div>';}
function crcReport(scope){return battles&&player&&window.CRCBattleIntelligence?window.CRCBattleIntelligence.summarize(battles,player.tag,scope||"all"):null;}
function crcPerf(el,r,title){if(!el)return;if(!r){el.innerHTML='<h2>'+safe(title)+'</h2><p>پس از دریافت نبردها نمایش داده می‌شود.</p>';return;}var c=r.counts,n=c.win+c.loss+c.draw,w=n?Math.round(c.win/n*100):0,l=n?Math.round(c.loss/n*100):0;var bars=[["برد",c.win,"#39e9ad"],["باخت",c.loss,"#ff6784"],["مساوی",c.draw,"#aa88ee"]].map(x=>'<div class="crc-bar"><span>'+x[0]+'</span><i style="--amount:'+(n?100*x[1]/n:0)+'%;--color:'+x[2]+'"></i><b>'+fmt(x[1])+'</b></div>').join("");var trend=r.entries.slice().filter(e=>e.battle_time).sort((a,b)=>a.battle_time.localeCompare(b.battle_time)).slice(-25).map(e=>'<span class="'+(["win","loss","draw"].includes(e.outcome)?e.outcome:"unknown")+'"></span>').join("");el.innerHTML='<h2>'+safe(title)+'</h2><div class="crc-perf-grid"><div class="crc-ring" style="--win:'+w+'%;--loss:'+Math.min(100,w+l)+'%"><b>'+(n?fmt(w)+"٪":"—")+'<small>نرخ برد</small></b></div><div>'+bars+'</div></div><div class="crc-trend" aria-label="ترتیب نتایج نبردها">'+trend+'</div><p class="small">'+fmt(r.filtered_count)+' نبرد دریافت‌شده · '+fmt(c.unknown)+' نتیجه نامشخص · نمودار ترتیب نتایج، نه تغییر جام</p>';}
function crcRender(){if(!$("crcStats"))return;var f=calcFacts(),r=crcReport(),n=r?r.counts.win+r.counts.loss+r.counts.draw:0;if(player){$("crcAccount").innerHTML='<h2>♛ '+safe(player.name||"بازیکن")+'</h2><p dir="ltr">'+safe(player.tag)+'</p><p>🏆 '+fmt(player.trophies)+' · '+safe(player.arena&&player.arena.name||"آرنا نامشخص")+'</p>';}var own=player&&Array.isArray(player.cards)?player.cards:null;$("crcStats").innerHTML=crcMetric("نبردهای اخیر",r?fmt(r.filtered_count):"—")+crcMetric("نرخ برد",n?fmt(Math.round(r.counts.win/n*100))+"٪":"—")+crcMetric("میانگین اکسیر",f.average!=null?fmt(f.average):"—")+crcMetric("کارت‌های موجود",own?fmt(own.length):"—");crcPerf($("crcPerformance"),r,"خلاصه عملکرد");crcPerf($("crcBattleStats"),crcReport($("battleFilter").value),"عملکرد نبردهای اخیر");var same=r?r.entries.filter(e=>e.deck&&e.deck.card_ids.slice().sort((a,b)=>a-b).join(",")===deck.slice().sort((a,b)=>a-b).join(",")):[];var valid=same.filter(e=>["win","loss","draw"].includes(e.outcome)).length;$("crcDeckStats").innerHTML=crcMetric("میانگین اکسیر",f.average!=null?fmt(f.average):"—")+crcMetric("نبرد با همین ۸ کارت",r?fmt(same.length):"—")+crcMetric("نرخ برد ترکیب",valid?fmt(Math.round(100*same.filter(e=>e.outcome==="win").length/valid))+"٪":"—");$("crcCollection").innerHTML='<h2>مجموعه کارت‌ها</h2><div class="crc-stats">'+crcMetric("کارت‌های موجود",own?fmt(own.length):"—")+[["common","عادی"],["rare","نادر"],["epic","اپیک"],["legendary","لجندری"],["champion","قهرمان"]].map(x=>crcMetric(x[1],own?fmt(own.filter(c=>String(c.rarity||"").toLowerCase()===x[0]).length):"—")).join("")+'</div><p class="small">سطح خام و کمیابی بر اساس داده حساب؛ هزینه ارتقا و درصد کل مجموعه در صورت نبود داده نمایش داده نمی‌شود.</p>';renderProgressPanel();}
function crcSetup(){var d=$("crcOnboard");var on=(id,fn)=>$(id).addEventListener("click",fn);on("crcNext",()=>crcStep(1));on("crcNext2",()=>{crcStep(2);$("crcTag").focus();});on("crcBack",()=>crcStep(1));on("crcSkip",()=>{if(!crcConnecting)d.close();});d.addEventListener("cancel",e=>{if(crcConnecting)e.preventDefault();});on("crcPaste",async()=>{try{$("crcTag").value=await navigator.clipboard.readText();}catch(e){$("crcError").textContent="تگ را دستی بچسبان.";}});function connect(){if(crcLiveBusy)return;var tag=tagFormat($("crcTag").value);if(!tag){$("crcError").textContent="Player Tag معتبر وارد کن.";return;}if($("loadLivePlayer").disabled){$("crcError").textContent="اتصال زنده در دسترس نیست.";return;}crcConnecting=true;$("playerTag").value=tag;crcStep(3);$("crcLoadProfile").textContent="◌ دریافت پروفایل و دک";$("crcLoadBattles").textContent="◌ دریافت نبردها";$("crcLoadingText").textContent="در حال دریافت اطلاعات…";loadProfileLive();}on("crcConnect",connect);$("crcTag").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();connect();}});on("crcChangeAccount",crcOpenOnboard);$("homePlayerAction").addEventListener("click",e=>{if(!player&&window.CRCBetaSession){e.preventDefault();crcOpenOnboard();}});on("crcActiveDeck",()=>{if(player&&Array.isArray(player.currentDeck)&&player.currentDeck.length===8){var ids=player.currentDeck.map(c=>c.id);if(new Set(ids).size===8&&ids.every(id=>getCard(id)))setDeck(ids,profileSource==="live"?"profile-live":"profile-import",true);}crcDeckTab("crcActiveDeck");});on("crcEditDeck",()=>crcDeckTab("crcEditDeck"));on("crcSavedDecks",()=>crcDeckTab("crcSavedDecks"));on("crcSaveCurrent",()=>{if(deckErrors().length){notify("ابتدا دک را کامل کن.");return;}var items=crcSaved(),k=deck.join(",");if(items.some(x=>x.join(",")===k)){notify("این دک قبلاً ذخیره شده است.");return;}if(crcSaveDecks([deck.slice(),...items].slice(0,20))){notify("دک در این مرورگر ذخیره شد.");crcRenderSaved();}});on("crcBattleHistory",()=>{$("battleList").hidden=false;$("battleInsights").hidden=true;$("crcBattleHistory").setAttribute("aria-pressed","true");$("crcBattleAnalysis").setAttribute("aria-pressed","false");});on("crcBattleAnalysis",()=>{$("battleList").hidden=true;$("battleInsights").hidden=false;$("crcBattleHistory").setAttribute("aria-pressed","false");$("crcBattleAnalysis").setAttribute("aria-pressed","true");});crcDeckTab("crcActiveDeck");$("battleInsights").hidden=true;document.querySelectorAll("[data-crc-action]").forEach(b=>b.addEventListener("click",e=>{e.preventDefault();toPage("coach");crcQuickAction(b.dataset.crcAction);}));document.querySelectorAll("[data-coach-jump]").forEach(b=>b.addEventListener("click",e=>{e.stopImmediatePropagation();crcQuickAction(b.dataset.coachJump);},true));document.querySelectorAll("[data-crc-filter]").forEach(b=>b.addEventListener("click",()=>{crcFilter=b.dataset.crcFilter;document.querySelectorAll("[data-crc-filter]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));renderCatalog();}));$("battleFilter").addEventListener("change",crcRender);if(window.CRCBetaSession&&!crcTagSaved()&&typeof d.showModal==="function"){crcStep(0);d.showModal();}}


function safe(value){return String(value==null?"":value).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function getCard(id){return catalog.find(function(c){return c.id===Number(id);});}
function mainCards(){return catalog.filter(function(c){return c.type!=="support";});}
function validIcon(url){try{var u=new URL(url);return u.protocol==="https:"&&(u.hostname==="api-assets.clashroyale.com");}catch(e){return false;}}
function art(card){if(card&&validIcon(card.icon)){return '<img class="card-img" loading="lazy" alt="" src="'+safe(card.icon)+'">';}return '<span class="emoji-img" aria-hidden="true">'+safe(card&&card.emoji||"🃏")+'</span>';}
function notify(text){var el=$("toast");el.textContent=text;el.classList.add("show");if(toastTimer)clearTimeout(toastTimer);toastTimer=setTimeout(function(){el.classList.remove("show");},3400);}
function fmt(n){return typeof n==="number"&&Number.isFinite(n)?new Intl.NumberFormat("fa-IR",{maximumFractionDigits:3}).format(n):"نامشخص";}
function view(name){var p=PAGE_IDS.includes(name)?name:"home";document.querySelectorAll(".page").forEach(function(el){el.classList.toggle("active",el.id==="page-"+p);});document.querySelectorAll("[data-nav]").forEach(function(el){var current=el.getAttribute("data-nav")===p;el.classList.toggle("active",current);if(current)el.setAttribute("aria-current","page");else el.removeAttribute("aria-current");});$("pageTitle").textContent=pageNames[p];document.body.classList.toggle("crc-coach-view",p==="coach");if(p==="coach"){renderCoach();crcChatViewport();}else crcCoachToolsOpen(false);if(p==="cards")renderCatalog();if(p==="deck"){renderDeck();crcRender();}if(p==="battles")renderBattles();window.scrollTo({top:0,behavior:"auto"});}
function toPage(p){location.hash=p;view(p);}
function readDeck(){try{var raw=JSON.parse(localStorage.getItem("crc.deck")||"null");if(Array.isArray(raw)&&raw.length===8&&raw.every(function(id){return Number.isSafeInteger(id);})&&new Set(raw).size===8){return raw;}}catch(e){}return null;}
function saveDeck(){try{localStorage.setItem("crc.deck",JSON.stringify(deck));}catch(e){}}
function setDeck(ids,source,quiet){deck=ids.slice(0,8);while(deck.length<8)deck.push(null);deckSource=source;activeSlot=0;saveDeck();renderAll();if(!quiet)notify("دک انتخاب‌شده به‌روز شد.");}
function deckErrors(){var errors=[];if(deck.length!==8||deck.some(function(x){return x==null;}))errors.push("دک باید دقیقاً ۸ کارت داشته باشد.");var used=deck.filter(function(x){return x!=null;});if(new Set(used).size!==used.length)errors.push("کارت تکراری در دک وجود دارد.");if(used.some(function(id){var c=getCard(id);return !c||c.type==="support";}))errors.push("کارت نامعتبر یا Tower Troop در جایگاه اصلی قرار گرفته است.");return errors;}
function selectSlot(index){activeSlot=index;crcDeckTab("crcEditDeck");renderDeck();notify("جایگاه "+(index+1)+" انتخاب شد؛ کارت جدید را از فهرست لمس کن.");}
function selectCard(id){var c=getCard(id);if(!c||c.type==="support"){notify("این کارت در جایگاه اصلی دک قابل انتخاب نیست.");return;}if(deck.some(function(x,i){return x===id&&i!==activeSlot;})){notify("این کارت قبلاً در دک وجود دارد.");return;}deck[activeSlot]=id;var next=deck.findIndex(function(x){return x==null;});if(next!==-1)activeSlot=next;else activeSlot=(activeSlot+1)%8;deckSource=deckSource==="profile-import"?"profile-edited":"manual";saveDeck();renderAll();notify(safe(c.name)+" به دک اضافه شد.");}
function slotHtml(card,index,readOnly){return '<button type="button" class="deck-slot '+(!readOnly&&index===activeSlot?"active ":"")+(card?"":"empty")+'" data-slot="'+index+'" aria-label="جایگاه '+(index+1)+(card?"، "+safe(card.name):"، خالی")+'"><span class="slot-number">'+(index+1)+'</span>'+(card?('<span class="elixir-bubble">'+safe(card.elixir==null?"?":card.elixir)+'</span>'+art(card)+'<span class="card-name">'+safe(card.name)+'</span>'+crcLevel(card.id)):'<span aria-hidden="true" style="font-size:29px">＋</span><span class="card-name">انتخاب کارت</span>')+'</button>';}
function calcFacts(){
var errors=deckErrors();if(errors.length)return {errors:errors};
var items=deck.map(getCard);
var costs=items.map(function(c){return c&&c.elixir;});
var missing=items.filter(function(c){return !Number.isInteger(c.elixir)||c.elixir<0;}).map(function(c){return c&&c.name||"نامشخص";});
var known=missing.length===0;
var total=known?costs.reduce(function(a,b){return a+b;},0):null;
var four=known?costs.slice().sort(function(a,b){return a-b;}).slice(0,4).reduce(function(a,b){return a+b;},0):null;
var allKnownRoles=items.every(function(c){return Array.isArray(c.roles)&&c.roles.length>0;});
var countRole=function(role){return items.filter(function(c){return (c.roles||[]).includes(role);}).length;};
var spells=items.filter(function(c){return c.type==="spell";}).length;
var defensive=items.filter(function(c){return c.type==="building";}).length;
return {errors:[],items:items,average:total==null?null:total/8,cycle:four,expensive:known?costs.filter(function(n){return n>=5;}).length:null,cheap:known?costs.filter(function(n){return n<=2;}).length:null,missing:missing,allKnownRoles:allKnownRoles,spells:spells,defensive:defensive,roleCount:countRole};
}
function renderDeck(){
 $("deckSlotHint").textContent="جایگاه انتخاب‌شده: "+fmt(activeSlot+1);
var wrap=$("deckSlots");if(!wrap)return;
wrap.innerHTML=deck.map(function(id,i){return slotHtml(getCard(id),i);}).join("");
wrap.querySelectorAll("[data-slot]").forEach(function(b){b.addEventListener("click",function(){selectSlot(Number(b.dataset.slot));});});
$("deckSource").textContent=deckSource==="profile-import"?"دک واردشده از JSON":deckSource==="profile-edited"?"دک ویرایش‌شده پروفایل":deckSource==="profile-live"?"دک دریافت‌شده از Backend":deckSource==="battle-event-import"?"دک رویدادی (فایل Battle Log)":deckSource==="battle-import"?"دک نبرد (فایل Battle Log)":deckSource==="manual"?"انتخاب دستی":"داده نمونه";
var errors=deckErrors();$("deckAlert").textContent=errors.length?errors.join(" "):"دک کامل است";
$("deckAlert").className="message"+(errors.length?" error":"");
renderDeckLibrary();renderHome();
}
function filteredCards(query,kind){var q=(query||"").trim().toLowerCase();return mainCards().filter(function(c){
if(kind&&kind!=="all"&&c.type!==kind)return false;
return !q||c.name.toLowerCase().includes(q)||String(c.id).includes(q);
});}
function renderDeckLibrary(){
var list=filteredCards($("deckSearch").value,filter);
$("catalogCount").textContent=list.length+" کارت";
$("deckLibrary").innerHTML=list.map(function(c){return '<button class="card-option '+(deck.includes(c.id)?"in-deck":"")+'" data-card="'+c.id+'" type="button">'+(validIcon(c.icon)?'<img loading="lazy" alt="" src="'+safe(c.icon)+'">':'<span class="fallback-icon">'+safe(c.emoji||"🃏")+'</span>')+'<span><strong>'+safe(c.name)+'</strong><small>'+(c.elixir==null?"اکسیر نامشخص":safe(c.elixir)+" اکسیر")+'</small></span></button>';}).join("")||'<p class="small">کارتی پیدا نشد.</p>';
$("deckLibrary").querySelectorAll("[data-card]").forEach(function(b){b.addEventListener("click",function(){selectCard(Number(b.dataset.card));});});
}
function renderHome(){var w=$("homeDeck");if(!w)return;w.innerHTML=deck.map(function(id,i){return slotHtml(getCard(id),i,true);}).join("");w.querySelectorAll("[data-slot]").forEach(function(b){b.addEventListener("click",function(){activeSlot=Number(b.dataset.slot);toPage("deck");});});var f=calcFacts();$("homeDeckElixir").textContent=f.average==null?"اکسیر نامشخص":fmt(f.average)+" اکسیر";$("homeDeckSource").textContent=deckSource==="sample"?"دک نمونه":deckSource==="profile-import"?"داده واردشده":deckSource==="profile-live"?"دک بازیکن":"دک ویرایش‌شده";}
// Online-only coach. A user message or analysis shortcut directly starts the AI request.
var coachAICap=null,coachBusy=false,coachConversation=null,coachMemory=null;
function coachScope(){return player||null;}
function coachSession(){return coachConversation||(coachConversation=window.CRCBackendClient.createCoachSession());}
function coachMemoryStore(){
  if(coachMemory)return coachMemory;
  try{if(window.CRCBackendClient&&window.CRCBackendClient.createCoachMemory)coachMemory=window.CRCBackendClient.createCoachMemory(window.localStorage);}catch(e){}
  return coachMemory;
}
function coachMemoryTag(){
  var raw=player&&player.tag?player.tag:$("playerTag")&&$("playerTag").value;
  return window.CRCBackendClient?window.CRCBackendClient.normalizeTag(raw):null;
}
function coachMemorySnapshot(){
  var tag=coachMemoryTag();
  if(!tag||!player||!window.CRCBattleIntelligence)return null;
  var ids=deck.slice();
  if(ids.length!==8||!ids.every(id=>Number.isSafeInteger(id)&&id>0)||new Set(ids).size!==8)return null;
  var report=window.CRCBattleIntelligence.summarize(battles,tag,"all");
  var matched=(report&&Array.isArray(report.entries)?report.entries:[]).filter(e=>e.attribution==="matched_tag");
  var count=entries=>({wins:entries.filter(e=>e.outcome==="win").length,losses:entries.filter(e=>e.outcome==="loss").length,draws:entries.filter(e=>e.outcome==="draw").length,unknown:entries.filter(e=>e.outcome==="unknown").length});
  var deckKey=ids.slice().sort((a,b)=>a-b).join(":");
  var selected=matched.filter(e=>e.deck&&Array.isArray(e.deck.card_ids)&&e.deck.card_ids.slice().sort((a,b)=>a-b).join(":")===deckKey);
  var owned=Array.isArray(player.cards)?player.cards:[];
  var cards=ids.map(id=>{
    var c=owned.find(x=>x&&x.id===id)||{},item={id};
    if(Number.isInteger(c.level)&&c.level>=1&&c.level<=16)item.level=c.level;
    var rarity=String(c.rarity||"").toLowerCase();if(["common","rare","epic","legendary","champion"].includes(rarity))item.rarity=rarity;
    if(Number.isInteger(c.evolutionLevel)&&c.evolutionLevel>=0&&c.evolutionLevel<=3)item.evolution_level=c.evolutionLevel;
    if(Number.isInteger(c.starLevel)&&c.starLevel>=0&&c.starLevel<=3)item.star_level=c.starLevel;
    return item;
  });
  var groups=new Map();
  for(var e of matched){
    if(!e.deck||!Array.isArray(e.deck.card_ids)||e.deck.card_ids.length!==8)continue;
    var key=e.deck.card_ids.slice().sort((a,b)=>a-b).join(":");
    var group=groups.get(key)||{deck_card_ids:e.deck.card_ids.slice(),plays:0,wins:0,losses:0,draws:0,unknown:0,event_plays:0};
    group.plays++;group[{win:"wins",loss:"losses",draw:"draws",unknown:"unknown"}[e.outcome]||"unknown"]++;
    if(e.classification==="event")group.event_plays++;
    groups.set(key,group);
  }
  var patterns=Array.from(groups.values()).sort((a,b)=>b.plays-a.plays).slice(0,3).map(g=>({
    deck_card_ids:g.deck_card_ids,plays:g.plays,
    outcomes:{wins:g.wins,losses:g.losses,draws:g.draws,unknown:g.unknown},event_plays:g.event_plays
  }));
  var leaks=matched.map(e=>e.elixir_leaked).filter(n=>Number.isFinite(n)&&n>=0&&n<=1000);
  var latest=matched.map(e=>e.battle_time).filter(x=>typeof x==="string"&&Number.isFinite(Date.parse(x))).sort().slice(-1)[0]||null;
  var allowedDeckSources=["profile-live","profile-import","profile-edited","manual","sample","battle-event-import","battle-import"];
  return {
    captured_at:new Date().toISOString(),source:profileSource==="live"?"live":"imported",
    deck_source:allowedDeckSources.includes(deckSource)?deckSource:"manual",deck_card_ids:ids,cards,
    battles:{matched_records:matched.length,outcomes:count(matched),elixir_leak_sample:leaks.length,avg_elixir_leaked:leaks.length?Math.round(leaks.reduce((a,b)=>a+b,0)/leaks.length*100)/100:null},
    selected_deck:{matched_records:selected.length,outcomes:count(selected)},
    deck_patterns:patterns,latest_battle_at:latest
  };
}
function coachMemoryUpdatePracticeProgress(tag,store){
  if(!tag||!store||!battles||!window.CRCBattleIntelligence)return false;
  var memory=store.read(tag),pending=memory&&memory.pending_practice;
  if(!pending)return false;
  var report=window.CRCBattleIntelligence.summarize(battles,tag,"all");
  var delta=window.CRCBackendClient.coachPracticeDelta(report.entries,pending);
  return delta?store.addPracticeProgress(tag,{matched_records:delta.matched_records,outcomes:delta.outcomes},delta.last_battle_at):false;
}
function coachPracticeDeckStats(cardIds){
  var tag=coachMemoryTag();
  if(!tag||!battles||!window.CRCBattleIntelligence||!Array.isArray(cardIds)||cardIds.length!==8||!cardIds.every(Number.isSafeInteger)||new Set(cardIds).size!==8)return null;
  var report=window.CRCBattleIntelligence.summarize(battles,tag,"all");
  var matched=report.entries.filter(e=>e.attribution==="matched_tag");
  var key=cardIds.slice().sort((a,b)=>a-b).join(":");
  var selected=matched.filter(e=>e.deck&&e.deck.card_ids.slice().sort((a,b)=>a-b).join(":")===key);
  var outcomes={wins:0,losses:0,draws:0,unknown:0};
  selected.forEach(e=>{outcomes[{win:"wins",loss:"losses",draw:"draws",unknown:"unknown"}[e.outcome]]++;});
  var latest=matched.map(e=>e.battle_time).filter(x=>typeof x==="string"&&Number.isFinite(Date.parse(x))).sort().slice(-1)[0]||null;
  return {baseline:{matched_records:selected.length,outcomes},latest_battle_at:latest};
}
function coachMemoryCapture(){
  var tag=coachMemoryTag(),store=coachMemoryStore();
  if(!tag||!store||!store.isEnabled(tag))return false;
  var snapshot=coachMemorySnapshot();
  var recorded=snapshot?store.record(tag,snapshot):false;
  var progress=coachMemoryUpdatePracticeProgress(tag,store);
  return recorded||progress;
}
function coachProgressOutcomeText(value){
  if(!value)return "نمونه مبنا ثبت نشده است.";
  var c=value.outcomes||{},known=(c.wins||0)+(c.losses||0)+(c.draws||0);
  var rate=known?fmt(Math.round((c.wins||0)/known*100))+"٪":"قابل محاسبه نیست";
  return fmt(value.matched_records)+" نبرد · "+fmt(c.wins||0)+" برد · "+fmt(c.losses||0)+" باخت · "+fmt(c.draws||0)+" مساوی · نرخ برد "+rate;
}
function renderProgressPanel(){
  var el=$("crcProgressPanel");if(!el)return;
  if(!player){el.innerHTML='<h2>رصد پیشرفت بازیکن</h2><p class="small">ابتدا پروفایل بازیکن را بارگذاری کن.</p>';return;}
  if(!battles||!window.CRCBattleIntelligence){el.innerHTML='<h2>رصد پیشرفت بازیکن</h2><p class="small">برای شروع، Battle Log را از Backend دریافت یا فایل آن را وارد کن.</p>';return;}
  var report=window.CRCBattleIntelligence.summarize(battles,player.tag,"all");
  var matched=report.entries.filter(e=>e.attribution==="matched_tag");
  var counts={wins:0,losses:0,draws:0,unknown:0};
  matched.forEach(e=>{counts[{win:"wins",loss:"losses",draw:"draws",unknown:"unknown"}[e.outcome]]++;});
  var known=counts.wins+counts.losses+counts.draws;
  var rate=known?fmt(Math.round(counts.wins/known*100))+"٪":"—";
  var same=deck.length===8&&deck.every(Number.isSafeInteger)?matched.filter(e=>e.deck&&e.deck.card_ids.slice().sort((a,b)=>a-b).join(":")===deck.slice().sort((a,b)=>a-b).join(":")):[];
  var sameCounts={wins:0,losses:0,draws:0,unknown:0};
  same.forEach(e=>{sameCounts[{win:"wins",loss:"losses",draw:"draws",unknown:"unknown"}[e.outcome]]++;});
  var sameKnown=sameCounts.wins+sameCounts.losses+sameCounts.draws;
  var sameRate=sameKnown?fmt(Math.round(sameCounts.wins/sameKnown*100))+"٪":"—";
  var leaks=matched.map(e=>e.elixir_leaked).filter(n=>Number.isFinite(n)&&n>=0);
  var leakAverage=leaks.length?fmt(Math.round(leaks.reduce((a,b)=>a+b,0)/leaks.length*100)/100):"—";
  var tag=coachMemoryTag(),store=coachMemoryStore(),memory=store&&tag&&store.isEnabled(tag)?store.read(tag):null;
  var pending=memory&&(memory.pending_practice||(memory.practice_feedback&&memory.practice_feedback[0])),actions={deck:"تحلیل دک",suggestions:"پیشنهاد تعویض",style:"تحلیل سبک بازی",overview:"برنامه پیشرفت"},feedbackLabels={improved:"بهتر شد",same:"تفاوتی نداشت",worse:"بدتر شد",not_tried:"هنوز امتحان نکردم"};
  var task="";
  if(pending){
    task='<div class="crc-progress-task"><strong>پیگیری آخرین کار مربی: '+safe(actions[pending.action]||"تمرین")+(pending.target_kind==="suggested_deck"?' · دک پیشنهادی':'')+(pending.outcome?' · بازخورد ثبت‌شده: '+safe(feedbackLabels[pending.outcome]||"نامشخص"):"")+'</strong>'+
      '<div class="crc-progress-columns"><div><small>نمونه پیش از درخواست</small><p>'+safe(coachProgressOutcomeText(pending.baseline))+'</p></div>'+
      '<div><small>'+(pending.target_kind==="suggested_deck"?"نبردهای بعدی با دک پیشنهادی (در صورت استفاده)":"نبردهای بعدی با همان ۸ کارت")+'</small><p>'+safe(coachProgressOutcomeText(pending.progress))+'</p></div></div>'+
      '<p class="small">فقط نبردهای قابل انتساب با همان ترکیب کارت و زمان جدیدتر از درخواست شمرده می‌شوند. این مقایسه اجرای پیشنهاد یا رابطه علت‌ومعلولی را ثابت نمی‌کند.</p></div>';
  }else if(memory){
    task='<p class="small">هنوز کار مربی برای پیگیری ثبت نشده است؛ از یکی از تحلیل‌های آماده مربی استفاده کن.</p>';
  }else{
    task='<p class="small">برای ثبت روند بین نشست‌ها، حافظه مربی را از منوی ابزارهای مربی به‌صورت اختیاری فعال کن.</p>';
  }
  var trend=matched.filter(e=>e.battle_time).sort((a,b)=>a.battle_time.localeCompare(b.battle_time)).slice(-20)
    .map(e=>'<span class="'+(e.outcome==="win"?"win":e.outcome==="loss"?"loss":e.outcome==="draw"?"draw":"unknown")+'" title="'+safe(e.outcome)+'"></span>').join("");
  el.innerHTML='<div class="crc-progress-heading"><div><h2>رصد پیشرفت بازیکن</h2><p class="small">بر اساس '+fmt(matched.length)+' نبرد قابل انتساب در داده فعلی</p></div><span class="data-pill">'+(battlesSource==="live"?"دریافت زنده":"فایل محلی")+'</span></div>'+
    '<div class="crc-progress-metrics">'+
    '<div class="crc-stat"><b>'+fmt(known)+'</b><small>نتیجه مشخص</small></div>'+
    '<div class="crc-stat"><b>'+rate+'</b><small>نرخ برد نمونه فعلی</small></div>'+
    '<div class="crc-stat"><b>'+fmt(same.length)+'</b><small>نبرد با دک انتخابی</small></div>'+
    '<div class="crc-stat"><b>'+leakAverage+'</b><small>میانگین اکسیر هدررفته · '+fmt(leaks.length)+' نمونه</small></div></div>'+
    '<div class="crc-progress-deck"><strong>نتیجه دک انتخابی</strong><span>'+fmt(sameKnown)+' نتیجه مشخص · '+fmt(sameCounts.wins)+' برد · '+fmt(sameCounts.losses)+' باخت · نرخ برد '+sameRate+'</span></div>'+
    '<div class="crc-trend" aria-label="ترتیب ۲۰ نتیجه اخیر">'+(trend||'<span class="unknown"></span>')+'</div>'+
    task+
    '<p class="small">این نمونه، کل تاریخچه حساب نیست. نرخ برد فقط از نتایج مشخص محاسبه می‌شود؛ داده نامشخص از مخرج حذف شده و تغییر عملکرد، به‌تنهایی اثر مربی را اثبات نمی‌کند.</p>';
}
function refreshCoachMemoryUI(){
  var checkbox=$("crcCoachMemoryEnabled"),focus=$("crcCoachMemoryFocus"),clear=$("crcCoachMemoryClear"),status=$("crcCoachMemoryStatus"),feedback=$("crcCoachMemoryFeedback"),saveFeedback=$("crcCoachMemoryFeedbackSave");
  if(!checkbox)return;
  var tag=coachMemoryTag(),store=coachMemoryStore(),enabled=!!(tag&&store&&store.isEnabled(tag)),memory=enabled?store.read(tag):null,pending=!!(memory&&memory.pending_practice);
  checkbox.checked=enabled;checkbox.disabled=!tag||!store;
  if(focus){focus.disabled=!enabled;focus.value=memory&&memory.focus||"balanced";}
  if(clear)clear.disabled=!tag||!store;
  if(feedback){if(!pending)feedback.value="";feedback.disabled=!enabled||!pending;}
  if(saveFeedback)saveFeedback.disabled=!enabled||!pending||!feedback||!feedback.value;
  if(status)status.textContent=!tag?"برای استفاده از حافظه، ابتدا یک پروفایل با Player Tag بارگذاری کن.":enabled?"حافظه فعال است؛ "+(memory?memory.snapshots.length:0)+" ثبت تاریخی روی همین دستگاه."+(pending?" نتیجه آخرین تمرین در انتظار ثبت است.":""):"حافظه خاموش است؛ داده‌های قبلی تا پاک‌کردن دستی فقط روی همین دستگاه می‌مانند و ارسال نمی‌شوند.";
}
function setupCoachMemory(){
  var checkbox=$("crcCoachMemoryEnabled"),focus=$("crcCoachMemoryFocus"),clear=$("crcCoachMemoryClear"),feedback=$("crcCoachMemoryFeedback"),saveFeedback=$("crcCoachMemoryFeedbackSave");
  if(!checkbox||!focus||!clear||!feedback||!saveFeedback)return;
  checkbox.addEventListener("change",function(){
    var tag=coachMemoryTag(),store=coachMemoryStore();
    if(!tag||!store){checkbox.checked=false;refreshCoachMemoryUI();return;}
    if(!store.setEnabled(tag,checkbox.checked)){checkbox.checked=false;notify("ذخیره حافظه در این مرورگر ممکن نیست.");}
    else if(checkbox.checked)coachMemoryCapture();
    refreshCoachMemoryUI();
  });
  focus.addEventListener("change",function(){
    var tag=coachMemoryTag(),store=coachMemoryStore();
    if(tag&&store&&!store.setFocus(tag,focus.value))notify("ذخیره تمرکز تمرین ناموفق بود.");
    refreshCoachMemoryUI();
  });
  clear.addEventListener("click",function(){
    var tag=coachMemoryTag(),store=coachMemoryStore();
    if(tag&&store)store.clear(tag);
    refreshCoachMemoryUI();notify("حافظه مربی این پروفایل از این دستگاه پاک شد.");
  });
  feedback.addEventListener("change",refreshCoachMemoryUI);
  saveFeedback.addEventListener("click",function(){
    var tag=coachMemoryTag(),store=coachMemoryStore();
    if(tag&&store&&store.submitPracticeFeedback(tag,feedback.value)){feedback.value="";refreshCoachMemoryUI();notify("بازخورد تمرین برای مربی ذخیره شد.");}
    else notify("ابتدا یک نتیجه معتبر برای آخرین تمرین انتخاب کن.");
  });
  refreshCoachMemoryUI();
}
function coachAccountChanged(){if(coachConversation)coachConversation.clear();var transcript=$("coachChatMessages");if(transcript)transcript.replaceChildren();if($("crcChatWelcome"))$("crcChatWelcome").hidden=false;if($("coachChatQuestion"))$("coachChatQuestion").value="";}
// Treat model output as untrusted text; never interpret it as HTML or URLs.
function crcCoachPresentation(message,cards){
  const text=String(message??"");
  const lines=text.split(/\r?\n/).map(line=>{
    const clean=line.trim();
    const heading=clean.match(/^(?:#{1,4}\s+(.+)|\*\*(.+?)\*\*[:：]?)$/);
    if(heading)return {kind:"heading",text:heading[1]||heading[2]};
    const bullet=clean.match(/^[-*•]\s+(.+)$/);
    return {kind:bullet?"bullet":"text",text:bullet?bullet[1]:line};
  });
  const found=[], lower=text.toLowerCase();
  for(const card of [...(cards||[])].sort((a,b)=>String(b?.name||"").length-String(a?.name||"").length)){
    if(!card||!Number.isSafeInteger(card.id)||typeof card.name!=="string"||card.name.length<3||typeof card.icon!=="string")continue;
    let url;try{url=new URL(card.icon);}catch{continue;}
    if(url.origin!=="https://api-assets.clashroyale.com"||url.username||url.password||!url.pathname.startsWith("/cards/"))continue;
    const name=card.name.toLowerCase();
    let pos=-1,matched=false;
    while((pos=lower.indexOf(name,pos+1))!==-1){
      if(!/[a-z0-9]/.test(lower[pos-1]||"")&&!/[a-z0-9]/.test(lower[pos+name.length]||"")){matched=true;break;}
    }
    if(!matched||found.some(c=>c.id===card.id||c.name.toLowerCase().includes(name)))continue;
    found.push({id:card.id,name:card.name,icon:url.href});
    if(found.length===4)break;
  }
  return {lines,cards:found};
}
function crcRenderCoachAnswer(body,message){
  const presentation=crcCoachPresentation(message,catalog);
  for(const line of presentation.lines){
    const el=document.createElement(line.kind==="heading"?"strong":"span");
    el.className="crc-answer-line crc-answer-"+line.kind;
    if(line.kind==="heading"||line.kind==="bullet"){
      const icon=document.createElement("span");icon.className="crc-answer-icon";icon.setAttribute("aria-hidden","true");icon.textContent=line.kind==="heading"?"✦":"•";el.appendChild(icon);
    }
    el.appendChild(document.createTextNode(line.text));body.appendChild(el);
  }
  if(presentation.cards.length){
    const group=document.createElement("div");group.className="crc-answer-cards";
    const label=document.createElement("small");label.textContent="کارت‌های اشاره‌شده در پاسخ";group.appendChild(label);
    const list=document.createElement("div");list.className="crc-answer-card-list";
    for(const card of presentation.cards){
      const item=document.createElement("div");item.className="crc-answer-card";
      const image=document.createElement("img");image.src=card.icon;image.alt="";image.loading="lazy";image.referrerPolicy="no-referrer";image.addEventListener("error",()=>image.remove(),{once:true});
      const name=document.createElement("span");name.textContent=card.name;item.append(image,name);list.appendChild(item);
    }
    group.appendChild(list);body.appendChild(group);
  }
}

function addCoachChatMessage(role,message,source,knowledgeSources){
  var transcript=$("coachChatMessages");if(!transcript)return;
  var row=document.createElement("article");
  row.className="coach-chat-message "+(role==="user"?"is-user":role==="ai"?"is-coach":"is-status");
  var heading=document.createElement("span");heading.className="coach-chat-speaker";
  heading.textContent=role==="user"?"شما":role==="ai"?"مربی آنلاین · AI":"وضعیت اتصال";
  var body=document.createElement(role==="ai"?"div":"p");
  if(role==="ai"){body.className="crc-answer-body";crcRenderCoachAnswer(body,message);}else body.textContent=String(message==null?"":message);
  row.append(heading,body);
  if(source){var evidence=document.createElement("small");evidence.className="coach-chat-evidence";evidence.textContent=source;row.appendChild(evidence);}
  if(role==="ai"&&Array.isArray(knowledgeSources)&&knowledgeSources.length){
    var refs=document.createElement("div");refs.className="coach-chat-sources";
    var caption=document.createElement("small");caption.textContent="منابع رسمی بازیابی‌شده";refs.appendChild(caption);
    knowledgeSources.slice(0,3).forEach(function(item){try{var u=new URL(item.url);if(u.protocol!=="https:"||!((u.hostname==="support.supercell.com"&&u.pathname.startsWith("/clash-royale/en/articles/"))||(u.hostname==="supercell.com"&&u.pathname.startsWith("/en/games/clashroyale/"))))return;var link=document.createElement("a");link.href=u.href;link.target="_blank";link.rel="noopener noreferrer";link.referrerPolicy="no-referrer";link.textContent="["+item.id+"] "+item.title;refs.appendChild(link);}catch(_){}});
    if(refs.children.length>1)row.appendChild(refs);
  }
  transcript.appendChild(row);while(transcript.children.length>20)transcript.firstElementChild.remove();crcChatScrollBottom();
}
function crcCoachPending(active){
  var transcript=$("coachChatMessages"),existing=$("crcCoachPending");
  if(!active){if(existing)existing.remove();return;}
  if(existing||!transcript)return;
  var row=document.createElement("article");
  row.id="crcCoachPending";row.className="coach-chat-message is-coach crc-coach-pending";
  row.setAttribute("role","status");
  var emblem=document.createElement("span");emblem.className="crc-pending-emblem";emblem.setAttribute("aria-hidden","true");emblem.textContent="✧";
  var content=document.createElement("div");content.className="crc-pending-content";
  var label=document.createElement("span");label.className="crc-pending-label";label.textContent="مربی در حال تحلیل است…";
  var dots=document.createElement("span");dots.className="crc-pending-dots";dots.setAttribute("aria-hidden","true");
  for(var i=0;i<3;i++)dots.appendChild(document.createElement("i"));
  content.append(label,dots);row.append(emblem,content);transcript.appendChild(row);crcChatScrollBottom();
}
function crcChatScrollBottom(){var scroll=$("crcChatScroll");if(scroll)scroll.scrollTop=scroll.scrollHeight;}
function crcCoachToolsOpen(open){var menu=$("crcCoachTools"),toggle=$("crcCoachToolsToggle");if(!menu||!toggle)return;menu.hidden=!open;toggle.setAttribute("aria-expanded",String(open));}
function crcChatViewport(){var viewport=window.visualViewport;var height=viewport?viewport.height:window.innerHeight;document.body.style.setProperty("--crc-chat-viewport",height+"px");document.body.classList.toggle("crc-chat-keyboard",!!viewport&&window.innerHeight-height>130);}
function clearCoachChat(){if(coachBusy)return;if(coachConversation)coachConversation.clear();$("coachChatMessages").replaceChildren();$("crcChatWelcome").hidden=false;crcCoachToolsOpen(false);$("coachChatQuestion").value="";crcChatScrollBottom();renderCoach();}
function currentPersonalCoachContext(f){
  const scope=$("coachBattleScope").value;
  const entries=window.CRCBattleIntelligence&&player?window.CRCBattleIntelligence.summarize(battles,player.tag,scope).entries:[];
  const candidates=window.CRCOwnedOptions&&player?window.CRCOwnedOptions.ownedOptions(deck,catalog,player.cards).candidates:[];
  return window.CRCBackendClient.personalCoachContext(f,player,catalog,candidates.map(c=>c.id),deckSource,entries);
}
async function askCoachChat(question,action){
  var text=String(question==null?"":question).trim().slice(0,280);
  if(!text||coachBusy)return;
  $("crcChatWelcome").hidden=true;crcCoachToolsOpen(false);
  addCoachChatMessage("user",text);
  if(!window.CRCBetaSession||!coachAICap||coachAICap.ai_coach_enabled!==true||!window.CRCBackendClient){
    var unavailable="مربی آنلاین در حال حاضر در دسترس نیست. اتصال را بررسی کن و کمی بعد دوباره تلاش کن.";
    $("coachAIStatus").textContent=unavailable;addCoachChatMessage("status",unavailable);return;
  }
  coachBusy=true;
  var input=$("coachChatQuestion");
  var controls=Array.from(document.querySelectorAll("#coachChatForm button,#clearCoachChat,[data-coach-jump]"));
  controls.forEach(b=>b.disabled=true);input.disabled=true;
  $("coachAIStatus").textContent="در حال دریافت پاسخ از مربی آنلاین…";
  try{
    crcCoachPending(true);
    var facts=calcFacts();
    var tag=(player&&player.tag)||$("playerTag").value;
    var evidence=window.CRCBattleEvidence?window.CRCBattleEvidence.evidence(battles,tag,$("coachBattleScope").value,deck):null;
    var personal=currentPersonalCoachContext(facts);
    var requestScope=coachScope(),requestSession=coachSession();
    personal.chat_history=requestSession.history(requestScope);
    coachMemoryCapture();
    var memoryStore=coachMemoryStore();if(memoryStore&&tag)personal.coach_memory=memoryStore.read(tag);
    var reply=await window.CRCBackendClient.askAI(window.CRCBetaSession,text,facts,evidence,coachAICap,personal,action);
    crcCoachPending(false);
    if(requestScope!==coachScope())return;
    requestSession.record(requestScope,text,reply.answer);
    var practiceStore=coachMemoryStore();if(action&&practiceStore&&tag&&practiceStore.isEnabled(tag)){var trackingDeck=deck.slice(),targetKind="current_deck";if(action==="suggestions"&&reply.swap&&trackingDeck.includes(reply.swap.remove_id)&&!trackingDeck.includes(reply.swap.add_id)){trackingDeck=trackingDeck.map(id=>id===reply.swap.remove_id?reply.swap.add_id:id);targetKind="suggested_deck";}var taskStats=coachPracticeDeckStats(trackingDeck);practiceStore.recordPractice(tag,action,trackingDeck,taskStats&&taskStats.baseline,taskStats&&taskStats.latest_battle_at,targetKind);}
    refreshCoachMemoryUI();
    addCoachChatMessage("ai",reply.answer,reply.model+(reply.qualityStatus==="limited"?" · پاسخ محدودشده پس از بررسی":" · پاسخ تولیدشده توسط هوش مصنوعی"),reply.sources);
    $("coachAIStatus").textContent="پاسخ آنلاین دریافت شد.";
  }catch(e){
    crcCoachPending(false);
    if(typeof requestScope!=="undefined"&&requestScope!==coachScope())return;
    var message=(e&&e.message)||"مربی آنلاین موقتاً در دسترس نیست.";
    if(e&&e.code)message+=" ("+e.code+")";
    $("coachAIStatus").textContent=message;addCoachChatMessage("status",message);
  }finally{
    crcCoachPending(false);coachBusy=false;controls.forEach(b=>b.disabled=false);input.disabled=false;
  }
}
function setupCoachChat(){
  var form=$("coachChatForm"),input=$("coachChatQuestion");if(!form||!input)return;
  clearCoachChat();
  form.addEventListener("submit",function(event){event.preventDefault();var text=input.value.trim();if(!text)return;input.value="";askCoachChat(text);input.focus();});
  var toggle=$("crcCoachToolsToggle"),menu=$("crcCoachTools");
  toggle.addEventListener("click",function(){crcCoachToolsOpen(menu.hidden);});
  document.addEventListener("click",function(event){if(!menu.hidden&&!menu.contains(event.target)&&!toggle.contains(event.target))crcCoachToolsOpen(false);});
  document.addEventListener("keydown",function(event){if(event.key==="Escape"&&!menu.hidden){crcCoachToolsOpen(false);toggle.focus();}});
  if(window.visualViewport){window.visualViewport.addEventListener("resize",crcChatViewport);window.visualViewport.addEventListener("scroll",crcChatViewport);}
  window.addEventListener("resize",crcChatViewport);
  $("clearCoachChat").addEventListener("click",clearCoachChat);
  setupCoachMemory();
}
function renderCoach(){if(!coachBusy){$("coachAIStatus").textContent=coachAICap&&coachAICap.ai_coach_enabled===true?"مربی آنلاین آماده است؛ یک تحلیل آماده انتخاب کن یا سؤال خودت را بفرست.":"در حال بررسی دسترسی مربی آنلاین…";}coachMemoryCapture();refreshCoachMemoryUI();renderProgressPanel();}
function renderCatalog(){
var q=$("cardSearch").value.trim().toLowerCase(),cst=$("cardCost").value;
var list=catalog.filter(function(c){var own=crcOwn(c.id);if(crcFilter==="owned"&&!own)return false;if(crcFilter==="max"&&!(own&&Number.isInteger(own.level)&&Number.isInteger(own.maxLevel)&&own.level>=own.maxLevel))return false;if(q&&!c.name.toLowerCase().includes(q)&&!String(c.id).includes(q))return false;if(cst==="1-2"&&!(c.elixir>=1&&c.elixir<=2))return false;if(cst==="3-4"&&!(c.elixir>=3&&c.elixir<=4))return false;if(cst==="5+"&&!(c.elixir>=5))return false;return true;});
$("cardsGrid").innerHTML=list.map(function(c){return '<button type="button" class="catalog-card crc-'+crcRarity(c.id)+'" data-card="'+c.id+'">'+(validIcon(c.icon)?'<img loading="lazy" src="'+safe(c.icon)+'" alt="">':'<span class="fallback-icon">'+safe(c.emoji||"🃏")+'</span>')+'<strong>'+safe(c.name)+'</strong><small>'+(c.elixir==null?"نامشخص":safe(c.elixir)+" اکسیر")+'</small>'+crcLevel(c.id)+'</button>';}).join("")||'<div class="empty-panel">موردی پیدا نشد.</div>';
$("cardsGrid").querySelectorAll("[data-card]").forEach(function(b){b.addEventListener("click",function(){showModal(Number(b.dataset.card));});});
$("cardsSummary").textContent=list.length+" کارت از "+catalog.length+" مورد · نمونه اولیه و داده‌های اختیاری واردشده، نه بانک رسمی کامل.";crcRender();
}
function showModal(id){var c=getCard(id);if(!c)return;modalCard=c;$("modalName").textContent=c.name;$("modalDescription").textContent="اطلاعات این کارت بر اساس مجموعه نمونه / فایل واردشده است. برچسب نقش‌ها پیش‌نویس‌اند و توصیه Matchup قطعی محسوب نمی‌شوند.";$("modalVisual").innerHTML=art(c);$("modalDetails").innerHTML='<div class="stat"><b>'+safe(c.elixir==null?"?":c.elixir)+'</b><span>اکسیر</span></div><div class="stat"><b>'+safe(c.type==="spell"?"طلسم":c.type==="building"?"ساختمان":c.type==="support"?"پشتیبان برج":"نیرو")+'</b><span>نوع</span></div>';var guide=guides[String(c.id)];
$("modalCoaching").innerHTML=guide?'<div class="chip gold" style="display:inline-flex;margin:12px 0 4px">آموزش پیشنهادی · پیش‌نویس</div><p>'+safe(guide.focus)+'</p><h3>کاربرد در حمله</h3><p>'+safe(guide.attack)+'</p><h3>کاربرد در دفاع</h3><p>'+safe(guide.defense)+'</p><h3>تهدیدها و محدودیت‌ها</h3><p>'+safe(guide.threats)+'</p><h3>اشتباه رایج</h3><p>'+safe(guide.mistake)+'</p><div class="message">'+safe(guide.quality)+'</div>':'<div class="message">راهنمای تخصصی این کارت هنوز توسط تیم کارشناسی تکمیل و تأیید نشده است.</div>';
$("modalToDeck").hidden=c.type==="support";$("cardModal").classList.add("open");}
function hideModal(){$("cardModal").classList.remove("open");modalCard=null;}
function tagFormat(value){var tag=String(value||"").trim().toUpperCase();if(tag.startsWith("#"))tag=tag.slice(1);return /^[A-Z0-9]{3,16}$/.test(tag)?"#"+tag:null;}
function normalizeImportedCard(c){
if(!c||!Number.isSafeInteger(c.id)||typeof c.name!=="string"||!c.name)return null;
var icon=c.iconUrls&&c.iconUrls.medium;
return {id:c.id,name:c.name.slice(0,90),elixir:Number.isInteger(c.elixirCost)&&c.elixirCost>=0?c.elixirCost:null,type:c.id>=159000000?"support":(c.id>=28000000&&c.id<29000000?"spell":c.id>=27000000&&c.id<28000000?"building":"troop"),roles:[],emoji:"🃏",icon:validIcon(icon)?icon:"",source:"imported-local"};
}
function mergeProfileCards(data){
var groups=[data.cards,data.supportCards,data.currentDeck,data.currentDeckSupportCards];
groups.forEach(function(arr){if(!Array.isArray(arr))return;arr.forEach(function(raw){var card=normalizeImportedCard(raw);if(!card)return;var old=getCard(card.id);if(!old){catalog.push(card);}else{if(old.elixir==null&&card.elixir!=null)old.elixir=card.elixir;if(!old.icon&&card.icon)old.icon=card.icon;}});});
catalog.sort(function(a,b){return (a.elixir||100)-(b.elixir||100);});
}
async function parseFile(file){
if(!file)throw Error("فایلی انتخاب نشده است.");
if(file.size>2*1024*1024)throw Error("حجم فایل بیشتر از ۲ مگابایت است.");
if(!/\.json$/i.test(file.name)&&file.type!=="application/json")throw Error("فایل باید JSON باشد.");
var text=await file.text();try{return JSON.parse(text);}catch(e){throw Error("محتوای فایل JSON معتبر نیست.");}
}
async function importProfile(file){
try{var raw=await parseFile(file);if(!raw||Array.isArray(raw)||typeof raw!=="object"||!tagFormat(raw.tag))throw Error("این فایل پاسخ Player Profile معتبر نیست.");
var incomingTag=tagFormat(raw.tag),previousTag=player&&tagFormat(player.tag);coachAccountChanged();if(previousTag!==incomingTag){battles=null;battlesSource="file";}profileSource="file";liveFetchedAt=null;player=raw;mergeProfileCards(raw);renderProfile();renderCoach();if(battles)renderBattles();
if(Array.isArray(raw.currentDeck)&&raw.currentDeck.length===8){
var ids=raw.currentDeck.map(function(c){return c&&c.id;});
if(ids.every(function(id){return Number.isSafeInteger(id);})&&new Set(ids).size===8){setDeck(ids,"profile-import",true);notify("پروفایل وارد شد؛ دک ثبت‌شده هم بارگذاری شد.");}
}else{renderAll();notify("پروفایل بدون دک ۸ کارتی وارد شد.");}
$("playerTag").value=raw.tag;renderCatalog();
}catch(e){notify(e.message||"خواندن پروفایل ناموفق بود.");}finally{$("profileFile").value="";}
}
function apiTransport(){
  return window.CRCBetaSession ? window.CRCBetaSession.fetch : window.fetch.bind(window);
}
function betaLoginVisible(show){
  if(!window.CRCBetaSession)return;
  var status=$("liveBackendStatus"),button=$("betaSessionLogin");
  if(!button){
    button=document.createElement("button");
    button.type="button";button.id="betaSessionLogin";button.className="btn ghost";
    button.textContent="ورود دوباره";
    button.addEventListener("click",function(){window.CRCBetaSession.signInAgain();});
    status.parentNode.appendChild(button);
  }
  button.hidden=!show;
}
async function refreshLiveAvailability(){
  var btn=$("loadLivePlayer"),status=$("liveBackendStatus");
  btn.disabled=true;
  if(!window.CRCBackendClient){status.textContent="ماژول اتصال Backend در دسترس نیست.";return;}
  var cap=await window.CRCBackendClient.capabilities(apiTransport());
  coachAICap=window.CRCBetaSession&&cap.ai_coach_enabled===true?cap:null;
  $("coachAIStatus").textContent=coachAICap?"مربی آنلاین آماده است؛ بدون تأیید جداگانه.":"مربی آنلاین در این لحظه در دسترس نیست.";
  if(cap.live_lookup_enabled){
    betaLoginVisible(false);
    btn.disabled=false;btn.textContent="دریافت اطلاعات";
    status.textContent=window.CRCBetaSession?"بتای خصوصی آماده است؛ اتصال زنده برقرار است و Player Tag اثبات مالکیت نیست.":"Backend آمادگی دریافت داده عمومی را اعلام کرده است. مالکیت حساب تأیید نمی‌شود.";
  }else{
    btn.disabled=true;btn.textContent="اتصال زنده در دسترس نیست";
    var needsLogin=!!(window.CRCBetaSession&&["SESSION_REQUIRED","INVITE_SESSION_REQUIRED","WORKER_ASSERTION_MISSING","WORKER_ASSERTION_INVALID","HTTP_401","HTTP_403"].includes(cap.reason));
    betaLoginVisible(needsLogin);
    var rateLimited=!!(window.CRCBetaSession&&["MEMBER_QUOTA_EXCEEDED","GLOBAL_QUOTA_EXCEEDED","HTTP_429"].includes(cap.reason));
    var notInvited=!!(window.CRCBetaSession&&cap.reason==="WORKER_ASSERTION_INVALID");
    status.textContent=needsLogin?"نشست بتای خصوصی منقضی یا نامعتبر است؛ یک‌بار صفحه را تازه‌سازی کن.":rateLimited?"سهمیه موقت درخواست‌های بتا پر شده است؛ از ارسال مکرر درخواست خودداری کن.":notInvited?"اعتبارسنجی نشست بتای خصوصی ناموفق بود.":"Backend زنده در این محیط فعال نیست؛ واردکردن فایل JSON همچنان در دسترس است.";
  }
}
async function loadProfileLive(){
  if(crcLiveBusy)return;
  var btn=$("loadLivePlayer"),status=$("liveBackendStatus");
  var tag=tagFormat($("playerTag").value);
  if(!tag){status.textContent="ابتدا Player Tag معتبر وارد کن.";return;}
  if(!window.CRCBackendClient)return;
  crcLiveBusy=true;btn.disabled=true;status.textContent="در حال دریافت پروفایل و نبردها از Backend...";
  try{
    var payload=await window.CRCBackendClient.loadPlayer(apiTransport(),tag);
    // Do not mutate local profile state until all mandatory response schemas are verified.
    coachAccountChanged();player=payload.profile;profileSource="live";liveFetchedAt=payload.fetched_at;
    battles=payload.battles;battlesSource="live";
    mergeProfileCards(player);mergeBattleCards(battles);
    if(Array.isArray(player.currentDeck)&&player.currentDeck.length===8){
      var ids=player.currentDeck.map(function(c){return c.id;});
      if(ids.every(Number.isSafeInteger)&&new Set(ids).size===8)setDeck(ids,"profile-live",true);
    }
    renderProfile();renderCoach();renderBattles();renderCatalog();
    status.textContent=payload.partial?"پروفایل دریافت شد؛ بخشی از تاریخچه نبردها در دسترس نبود.":"اطلاعات عمومی دریافت شد؛ مالکیت حساب با Player Tag تأیید نمی‌شود.";
    try{localStorage.setItem("crc.playerTag",tag);}catch(e){}if(crcConnecting){$("crcLoadProfile").textContent="✓ پروفایل و دک دریافت شد";$("crcLoadBattles").textContent=payload.partial?"! تاریخچه نبردها ناقص است":"✓ نبردها دریافت شد";crcConnecting=false;$("crcOnboard").close();toPage("home");}crcRender();notify("اطلاعات عمومی بازیکن از Backend دریافت شد.");
  }catch(e){
    status.textContent=(e&&e.message)||"اتصال به Backend ناموفق بود.";if(crcConnecting){crcConnecting=false;crcStep(2);$("crcError").textContent=status.textContent;}
    var loginNeeded=!!(window.CRCBetaSession&&e&&
      ["INVITE_SESSION_REQUIRED","WORKER_ASSERTION_MISSING","WORKER_ASSERTION_INVALID","HTTP_401","HTTP_403"].includes(e.code));
    betaLoginVisible(loginNeeded);
  }
  finally{crcLiveBusy=false;refreshLiveAvailability();}
}
function renderProfile(){
var wrap=$("profileSummary");if(!player)return;
 $("homePlayerSummary").textContent=(player.name||"بازیکن")+" · "+(typeof player.trophies==="number"?fmt(player.trophies)+" جام":"جام نامشخص");
 $("homePlayerAction").textContent="پروفایل بازیکن ←";
 $("dataStatus").textContent=profileSource==="live"?"داده دریافت‌شده":"داده واردشده";
var owned=Array.isArray(player.cards)?player.cards.length:0;var support=Array.isArray(player.supportCards)?player.supportCards.length:0;
var name=safe(player.name||"بدون نام"),tag=safe(player.tag||""),trophies=safe(player.trophies==null?"نامشخص":player.trophies),arena=safe(player.arena&&player.arena.name||"نامشخص");
wrap.className="panel";wrap.innerHTML='<div class="panel-top"><div><div class="eyebrow">'+(profileSource==="live"?"LIVE PROFILE · SERVER-SIDE SUPERCELL":"IMPORTED PROFILE · LOCAL ONLY")+'</div><h2>'+name+'</h2><p dir="ltr">'+tag+'</p></div><span class="chip gold">مالکیت احراز نشده</span></div><div class="stat-inline"><div class="stat"><b>'+trophies+'</b><span>Trophies</span></div><div class="stat"><b>'+owned+'</b><span>کارت اصلی در فایل</span></div><div class="stat"><b>'+support+'</b><span>کارت پشتیبان</span></div><div class="stat"><b>'+arena+'</b><span>Arena</span></div></div><div class="message">'+safe(profileSource==="live"?"پاسخ از Backend با کلید سرور دریافت شده است؛ مالکیت حساب تأیید نشده و زمان دریافت: "+(liveFetchedAt||"نامشخص"):"این اطلاعات فقط از فایل واردشده خوانده شده‌اند. تازگی داده و مالکیت حساب مستقل از آن تأیید نشده است.")+'</div>'+(Array.isArray(player.currentDeck)&&player.currentDeck.length===8?'<button type="button" id="useProfileDeck" class="btn primary" style="margin-top:15px">بازکردن دک پروفایل در دک‌ساز ←</button>':"");
var b=$("useProfileDeck");if(b)b.addEventListener("click",function(){var ids=player.currentDeck.map(function(c){return c.id;});if(new Set(ids).size===8){setDeck(ids,"profile-import");toPage("deck");}});
  coachMemoryCapture();renderProgressPanel();
}
async function importBattles(file){
try{var raw=await parseFile(file);if(!Array.isArray(raw)||raw.some(function(b){return !b||typeof b!=="object";})||raw.length>200)throw Error("این فایل قالب معتبر Battle Log ندارد یا خیلی بزرگ است.");battles=raw;battlesSource="file";mergeBattleCards(raw);renderBattles();renderCatalog();notify(raw.length+" نبرد از فایل به‌صورت محلی خوانده شد.");}
catch(e){notify(e.message||"خواندن Battle Log ناموفق بود.");}finally{$("battlesFile").value="";}
}
function mergeBattleCards(raw){
  raw.forEach(function(b){
    ["team","opponent"].forEach(function(side){
      (Array.isArray(b[side])?b[side]:[]).forEach(function(participant){
        if(!participant||typeof participant!=="object")return;
        ["cards","supportCards"].forEach(function(field){
          (Array.isArray(participant[field])?participant[field]:[]).forEach(function(item){
            var c=normalizeImportedCard(item);
            if(!c)return;
            var old=getCard(c.id);
            if(!old)catalog.push(c);
            else{if(old.elixir==null&&c.elixir!=null)old.elixir=c.elixir;if(!old.icon&&c.icon)old.icon=c.icon;}
          });
        });
      });
    });
  });
}
function battleDate(raw){
  var normalized=window.CRCBattleIntelligence.date(raw);
  if(!normalized)return "زمان نامشخص";
  return new Intl.DateTimeFormat("fa-IR",{dateStyle:"medium",timeStyle:"short",timeZone:"UTC"}).format(new Date(normalized))+" UTC";
}
function battleRow(entry){
  var names=(entry.self_name||"بازیکن")+" در برابر "+(entry.opponent_name||"حریف");
  var outcomeName=entry.outcome==="win"?"برد":entry.outcome==="loss"?"شکست":entry.outcome==="draw"?"مساوی":"نامشخص";
  var cls=entry.outcome==="win"?"win":entry.outcome==="loss"?"loss":"";
  var label=entry.classification==="event"?"رویداد / دک مخصوص":"نوع رقابت تأییدنشده";
  var score=(entry.crowns==null?"?":entry.crowns)+"–"+(entry.opponent_crowns==null?"?":entry.opponent_crowns);
  return '<div class="battle-row crc-outcome-'+cls+'"><div><strong>'+safe(names)+'</strong><div class="sub">'+safe(battleDate(entry.raw_battle_time))+'</div></div><div class="result '+cls+'">'+safe(outcomeName)+' · '+safe(score)+'</div>'+(entry.deck?'<div class="crc-battle-cards">'+entry.deck.card_ids.map(id=>art(getCard(id))).join("")+'</div>':"")+'<div class="extra"><span class="chip '+(entry.classification==="event"?"gold":"")+'">'+safe(label)+'</span><div class="sub">اکسیر تلف‌شده گزارش‌شده: '+safe(entry.elixir_leaked==null?"نامشخص":fmt(entry.elixir_leaked))+(entry.attribution==="single_team_assumed"?" · بازیکن از عضو اول تیم فرض شده":entry.attribution==="unknown"?" · بازیکن شناسایی نشده":"")+'</div></div></div>';
}
function renderBattles(){
  if(!battles)return;
  var module=window.CRCBattleIntelligence;
  if(!module){$("battleList").textContent="ماژول تحلیل نبرد بارگذاری نشده است.";return;}
  var inputTag=player&&tagFormat(player.tag)||tagFormat($("playerTag").value);
  var report=module.summarize(battles,inputTag,$("battleFilter").value);
  var rows=report.entries;coachMemoryCapture();crcRender();renderProgressPanel();
  var stats=[
    [report.filtered_count,"نبرد در فیلتر"],
    [report.counts.win,"بردهای قابل تشخیص"],
    [report.counts.loss,"شکست‌های قابل تشخیص"],
    [report.event_count,"نبرد رویدادی"],
    [report.unclassified_count,"حالت تأییدنشده"]
  ];
  $("battleStats").innerHTML=stats.map(function(pair){return '<div class="stat"><b>'+fmt(pair[0])+'</b><span>'+safe(pair[1])+'</span></div>';}).join("");
  var insights=[];
  insights.push('<div class="battle-note">این آمار فقط از <strong>'+fmt(report.total_entries)+'</strong> رکورد '+(battlesSource==="live"?"دریافتی Backend":"موجود در فایل")+' ساخته شده است. به معنی کل تاریخچه حساب، تخمین نرخ برد آینده یا تشخیص اشتباه لحظه‌ای نیست.</div>');
  if(report.unidentified_count)insights.push('<div class="battle-note warning">'+fmt(report.unidentified_count)+' نبرد به Player Tag انتخاب‌شده قابل انتساب نیست؛ نتیجه آنها نامشخص گذاشته شده است.</div>');
  if(report.assumed_count)insights.push('<div class="battle-note warning">در '+fmt(report.assumed_count)+' نبرد، به‌دلیل نبود Tag مشخص، عضو اول تیم به‌طور موقت بازیکن فرض شده است؛ این اثبات مالکیت نیست.</div>');
  if(report.average_elixir_leaked!==null){
    insights.push('<div class="battle-stat-head"><strong>میانگین Elixir Leaked گزارش‌شده: '+fmt(report.average_elixir_leaked)+'</strong><span class="data-pill">نمونه دارای داده: '+fmt(report.elixir_sample_count)+'</span></div><p class="small">این عدد فقط شاخص گزارش‌شده API است؛ بدون Replay زمان یا علت نشت اکسیر و تقصیر تاکتیکی را مشخص نمی‌کند.</p>');
  }
  if(report.decks.length){
    insights.push('<h3>دک‌های مشاهده‌شده در همین فایل</h3><div class="observed-decks">'+report.decks.slice(0,4).map(function(d,i){
      var names=d.card_ids.map(function(id){var c=getCard(id);return c?c.name:"کارت "+id;});
      return '<div class="observed-deck"><div><strong>'+safe(names.join("، "))+'</strong><div class="sub">'+fmt(d.plays)+' مسابقه · '+fmt(d.event_plays)+' رویدادی · '+fmt(d.unknown)+' نتیجه نامشخص</div></div><button type="button" class="btn ghost" data-deck-index="'+i+'">انتخاب این دک</button></div>';
    }).join("")+'</div>');
  }
  $("battleInsights").innerHTML=insights.join("");
  $("battleInsights").querySelectorAll("[data-deck-index]").forEach(function(btn){
    btn.addEventListener("click",function(){
      var entry=report.decks[Number(btn.dataset.deckIndex)];
      if(!entry)return;
      setDeck(entry.card_ids,entry.event_plays?"battle-event-import":"battle-import");
      toPage("deck");
      notify("دک مسابقه برای تحلیل انتخاب شد؛ سطح و حالت ویژه رویداد جدا از حساب اصلی است.");
    });
  });
  $("battleList").className="";
  $("battleList").innerHTML=rows.length?rows.slice(0,40).map(battleRow).join(""):'<div class="empty-panel">برای این فیلتر موردی موجود نیست.</div>';
}
function renderAll(){renderDeck();renderCoach();renderCatalog();crcRender();}
function setupEvents(){
 setupCoachChat();
window.addEventListener("hashchange",function(){view(location.hash.slice(1));});
$("loadHeavy").addEventListener("click",function(){setDeck(predefined.heavy,"sample");});
$("loadHog").addEventListener("click",function(){setDeck(predefined.hog,"sample");});
$("clearDeck").addEventListener("click",function(){setDeck([null,null,null,null,null,null,null,null],"manual");});
$("analyzeDeck").addEventListener("click",function(){var e=deckErrors();if(e.length)notify(e.join(" "));else{toPage("coach");crcQuickAction("coachMetrics");}});

$("copyDeck").addEventListener("click",async function(){var value=deck.filter(Boolean).join(",");if(!value){notify("دکی برای کپی وجود ندارد.");return;}try{await navigator.clipboard.writeText(value);notify("شناسه کارت‌ها کپی شد.");}catch(e){notify("مرورگر اجازه دسترسی به Clipboard را نداد.");}});
$("deckSearch").addEventListener("input",renderDeckLibrary);$("deckFilters").querySelectorAll("[data-filter]").forEach(function(btn){btn.addEventListener("click",function(){filter=btn.dataset.filter;$("deckFilters").querySelectorAll(".filter").forEach(function(el){el.classList.toggle("active",el===btn);});renderDeckLibrary();});});
$("cardSearch").addEventListener("input",renderCatalog);$("cardCost").addEventListener("change",renderCatalog);
$("closeModal").addEventListener("click",hideModal);$("cardModal").addEventListener("click",function(e){if(e.target===$("cardModal"))hideModal();});
window.addEventListener("keydown",function(e){if(e.key==="Escape")hideModal();});
$("modalToDeck").addEventListener("click",function(){var id=modalCard&&modalCard.id;hideModal();if(id){selectCard(id);toPage("deck");}});
$("loadLivePlayer").addEventListener("click",loadProfileLive);
 document.querySelectorAll('a[href="#coach"].btn.primary').forEach(function(link){link.addEventListener("click",function(e){e.preventDefault();toPage("coach");crcQuickAction("coachMetrics");});});
$("playerTag").addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();if(!$("loadLivePlayer").disabled)loadProfileLive();else $("tagStatus").textContent=tagFormat(this.value)?"تگ معتبر است؛ اتصال زنده در دسترس نیست.":"تگ بازیکن را بررسی کن.";}});
$("checkTag").addEventListener("click",function(){var t=tagFormat($("playerTag").value);$("tagStatus").textContent=t?"قالب تگ معتبر است: "+t+(window.CRCBetaSession?" — دریافت آنلاین به نشست بتای خصوصی وابسته است.":" — اتصال زنده هنوز فعال نیست."):"قالب Player Tag معتبر نیست؛ تگ شامل حروف و عدد و در صورت نیاز # است.";});
$("profileFile").addEventListener("change",function(e){if(e.target.files[0])importProfile(e.target.files[0]);});
$("battlesFile").addEventListener("change",function(e){if(e.target.files[0])importBattles(e.target.files[0]);});
$("battleFilter").addEventListener("change",renderBattles);


}
async function init(){
try{var responses=await Promise.all([fetch("/catalog.json",{cache:"no-store"}),fetch("/guides.json",{cache:"no-store"})]);if(!responses[0].ok||!responses[1].ok)throw Error("assets");var data=await responses[0].json(),coaching=await responses[1].json();if(!data||!Array.isArray(data.cards)||!data.predefined||!coaching||!coaching.guides)throw Error("catalog");catalog=data.cards;predefined=data.predefined;guides=coaching.guides;var prev=readDeck();deck=prev&&prev.every(function(id){return !!getCard(id);})?prev.slice():predefined.heavy.slice();deckSource=prev?"manual":"sample";setupEvents();renderAll();view(location.hash.slice(1)||"home");crcSetup();crcRender();await refreshLiveAvailability();var saved=crcTagSaved();if(window.CRCBetaSession&&saved&&!$("loadLivePlayer").disabled){$("playerTag").value=saved;loadProfileLive();}}catch(e){document.querySelectorAll(".page").forEach(function(p){p.classList.remove("active");});$("page-home").classList.add("active");$("page-home").insertAdjacentHTML("afterbegin",'<div class="notice"><strong>خطای بارگذاری بانک کارت‌های نمونه؛ صفحه را تازه‌سازی کن.</strong></div>');}}
init();
if(!window.CRCBetaSession && 'serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){});});}
})();
