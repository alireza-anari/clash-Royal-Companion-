/* Clash Royale Companion — public test frontend. No secrets and no player-data uploads. */
(function(){
"use strict";
var $ = function(id){return document.getElementById(id);};
var deck = [], activeSlot=0, deckSource="sample", filter="all", catalog=[], predefined={}, guides={}, player=null, battles=null, modalCard=null, profileSource="file", battlesSource="file", liveFetchedAt=null;
var pageNames={home:"داشبورد",deck:"دک من",coach:"مربی",cards:"بانک کارت‌ها",player:"پروفایل بازیکن",battles:"تاریخچه نبردها",roadmap:"نقشه راه محصول"};
var PAGE_IDS=Object.keys(pageNames);
var toastTimer=null;
function safe(value){return String(value==null?"":value).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function getCard(id){return catalog.find(function(c){return c.id===Number(id);});}
function mainCards(){return catalog.filter(function(c){return c.type!=="support";});}
function validIcon(url){try{var u=new URL(url);return u.protocol==="https:"&&(u.hostname==="api-assets.clashroyale.com");}catch(e){return false;}}
function art(card){if(card&&validIcon(card.icon)){return '<img class="card-img" loading="lazy" alt="" src="'+safe(card.icon)+'">';}return '<span class="emoji-img" aria-hidden="true">'+safe(card&&card.emoji||"🃏")+'</span>';}
function notify(text){var el=$("toast");el.textContent=text;el.classList.add("show");if(toastTimer)clearTimeout(toastTimer);toastTimer=setTimeout(function(){el.classList.remove("show");},3400);}
function fmt(n){return typeof n==="number"&&Number.isFinite(n)?new Intl.NumberFormat("fa-IR",{maximumFractionDigits:3}).format(n):"نامشخص";}
function view(name){var p=PAGE_IDS.includes(name)?name:"home";document.querySelectorAll(".page").forEach(function(el){el.classList.toggle("active",el.id==="page-"+p);});document.querySelectorAll("[data-nav]").forEach(function(el){var current=el.getAttribute("data-nav")===p;el.classList.toggle("active",current);if(current)el.setAttribute("aria-current","page");else el.removeAttribute("aria-current");});$("pageTitle").textContent=pageNames[p];if(p==="coach")renderCoach();if(p==="cards")renderCatalog();if(p==="deck")renderDeck();if(p==="battles")renderBattles();window.scrollTo({top:0,behavior:"auto"});}
function toPage(p){location.hash=p;view(p);}
function readDeck(){try{var raw=JSON.parse(localStorage.getItem("crc.deck")||"null");if(Array.isArray(raw)&&raw.length===8&&raw.every(function(id){return Number.isSafeInteger(id);})&&new Set(raw).size===8){return raw;}}catch(e){}return null;}
function saveDeck(){try{localStorage.setItem("crc.deck",JSON.stringify(deck));}catch(e){}}
function setDeck(ids,source,quiet){deck=ids.slice(0,8);while(deck.length<8)deck.push(null);deckSource=source;activeSlot=0;saveDeck();renderAll();if(!quiet)notify("دک انتخاب‌شده به‌روز شد.");}
function deckErrors(){var errors=[];if(deck.length!==8||deck.some(function(x){return x==null;}))errors.push("دک باید دقیقاً ۸ کارت داشته باشد.");var used=deck.filter(function(x){return x!=null;});if(new Set(used).size!==used.length)errors.push("کارت تکراری در دک وجود دارد.");if(used.some(function(id){var c=getCard(id);return !c||c.type==="support";}))errors.push("کارت نامعتبر یا Tower Troop در جایگاه اصلی قرار گرفته است.");return errors;}
function selectSlot(index){activeSlot=index;renderDeck();notify("جایگاه "+(index+1)+" انتخاب شد؛ کارت جدید را از فهرست لمس کن.");}
function selectCard(id){var c=getCard(id);if(!c||c.type==="support"){notify("این کارت در جایگاه اصلی دک قابل انتخاب نیست.");return;}if(deck.some(function(x,i){return x===id&&i!==activeSlot;})){notify("این کارت قبلاً در دک وجود دارد.");return;}deck[activeSlot]=id;var next=deck.findIndex(function(x){return x==null;});if(next!==-1)activeSlot=next;else activeSlot=(activeSlot+1)%8;deckSource=deckSource==="profile-import"?"profile-edited":"manual";saveDeck();renderAll();notify(safe(c.name)+" به دک اضافه شد.");}
function slotHtml(card,index){return '<button type="button" class="deck-slot '+(index===activeSlot?"active ":"")+(card?"":"empty")+'" data-slot="'+index+'" aria-label="جایگاه '+(index+1)+(card?"، "+safe(card.name):"، خالی")+'"><span class="slot-number">'+(index+1)+'</span>'+(card?('<span class="elixir-bubble">'+safe(card.elixir==null?"?":card.elixir)+'</span>'+art(card)+'<span class="card-name">'+safe(card.name)+'</span>'):'<span aria-hidden="true" style="font-size:29px">＋</span><span class="card-name">انتخاب کارت</span>')+'</button>';}
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
var errors=deckErrors();$("deckAlert").textContent=errors.length?errors.join(" "):"۸ جایگاه معتبر انتخاب شده‌اند؛ برای دیدن گزارش روی «تحلیل این دک» بزن.";
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
function renderHome(){var w=$("homeDeck");if(!w)return;w.innerHTML=deck.map(function(id,i){return slotHtml(getCard(id),i);}).join("");w.querySelectorAll("[data-slot]").forEach(function(b){b.addEventListener("click",function(){activeSlot=Number(b.dataset.slot);toPage("deck");});});var f=calcFacts();$("homeDeckElixir").textContent=f.average==null?"اکسیر نامشخص":fmt(f.average)+" اکسیر";$("homeDeckSource").textContent=deckSource==="sample"?"دک نمونه":deckSource==="profile-import"?"داده واردشده":deckSource==="profile-live"?"دک بازیکن":"دک ویرایش‌شده";}
function roleFinding(title,text,evidence,quality){return {title:title,text:text,evidence:evidence||[],quality:quality||"اطلاعات اولیه"};}
function findings(f){
if(f.errors.length)return [];
var out=[];
if(f.average==null)out.push(roleFinding("میانگین اکسیر نامشخص است","داده هزینه یک یا چند کارت کامل نیست؛ از عدد حدسی استفاده نمی‌کنیم.",f.missing,"داده ناقص"));
else if(f.average>=4)out.push(roleFinding("چرخه پرهزینه‌تر","میانگین این دک "+fmt(f.average)+" اکسیر است. این یک واقعیت حسابی است و به‌تنهایی ضعف دک را ثابت نمی‌کند.",[],"محاسبه دقیق"));
else if(f.average<=2.8)out.push(roleFinding("چرخه کم‌هزینه","میانگین این دک "+fmt(f.average)+" است. این شاخص به‌تنهایی سرعت واقعی بازی یا نتیجه مسابقه را پیش‌بینی نمی‌کند.",[],"محاسبه دقیق"));
if(f.defensive===0)out.push(roleFinding("ساختمان دفاعی در دک دیده نمی‌شود","این فقط یک مشاهده درباره ترکیب کارت‌هاست و به‌تنهایی نشان‌دهنده ضعف دفاعی نیست.",[],"نقش کارت‌های نمونه"));
if(f.spells===0)out.push(roleFinding("طلسمی در ترکیب دیده نمی‌شود","بررسی کن آیا سایر کارت‌ها نقش پاسخ به گروه‌ها را پوشش می‌دهند؛ این ترکیب لزوماً غیرقابل بازی نیست.",[],"نقش کارت‌های نمونه"));
else if(f.spells===1)out.push(roleFinding("فقط یک طلسم وجود دارد","یک طلسم به‌تنهایی نشانه ضعف نیست. نوع آن و نیازهای دک باید در تحلیل تخصصی بررسی شود.",f.items.filter(function(c){return c.type==="spell";}).map(function(c){return c.name;}),"نقش کارت‌های نمونه"));
if(f.allKnownRoles){
if(f.roleCount("air") + f.roleCount("splash_air")===0)out.push(roleFinding("پوشش هوایی در برچسب‌های اولیه دیده نمی‌شود","پیش از نتیجه‌گیری باید نقش همه کارت‌ها در نسخه فعلی بازی توسط متخصص تأیید شود.",[],"قواعد در انتظار بازبینی"));
if(f.roleCount("win")===0)out.push(roleFinding("Win Condition در برچسب‌های اولیه شناسایی نشد","این به معنی نداشتن مسیر برد نیست؛ راه‌های غیرمتداول حمله نیاز به تحلیل انسانی دارند.",[],"قواعد در انتظار بازبینی"));
}else out.push(roleFinding("داده نقش کارت‌ها ناقص است","برای بخشی از کارت‌ها برچسب نقش تأییدشده نداریم؛ درباره پوشش هوایی یا Win Condition ادعای قطعی نمی‌کنیم.",[],"داده ناقص"));
return out.slice(0,4);
}
function renderOwnedOptions(){
  var root=$("coachOwnedOptions");
  if(!root)return;
  if(!player||!Array.isArray(player.cards)||!player.cards.length){
    root.innerHTML='<div class="empty-panel"><strong>برای پیشنهاد بر اساس کارت‌های خودت، فایل Player Profile را وارد کن.</strong><p>هیچ اطلاعات حساب یا سطح کارتی را حدس نمی‌زنیم.</p><a href="#player" class="btn ghost">واردکردن فایل JSON پروفایل</a></div>';
    return;
  }
  if(!window.CRCOwnedOptions){root.textContent="ماژول گزینه‌های پیشنهادی بارگذاری نشده است.";return;}
  var result=window.CRCOwnedOptions.ownedOptions(deck,catalog,player.cards);
  if(!result.candidates.length){
    root.innerHTML='<div class="empty-panel"><strong>از روی اطلاعات فعلی گزینه مطمئنی برای بررسی پیدا نشد.</strong><p>این به معنی بی‌نقص‌بودن دک نیست؛ نقش بسیاری از کارت‌ها هنوز تأیید تخصصی نشده است.</p></div>';
    return;
  }
  root.innerHTML='<div class="battle-note warning">این‌ها «کارت‌های موجود برای بررسی» هستند، نه تعویض قطعی. نقش‌ها پیش‌نویس‌اند و سطح خام کارت‌ها در کمیابی‌های مختلف قابل مقایسه مستقیم نیست.</div>'+
    result.candidates.map(function(c){
      return '<div class="finding"><div class="finding-top"><span class="chip gold">پیشنهاد اولیه</span><h3>'+safe(c.name)+'</h3><span class="data-pill">'+safe(c.elixir_cost)+' اکسیر</span></div>'+
      '<p>'+safe(c.reasons.join(" "))+'</p><div class="evidence">در فایل پروفایل موجود است · Level خام: '+safe(c.level_raw==null?"نامشخص":c.level_raw)+'</div>'+
      '<div class="evidence">'+safe(c.tradeoff)+'</div></div>';
    }).join("");
}
function renderOfflineCoach(){
  var target=$("coachBattleReport");
  if(!target)return;
  target.replaceChildren();
  var result=window.CRCOfflineCoach
    ? window.CRCOfflineCoach.analyze(
        battles, (player&&player.tag)||$("playerTag").value, $("coachBattleScope").value, deck)
    : {items:[{title:"در دسترس نیست",detail:"ماژول مربی بارگذاری نشده است."}]};
  result.items.forEach(function(entry){
    var article=document.createElement("article");
    article.className="finding";
    var title=document.createElement("h3");
    title.textContent=entry.title;
    var description=document.createElement("p");
    description.textContent=entry.detail;
    article.append(title,description);
    target.appendChild(article);
  });
}
// Chat transcript stays in memory. Render text nodes only; never HTML from questions.
var coachAICap=null,coachBusy=false;
function addCoachChatMessage(role, message, source){
  var transcript=$("coachChatMessages");
  if(!transcript)return;
  var row=document.createElement("article");
  row.className="coach-chat-message "+(role==="user"?"is-user":"is-coach");
  var heading=document.createElement("span");
  heading.className="coach-chat-speaker";
  heading.textContent=role==="user"?"شما":role==="ai"?"مربی آنلاین · AI":"مربی آفلاین";
  var body=document.createElement("p");
  body.textContent=String(message==null?"":message);
  row.append(heading,body);
  if(source){
    var evidence=document.createElement("small");
    evidence.className="coach-chat-evidence";
    evidence.textContent="مبنای پاسخ: "+source;
    row.appendChild(evidence);
  }
  transcript.appendChild(row);
  while(transcript.children.length>20)transcript.firstElementChild.remove();
  transcript.scrollTop=transcript.scrollHeight;
}
function clearCoachChat(){
  if(coachBusy)return;
  $("coachAIConsent").checked=false;
  $("coachChatMessages").replaceChildren();
  addCoachChatMessage("coach",
    "سلام! من راهنمای آفلاین دک و نبردهای تو هستم. از پرسش‌های آماده شروع کن یا سؤال کوتاهی درباره دک و آمار نبردها بنویس. پاسخ‌ها از داده‌های واقعی همین صفحه محاسبه می‌شوند.",
    "قواعد قابل توضیح · بدون مدل زبانی مولد");
}
async function askCoachChat(question){
  var text=String(question==null?"":question).trim().slice(0,280);
  if(!text||coachBusy)return;
  var consent=$("coachAIConsent");
  var useAI=!!(window.CRCBetaSession&&coachAICap&&coachAICap.ai_coach_enabled===true&&consent&&consent.checked&&!$("coachAIOptions").hidden);
  if(consent)consent.checked=false;
  addCoachChatMessage("user",text);
  var f=calcFacts();
  var evidence=window.CRCOfflineCoach
    ? window.CRCOfflineCoach.evidence(
        battles,(player&&player.tag)||$("playerTag").value,
        $("coachBattleScope").value,deck)
    : null;
  var result=window.CRCChatCoach
    ? window.CRCChatCoach.respond(text,{
        facts:f,
        findings:Array.isArray(f.errors)&&!f.errors.length?findings(f):[],
        battleEvidence:evidence
      })
    : {text:"موتور راهنمای آفلاین بارگذاری نشده است.",source:"خطای بارگذاری",kind:"missing"};
  if(useAI){
    coachBusy=true;
    var buttons=Array.from(document.querySelectorAll("#coachChatForm button,[data-coach-question],#clearCoachChat"));
    buttons.forEach(b=>b.disabled=true);
    $("coachAIStatus").textContent="در حال دریافت پاسخ آنلاین…";
    try{
      var reply=await window.CRCBackendClient.askAI(window.CRCBetaSession,text,f,evidence,true,coachAICap);
      addCoachChatMessage("ai",reply.answer,reply.model+" · داده ارسالی تأییدنشده؛ پاسخ مولد ممکن است خطا داشته باشد");
      $("coachAIStatus").textContent="پاسخ آنلاین دریافت شد؛ ارسال بعدی نیاز به رضایت جدید دارد.";
      return;
    }catch(e){
      $("coachAIStatus").textContent="مربی آنلاین در دسترس نیست؛ پاسخ آفلاین ارائه شد.";
    }finally{
      coachBusy=false;
      buttons.forEach(b=>b.disabled=false);
    }
  }
  addCoachChatMessage("coach",result.text,result.source);
}
function setupCoachChat(){
  var form=$("coachChatForm");
  var input=$("coachChatQuestion");
  if(!form||!input)return;
  clearCoachChat();
  form.addEventListener("submit",function(event){
    event.preventDefault();
    var text=input.value.trim();
    if(!text)return;
    input.value="";
    askCoachChat(text);
    input.focus();
  });
  document.querySelectorAll("[data-coach-question]").forEach(function(button){
    button.addEventListener("click",function(){
      askCoachChat(button.getAttribute("data-coach-question"));
    });
  });
  $("clearCoachChat").addEventListener("click",clearCoachChat);
}

function renderCoach(){
renderOfflineCoach();
var f=calcFacts();
renderOwnedOptions();
if(f.errors.length){$("coachMetrics").innerHTML="";$("coachFindings").innerHTML='<div class="empty-panel"><span class="emoji">▦</span><strong>'+safe(f.errors.join(" "))+'</strong><p>ابتدا دک را در صفحه دک‌ساز کامل کن.</p><a class="btn ghost" href="#deck">رفتن به دک‌ساز</a></div>';$("coachProvenance").textContent="دک هنوز معتبر نیست.";return;}
var metrics=[["میانگین اکسیر",f.average],["هزینه ۴ کارت ارزان",f.cycle],["کارت‌های ۵ اکسیر یا بیشتر",f.expensive],["کارت‌های ۲ اکسیر یا کمتر",f.cheap]];
$("coachMetrics").innerHTML=metrics.map(function(p){return '<div class="metric"><span class="muted">'+safe(p[0])+'</span><span class="number">'+fmt(p[1])+'</span></div>';}).join("");
var info=findings(f);
$("coachFindings").innerHTML=info.length?info.map(function(x){return '<article class="finding"><div class="finding-top"><span class="chip gold">مشاهده</span><h3>'+safe(x.title)+'</h3></div><p>'+safe(x.text)+'</p><div class="evidence">کیفیت شواهد: '+safe(x.quality)+(x.evidence.length?" · کارت‌های مرتبط: "+safe(x.evidence.join("، ")):"")+'</div></article>';}).join(""):'<div class="finding"><h3>اطلاعات قطعی آماده‌اند</h3><p>در این دک هشدار مشروط بیشتری از قواعد اولیه پیدا نشد.</p></div>';
$("coachProvenance").textContent="منبع دک: "+(deckSource==="sample"?"داده نمونه":deckSource==="profile-import"?"فایل JSON رسمی واردشده (تأیید مالکیت انجام نشده)":deckSource==="manual"?"انتخاب دستی":deckSource==="profile-edited"?"فایل JSON با ویرایش دستی":deckSource==="profile-live"?"دک رسمی دریافت‌شده از Backend":deckSource==="battle-event-import"?"دک از Battle Log رویدادی":deckSource==="battle-import"?"دک از Battle Log":"داده نمونه")+" · موتور: deterministic-facts-0.2 · نقش‌های کارت‌ها: پیش‌نویس / بدون بازبینی تخصصی · بدون تحلیل ویدئو و بدون AI پولی · هیچ نتیجه‌ای به‌عنوان نرخ برد یا پیش‌بینی ارائه نمی‌شود.";
}
function renderCatalog(){
var q=$("cardSearch").value.trim().toLowerCase(),cst=$("cardCost").value;
var list=catalog.filter(function(c){if(q&&!c.name.toLowerCase().includes(q)&&!String(c.id).includes(q))return false;if(cst==="1-2"&&!(c.elixir>=1&&c.elixir<=2))return false;if(cst==="3-4"&&!(c.elixir>=3&&c.elixir<=4))return false;if(cst==="5+"&&!(c.elixir>=5))return false;return true;});
$("cardsGrid").innerHTML=list.map(function(c){return '<button type="button" class="catalog-card" data-card="'+c.id+'">'+(validIcon(c.icon)?'<img loading="lazy" src="'+safe(c.icon)+'" alt="">':'<span class="fallback-icon">'+safe(c.emoji||"🃏")+'</span>')+'<strong>'+safe(c.name)+'</strong><small>'+(c.elixir==null?"نامشخص":safe(c.elixir)+" اکسیر")+'</small></button>';}).join("")||'<div class="empty-panel">موردی پیدا نشد.</div>';
$("cardsGrid").querySelectorAll("[data-card]").forEach(function(b){b.addEventListener("click",function(){showModal(Number(b.dataset.card));});});
$("cardsSummary").textContent=list.length+" کارت از "+catalog.length+" مورد · نمونه اولیه و داده‌های اختیاری واردشده، نه بانک رسمی کامل.";
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
profileSource="file";liveFetchedAt=null;player=raw;mergeProfileCards(raw);renderProfile();renderCoach();if(battles)renderBattles();
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
  $("coachAIOptions").hidden=!coachAICap;
  $("coachAIConsent").checked=false;
  $("coachAIStatus").textContent=coachAICap?"مربی آنلاین در بتای خصوصی آماده است؛ حالت پیش‌فرض آفلاین.":"حالت آفلاین فعال است.";
  if(cap.live_lookup_enabled){
    betaLoginVisible(false);
    btn.disabled=false;btn.textContent="دریافت اطلاعات";
    status.textContent=window.CRCBetaSession?"بتای خصوصی آماده است؛ ورود با کد دعوت انجام شده و Player Tag اثبات مالکیت نیست.":"Backend آمادگی دریافت داده عمومی را اعلام کرده است. مالکیت حساب تأیید نمی‌شود.";
  }else{
    btn.disabled=true;btn.textContent="اتصال زنده در دسترس نیست";
    var needsLogin=!!(window.CRCBetaSession&&["INVITE_SESSION_REQUIRED","WORKER_ASSERTION_MISSING","WORKER_ASSERTION_INVALID","HTTP_401","HTTP_403"].includes(cap.reason));
    betaLoginVisible(needsLogin);
    var rateLimited=!!(window.CRCBetaSession&&["MEMBER_QUOTA_EXCEEDED","GLOBAL_QUOTA_EXCEEDED","HTTP_429"].includes(cap.reason));
    var notInvited=!!(window.CRCBetaSession&&cap.reason==="WORKER_ASSERTION_INVALID");
    status.textContent=needsLogin?"نشست بتای خصوصی منقضی یا نامعتبر است؛ با کد دعوت دوباره وارد شو.":rateLimited?"سهمیه موقت درخواست‌های بتا پر شده است؛ از ارسال مکرر درخواست خودداری کن.":notInvited?"این حساب برای بتای خصوصی دعوت نشده است.":"Backend زنده در این محیط فعال نیست؛ واردکردن فایل JSON همچنان در دسترس است.";
  }
}
async function loadProfileLive(){
  var btn=$("loadLivePlayer"),status=$("liveBackendStatus");
  var tag=tagFormat($("playerTag").value);
  if(!tag){status.textContent="ابتدا Player Tag معتبر وارد کن.";return;}
  if(!window.CRCBackendClient)return;
  btn.disabled=true;status.textContent="در حال دریافت پروفایل و نبردها از Backend...";
  try{
    var payload=await window.CRCBackendClient.loadPlayer(apiTransport(),tag);
    // Do not mutate local profile state until all mandatory response schemas are verified.
    player=payload.profile;profileSource="live";liveFetchedAt=payload.fetched_at;
    battles=payload.battles;battlesSource="live";
    mergeProfileCards(player);mergeBattleCards(battles);
    if(Array.isArray(player.currentDeck)&&player.currentDeck.length===8){
      var ids=player.currentDeck.map(function(c){return c.id;});
      if(ids.every(Number.isSafeInteger)&&new Set(ids).size===8)setDeck(ids,"profile-live",true);
    }
    renderProfile();renderCoach();renderBattles();renderCatalog();
    status.textContent=payload.partial?"پروفایل دریافت شد؛ بخشی از تاریخچه نبردها در دسترس نبود.":"اطلاعات عمومی دریافت شد؛ مالکیت حساب با Player Tag تأیید نمی‌شود.";
    notify("اطلاعات عمومی بازیکن از Backend دریافت شد.");
  }catch(e){
    status.textContent=(e&&e.message)||"اتصال به Backend ناموفق بود.";
    var loginNeeded=!!(window.CRCBetaSession&&e&&
      ["INVITE_SESSION_REQUIRED","WORKER_ASSERTION_MISSING","WORKER_ASSERTION_INVALID","HTTP_401","HTTP_403"].includes(e.code));
    betaLoginVisible(loginNeeded);
  }
  finally{refreshLiveAvailability();}
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
}
async function importBattles(file){
try{var raw=await parseFile(file);if(!Array.isArray(raw)||raw.some(function(b){return !b||typeof b!=="object";})||raw.length>200)throw Error("این فایل قالب معتبر Battle Log ندارد یا خیلی بزرگ است.");battles=raw;battlesSource="file";mergeBattleCards(raw);renderBattles();renderOfflineCoach();renderCatalog();notify(raw.length+" نبرد از فایل به‌صورت محلی خوانده شد.");}
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
  return '<div class="battle-row"><div><strong>'+safe(names)+'</strong><div class="sub">'+safe(battleDate(entry.raw_battle_time))+'</div></div><div class="result '+cls+'">'+safe(outcomeName)+' · '+safe(score)+'</div><div class="extra"><span class="chip '+(entry.classification==="event"?"gold":"")+'">'+safe(label)+'</span><div class="sub">اکسیر تلف‌شده گزارش‌شده: '+safe(entry.elixir_leaked==null?"نامشخص":fmt(entry.elixir_leaked))+(entry.attribution==="single_team_assumed"?" · بازیکن از عضو اول تیم فرض شده":entry.attribution==="unknown"?" · بازیکن شناسایی نشده":"")+'</div></div></div>';
}
function renderBattles(){
  if(!battles)return;
  var module=window.CRCBattleIntelligence;
  if(!module){$("battleList").textContent="ماژول تحلیل نبرد بارگذاری نشده است.";return;}
  var inputTag=player&&tagFormat(player.tag)||tagFormat($("playerTag").value);
  var report=module.summarize(battles,inputTag,$("battleFilter").value);
  var rows=report.entries;
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
function renderAll(){renderDeck();renderCoach();renderCatalog();}
function setupEvents(){
 document.querySelectorAll("[data-coach-jump]").forEach(function(button){button.addEventListener("click",function(){var target=$(button.dataset.coachJump);if(target){target.focus({preventScroll:true});target.scrollIntoView({block:"start",behavior:"auto"});}});});
setupCoachChat();
window.addEventListener("hashchange",function(){view(location.hash.slice(1));});
$("loadHeavy").addEventListener("click",function(){setDeck(predefined.heavy,"sample");});
$("loadHog").addEventListener("click",function(){setDeck(predefined.hog,"sample");});
$("clearDeck").addEventListener("click",function(){setDeck([null,null,null,null,null,null,null,null],"manual");});
$("analyzeDeck").addEventListener("click",function(){var e=deckErrors();if(e.length)notify(e.join(" "));else toPage("coach");});
$("refreshAnalysis").addEventListener("click",renderCoach);
$("copyDeck").addEventListener("click",async function(){var value=deck.filter(Boolean).join(",");if(!value){notify("دکی برای کپی وجود ندارد.");return;}try{await navigator.clipboard.writeText(value);notify("شناسه کارت‌ها کپی شد.");}catch(e){notify("مرورگر اجازه دسترسی به Clipboard را نداد.");}});
$("deckSearch").addEventListener("input",renderDeckLibrary);$("deckFilters").querySelectorAll("[data-filter]").forEach(function(btn){btn.addEventListener("click",function(){filter=btn.dataset.filter;$("deckFilters").querySelectorAll(".filter").forEach(function(el){el.classList.toggle("active",el===btn);});renderDeckLibrary();});});
$("cardSearch").addEventListener("input",renderCatalog);$("cardCost").addEventListener("change",renderCatalog);
$("closeModal").addEventListener("click",hideModal);$("cardModal").addEventListener("click",function(e){if(e.target===$("cardModal"))hideModal();});
window.addEventListener("keydown",function(e){if(e.key==="Escape")hideModal();});
$("modalToDeck").addEventListener("click",function(){var id=modalCard&&modalCard.id;hideModal();if(id){selectCard(id);toPage("deck");}});
$("loadLivePlayer").addEventListener("click",loadProfileLive);
$("checkTag").addEventListener("click",function(){var t=tagFormat($("playerTag").value);$("tagStatus").textContent=t?"قالب تگ معتبر است: "+t+(window.CRCBetaSession?" — دریافت آنلاین به نشست بتای خصوصی وابسته است.":" — اتصال زنده هنوز فعال نیست."):"قالب Player Tag معتبر نیست؛ تگ شامل حروف و عدد و در صورت نیاز # است.";});
$("profileFile").addEventListener("change",function(e){if(e.target.files[0])importProfile(e.target.files[0]);});
$("battlesFile").addEventListener("change",function(e){if(e.target.files[0])importBattles(e.target.files[0]);});
$("battleFilter").addEventListener("change",renderBattles);
$("playerTag").addEventListener("input",renderOfflineCoach);
$("coachBattleScope").addEventListener("change",renderOfflineCoach);
$("copyCoachEvidence").addEventListener("click",async function(){
  var engine=window.CRCOfflineCoach;
  var data=engine&&engine.evidence(
    battles,
    (player&&player.tag)||$("playerTag").value,
    $("coachBattleScope").value,
    deck
  );
  if(!data){
    notify("برای تهیه خلاصه آماری، Battle Log و Player Tag معتبر لازم است.");
    return;
  }
  try{
    await navigator.clipboard.writeText(JSON.stringify(data,null,2));
    notify("خلاصه آماری کپی شد؛ اطلاعات به سرور ارسال نشد.");
  }catch(e){
    notify("مرورگر اجازه کپی در کلیپ‌بورد را نداد.");
  }
});
}
async function init(){
try{var responses=await Promise.all([fetch("/catalog.json",{cache:"no-store"}),fetch("/guides.json",{cache:"no-store"})]);if(!responses[0].ok||!responses[1].ok)throw Error("assets");var data=await responses[0].json(),coaching=await responses[1].json();if(!data||!Array.isArray(data.cards)||!data.predefined||!coaching||!coaching.guides)throw Error("catalog");catalog=data.cards;predefined=data.predefined;guides=coaching.guides;var prev=readDeck();deck=prev&&prev.every(function(id){return !!getCard(id);})?prev.slice():predefined.heavy.slice();deckSource=prev?"manual":"sample";setupEvents();renderAll();view(location.hash.slice(1)||"home");refreshLiveAvailability();}catch(e){document.querySelectorAll(".page").forEach(function(p){p.classList.remove("active");});$("page-home").classList.add("active");$("page-home").insertAdjacentHTML("afterbegin",'<div class="notice"><strong>خطای بارگذاری بانک کارت‌های نمونه؛ صفحه را تازه‌سازی کن.</strong></div>');}}
init();
if(!window.CRCBetaSession && 'serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){});});}
})();
