package com.crc.companion;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.projection.MediaProjectionManager;
import android.os.*;
import android.view.*;
import android.widget.*;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/** Local post-battle preview and explicit read-only service check. No image upload or live coaching. */
public final class MainActivity extends Activity {
    private static final int NOTIFY=71, CONSENT=72;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final CaptureBuffer buffer=CaptureSession.BUFFER;
    private Button start,stop,clear,previous,next;
    private TextView status,frameLabel;
    private ImageView preview;
    private Bitmap shown;
    private int index=0, shownIndex=-1;
    private boolean permissionPending;
    private AndroidAccountSession accountSession;
    private OidcAuthClient oidcClient;
    private TextView accountStatus,visionStatus;
    private Button checkVision,nextSelected;
    private ProgressBar visionLoading;
    private final ExecutorService visionIo=Executors.newSingleThreadExecutor();
    private long visionGeneration;
    private boolean visionBusy,visible;
    private String checkedSubject;
    private final Runnable poll=new Runnable(){@Override public void run(){render();handler.postDelayed(this,500);}};
    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        permissionPending=saved!=null&&saved.getBoolean("pending");
        ScrollView scroll=new ScrollView(this);
        LinearLayout layout=new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);layout.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        int p=(int)(20*getResources().getDisplayMetrics().density);layout.setPadding(p,p,p,p);
        scroll.addView(layout);
        scroll.setOnApplyWindowInsetsListener((view,insets)->{
            android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());
            view.setPadding(bars.left,bars.top,bars.right,bars.bottom);return insets;
        });
        scroll.requestApplyInsets();
        TextView title=new TextView(this);title.setText("CRC Companion · ثبت نبرد");title.setTextSize(24);layout.addView(title);
        TextView intro=new TextView(this);intro.setText("نسخه آزمایشی · ثبت محلی، بدون ارسال تصاویر و بدون تحلیل زنده\nدر پنجره مجوز اندروید، فقط برنامه Clash Royale را انتخاب کن؛ گزینه کل صفحه را انتخاب نکن. برنامه نمی‌تواند انتخاب سیستم را خودش تأیید کند. اگر پنجره بازی در دسترس نیست، لغو کن. پس از شروع، به بازی برو و از اعلان ثبت برای توقف استفاده کن. هیچ صدا یا ویدیوی کامل ثبت نمی‌شود.");
        intro.setTextSize(16);layout.addView(intro);
        accountSession=new AndroidAccountSession(this);
        accountStatus=new TextView(this);accountStatus.setTextSize(14);
        accountStatus.setText(accountSession.isAuthenticated()?"حساب مستقل متصل است.":"برای اتصال حساب، ورود امن لازم است.");
        layout.addView(accountStatus);
        oidcClient=new OidcAuthClient(this,BuildConfig.CRC_BETA_BASE_URL,accountSession,accountStatus::setText,saved);
        button(layout,"ورود امن با حساب کاربری",v->{resetVision();oidcClient.start();});
        button(layout,"خروج از حساب",v->{resetVision();oidcClient.signOut();render();});
        start=button(layout,"شروع ثبت با مجوز اندروید",v->requestCapture());
        stop=button(layout,"توقف ثبت",v->stopCapture());
        clear=button(layout,"پاک کردن تصاویر",v->{if(buffer.discard()){index=0;forgetPreview();render();}});
        status=new TextView(this);status.setTextSize(16);status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);layout.addView(status);
        frameLabel=new TextView(this);layout.addView(frameLabel);
        previous=button(layout,"تصویر قبلی",v->{index=Math.max(0,index-1);render();});
        next=button(layout,"تصویر بعدی",v->{index=Math.min(buffer.summary().count()-1,index+1);render();});
        preview=new ImageView(this);preview.setAdjustViewBounds(true);preview.setContentDescription("نمونه تصویر ثبت‌شده، تحلیل نشده");layout.addView(preview,new LinearLayout.LayoutParams(-1,-2));
        nextSelected=button(layout,"نمایش نمونه بعدی منتخب",v->showNextSelected());
        TextView visionTitle=new TextView(this);visionTitle.setText("تحلیل تصویری پس از نبرد");
        visionTitle.setTextSize(20);layout.addView(visionTitle);
        TextView visionNote=new TextView(this);
        visionNote.setText("حداکثر ۸ تصویر منتخب را بررسی کن. نمونه‌ها ممکن است بخشی از نبرد را پوشش ندهند. بررسی وضعیت سرویس فقط به حساب متصل نیاز دارد و هیچ تصویری ارسال نمی‌کند.");
        layout.addView(visionNote);
        visionStatus=new TextView(this);visionStatus.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        visionStatus.setText("وضعیت سرویس هنوز بررسی نشده است.");layout.addView(visionStatus);
        visionLoading=new ProgressBar(this);visionLoading.setVisibility(View.GONE);
        layout.addView(visionLoading,new LinearLayout.LayoutParams(-2,-2));
        checkVision=button(layout,"بررسی وضعیت سرویس",v->checkVision());
        TextView creditNote=new TextView(this);
        creditNote.setText("اعتبار تحلیل: نامشخص\nارسال و گزارش تحلیل هنوز فعال نیستند.");
        layout.addView(creditNote);
        setContentView(scroll);render();
    }
    private Button button(LinearLayout parent,String text,View.OnClickListener action){
        Button b=new Button(this);b.setText(text);b.setOnClickListener(action);parent.addView(b);return b;
    }
    private void showNextSelected(){
        List<Integer> selected=buffer.labIndices();
        if(selected.isEmpty())return;
        int target=selected.get(0);
        for(int i:selected)if(i>index){target=i;break;}
        index=target;render();
    }
    private void resetVision(){
        visionGeneration++;visionBusy=false;checkedSubject=null;
        if(visionStatus!=null)visionStatus.setText("وضعیت سرویس هنوز بررسی نشده است.");
        if(visionLoading!=null)visionLoading.setVisibility(View.GONE);
    }
    private void checkVision(){
        if(!visible||visionBusy||!accountSession.isAuthenticated())return;
        CaptureBuffer.State state=buffer.summary().state();
        if(state==CaptureBuffer.State.CAPTURING||state==CaptureBuffer.State.STARTING||permissionPending)return;
        final String subject=accountSession.stableAccountSubject();
        if(subject==null)return;
        final long generation=++visionGeneration;
        checkedSubject=subject;visionBusy=true;
        visionStatus.setText("در حال بررسی وضعیت سرویس…");
        visionLoading.setVisibility(View.VISIBLE);render();
        visionIo.execute(()->{
            VisionCapability.State result;
            try{
                VisionApiClient client=new VisionApiClient(BuildConfig.CRC_BETA_BASE_URL,accountSession);
                VisionApiClient.Response response=client.capabilities(subject);
                JSONObject j=response.status()==200?new JSONObject(response.json()):new JSONObject();
                result=VisionCapability.classify(response.status(),j.opt("schema_version"),j.opt("enabled"),
                    j.opt("upload_enabled"),j.opt("analysis_enabled"),j.opt("credits_enabled"),
                    j.opt("account_identity_required"),j.opt("upload_consent_required"),j.opt("external_ai_consent_required"));
            }catch(Exception e){result=VisionCapability.State.UNAVAILABLE;}
            final VisionCapability.State stateResult=result;
            handler.post(()->{
                if(!visible||generation!=visionGeneration)return;
                if(!Objects.equals(subject,accountSession.stableAccountSubject())){resetVision();render();return;}
                visionBusy=false;visionLoading.setVisibility(View.GONE);
                visionStatus.setText(VisionCapability.message(stateResult));render();
            });
        });
    }
    private void requestCapture(){
        if(permissionPending || buffer.summary().state()!=CaptureBuffer.State.IDLE)return;
        resetVision();permissionPending=true;render();
        if(checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},NOTIFY);return;
        }
        askProjection();
    }
    private void askProjection(){
        try{
            if(!getSystemService(NotificationManager.class).areNotificationsEnabled()){
                permissionPending=false;render();Toast.makeText(this,"برای ثبت، اعلان توقف باید فعال باشد.",Toast.LENGTH_LONG).show();return;
            }
            MediaProjectionManager manager=getSystemService(MediaProjectionManager.class);
            startActivityForResult(manager.createScreenCaptureIntent(),CONSENT);
        }catch(RuntimeException e){permissionPending=false;render();Toast.makeText(this,"اشتراک صفحه در دسترس نیست.",Toast.LENGTH_LONG).show();}
    }
    @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] results){
        super.onRequestPermissionsResult(code,permissions,results);
        if(code!=NOTIFY)return;
        if(results.length==1 && results[0]==PackageManager.PERMISSION_GRANTED)askProjection();
        else {permissionPending=false;render();Toast.makeText(this,"بدون مجوز اعلان ثبت شروع نمی‌شود.",Toast.LENGTH_LONG).show();}
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(oidcClient!=null&&oidcClient.handleActivityResult(request,result,data))return;
        if(request!=CONSENT)return;
        permissionPending=false;
        if(result!=RESULT_OK || data==null){render();Toast.makeText(this,"اجازه ثبت صادر نشد.",Toast.LENGTH_SHORT).show();return;}
        if(!buffer.prepare()){render();return;}
        try {startForegroundService(new Intent(this,CaptureService.class).setAction(CaptureService.START).putExtra(CaptureService.EXTRA,data));}
        catch(RuntimeException ex){buffer.finish("permission_error");}
        render();
    }
    private void stopCapture(){
        try {startService(new Intent(this,CaptureService.class).setAction(CaptureService.STOP));}
        catch(RuntimeException ex){Toast.makeText(this,"از دکمه توقف اشتراک صفحه اندروید استفاده کن.",Toast.LENGTH_LONG).show();}
    }
    @Override protected void onSaveInstanceState(Bundle out){
        out.putBoolean("pending",permissionPending);
        if(oidcClient!=null)oidcClient.saveState(out);
        super.onSaveInstanceState(out);
    }
    @Override protected void onResume(){super.onResume();visible=true;handler.removeCallbacks(poll);handler.post(poll);}
    @Override protected void onPause(){visible=false;resetVision();handler.removeCallbacks(poll);forgetPreview();super.onPause();}
    @Override protected void onDestroy(){
        handler.removeCallbacks(poll);forgetPreview();
        visionIo.shutdownNow();
        if(oidcClient!=null)oidcClient.dispose();
        super.onDestroy();
    }
    private void forgetPreview(){
        if(preview!=null)preview.setImageDrawable(null);
        if(shown!=null){shown.recycle();shown=null;}shownIndex=-1;
    }
    private void render(){
        CaptureBuffer.Summary s=buffer.summary();
        boolean active=s.state()==CaptureBuffer.State.STARTING||s.state()==CaptureBuffer.State.CAPTURING;
        boolean ready=s.state()==CaptureBuffer.State.READY;
        start.setEnabled(!permissionPending&&s.state()==CaptureBuffer.State.IDLE);stop.setEnabled(active);
        clear.setEnabled(ready);previous.setEnabled(ready&&index>0);next.setEnabled(ready&&index<s.count()-1);
        if(checkedSubject!=null&&!Objects.equals(checkedSubject,accountSession.stableAccountSubject()))resetVision();
        checkVision.setEnabled(visible&&!visionBusy&&!active&&!permissionPending&&accountSession.isAuthenticated());
        nextSelected.setEnabled(ready&&!buffer.labIndices().isEmpty());
        String label=switch(s.state()){
            case STARTING->"در حال آغاز ثبت با مجوز سیستم";
            case CAPTURING->"● ثبت فعال؛ از اعلان سیستم می‌توانی متوقف کنی.";
            case READY->"ثبت پایان یافت؛ تصاویر فقط در حافظه همین برنامه‌اند.";
            case IDLE->permissionPending?"منتظر مجوز سیستم…":"آماده ثبت";
        };
        String reason=switch(s.reason()){
            case "limit"->" سقف ثبت رسید.";
            case "permission_error","notification_denied"->" ثبت با مجوز فعلی امکان‌پذیر نبود.";
            case "capture_error"->" خطای نمونه‌برداری؛ ثبت متوقف شد.";
            default->"";
        };
        status.setText(label+reason+"\n"+s.count()+" تصویر · "+(s.bytes()/1024)+" کیلوبایت\nحداکثر ۴ دقیقه، ۱۲۰ تصویر و ۲۴ مگابایت؛ فاصله هدف ۲ ثانیه.");
        if(!ready){forgetPreview();frameLabel.setText("");preview.setVisibility(View.GONE);return;}
        index=Math.max(0,Math.min(index,s.count()-1));
        CaptureBuffer.Frame f=buffer.frame(index);
        if(f==null){forgetPreview();preview.setVisibility(View.GONE);return;}
        if(shownIndex!=index || shown==null){
            forgetPreview();byte[] jpeg=f.jpeg();shown=BitmapFactory.decodeByteArray(jpeg,0,jpeg.length);
            if(shown!=null){preview.setImageBitmap(shown);shownIndex=index;}
        }
        preview.setVisibility(shown==null?View.GONE:View.VISIBLE);
        List<Integer> planned=buffer.labIndices();
        frameLabel.setText("تصویر "+(index+1)+" از "+s.count()+" · "+(f.atMs()/1000.0)+" ثانیه از ثبت\nبازه نمونه‌ها: "+(s.spanMs()/1000.0)+" ثانیه؛ بزرگ‌ترین فاصله: "+(s.largestGapMs()/1000.0)+" ثانیه.\n"+planned.size()+" تصویر برای ارزیابی آینده انتخاب شده‌اند. "+(planned.contains(index)?"این تصویر منتخب است.":"این تصویر منتخب نیست.")+" هیچ تصویری ارسال یا تحلیل نشده است.");
    }
}
