(function(){
  "use strict";
  const form=document.getElementById("invite-form");
  const code=document.getElementById("invite-code");
  const button=document.getElementById("submit");
  const message=document.getElementById("message");
  if(!form||!code||!button||!message)return;
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    const invite=code.value.trim();
    if(invite.length<32||invite.length>128){message.textContent="کد دعوت معتبر نیست.";return;}
    button.disabled=true;message.textContent="در حال بررسی کد دعوت…";
    try{
      const response=await fetch("/api/v1/auth/login",{
        method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify({invite_code:invite})
      });
      const data=await response.json().catch(()=>null);
      if(!response.ok||!data||data.authenticated!==true){
        message.textContent="کد دعوت معتبر نیست یا دسترسی موقتاً ممکن نیست.";
        code.value="";code.focus();return;
      }
      location.replace("/");
    }catch(e){
      message.textContent="ارتباط برقرار نشد؛ دوباره تلاش کن.";
    }finally{button.disabled=false;}
  });
})();
