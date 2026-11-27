package com.crc.companion;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.*;
import android.util.DisplayMetrics;
import android.view.WindowManager;
import java.io.ByteArrayOutputStream;

/** Foreground projection, started only with a fresh activity consent result. No networking. */
public final class CaptureService extends Service {
    static final String START="com.crc.companion.START", STOP="com.crc.companion.STOP", EXTRA="projection";
    private static final String CHANNEL="crc_capture";
    private static final int NOTIFICATION=41;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final CaptureBuffer buffer=CaptureSession.BUFFER;
    private MediaProjection projection;
    private VirtualDisplay display;
    private ImageReader reader;
    private int density, width, height;
    private long started, lastSample=-CaptureBuffer.INTERVAL_MS;
    private boolean running;
    private final Runnable deadline=()->end("limit");
    private final Runnable tick=new Runnable() {
        @Override public void run() {
            if(!running) return;
            long elapsed=SystemClock.elapsedRealtime()-started;
            if(elapsed>=CaptureBuffer.DURATION_MS){end("limit");return;}
            if(elapsed-lastSample>=CaptureBuffer.INTERVAL_MS && reader!=null) {
                NotificationManager nm=getSystemService(NotificationManager.class);
                NotificationChannel channel=nm.getNotificationChannel(CHANNEL);
                if(!nm.areNotificationsEnabled()||channel==null||channel.getImportance()==NotificationManager.IMPORTANCE_NONE){end("notification_denied");return;}
                try(Image image=reader.acquireLatestImage()) {
                    if(image!=null) {
                        byte[] bytes=encode(image);
                        CaptureBuffer.Add result=buffer.add(elapsed,width,height,bytes);
                        if(result==CaptureBuffer.Add.LIMIT){end("limit");return;}
                        if(result==CaptureBuffer.Add.INVALID){end("capture_error");return;}
                        if(result==CaptureBuffer.Add.ACCEPTED) {
                            lastSample=elapsed;
                            if(buffer.summary().count()>=CaptureBuffer.MAX_FRAMES){end("limit");return;}
                        }
                    }
                } catch(RuntimeException ex) {end("capture_error");return;}
            }
            if(running)handler.postDelayed(this,250);
        }
    };
    private final MediaProjection.Callback callback=new MediaProjection.Callback() {
        @Override public void onStop(){end("system_stop");}
        @Override public void onCapturedContentResize(int w,int h) {
            if(!running || display==null) return;
            try { resize(w,h); } catch(RuntimeException e) { end("capture_error"); }
        }
    };
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public int onStartCommand(Intent intent,int flags,int startId) {
        if(intent==null || STOP.equals(intent.getAction())) {end("user_stop");return START_NOT_STICKY;}
        if(!START.equals(intent.getAction()) || running) return START_NOT_STICKY;
        if(buffer.summary().state()!=CaptureBuffer.State.STARTING) {stopSelf();return START_NOT_STICKY;}
        Intent consent=intent.getParcelableExtra(EXTRA,Intent.class);
        // Never save or reuse the consent token.
        if(consent==null){end("permission_error");return START_NOT_STICKY;}
        try {
            NotificationManager nm=getSystemService(NotificationManager.class);
            nm.createNotificationChannel(new NotificationChannel(CHANNEL,"ثبت تصویر نبرد",NotificationManager.IMPORTANCE_LOW));
            if(!nm.areNotificationsEnabled() || nm.getNotificationChannel(CHANNEL).getImportance()==NotificationManager.IMPORTANCE_NONE) {
                end("notification_denied");return START_NOT_STICKY;
            }
            PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,CaptureService.class).setAction(STOP),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
            PendingIntent open=PendingIntent.getActivity(this,2,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
            Notification n=new Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.ic_menu_camera)
                .setContentTitle("CRC · ثبت تصویری فعال")
                .setContentText("فقط بازی را نمایش بده؛ برای پایان، توقف را بزن.")
                .setOngoing(true).setOnlyAlertOnce(true).setContentIntent(open)
                .addAction(new Notification.Action.Builder(null,"توقف ثبت",stop).build()).build();
            startForeground(NOTIFICATION,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            MediaProjectionManager manager=getSystemService(MediaProjectionManager.class);
            projection=manager.getMediaProjection(Activity.RESULT_OK,consent);
            if(projection==null)throw new IllegalStateException("projection");
            projection.registerCallback(callback,handler);
            WindowManager wm=getSystemService(WindowManager.class);
            android.graphics.Rect bounds=wm.getMaximumWindowMetrics().getBounds();
            density=getResources().getDisplayMetrics().densityDpi;
            int[] size=CaptureBuffer.dimensions(bounds.width(),bounds.height());
            width=size[0];height=size[1];
            reader=ImageReader.newInstance(width,height,PixelFormat.RGBA_8888,3);
            // One display per permission grant, resize in place on callback.
            display=projection.createVirtualDisplay("CRC local samples",width,height,density,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,reader.getSurface(),null,handler);
            if(display==null || !buffer.activate())throw new IllegalStateException("capture state");
            started=SystemClock.elapsedRealtime();lastSample=-CaptureBuffer.INTERVAL_MS;running=true;
            handler.postDelayed(deadline,CaptureBuffer.DURATION_MS);
            handler.post(tick);
        } catch(RuntimeException ex){end("permission_error");}
        return START_NOT_STICKY;
    }
    private void resize(int w,int h) {
        int[] size=CaptureBuffer.dimensions(w,h);
        if(size[0]==width && size[1]==height)return;
        ImageReader next=ImageReader.newInstance(size[0],size[1],PixelFormat.RGBA_8888,3);
        try {
            display.setSurface(null);
            display.resize(size[0],size[1],density);
            display.setSurface(next.getSurface());
        }catch(RuntimeException e){next.close();throw e;}
        ImageReader old=reader;reader=next;width=size[0];height=size[1];old.close();
    }
    private byte[] encode(Image image) {
        Image.Plane plane=image.getPlanes()[0];
        int pixel=plane.getPixelStride(),stride=plane.getRowStride();
        if(pixel!=4 || stride<width*4 || stride%4!=0 || stride/4>width+256)throw new IllegalStateException("stride");
        // The last row may lack padding. Copy each visible row without reading padding.
        java.nio.ByteBuffer src=plane.getBuffer();
        java.nio.ByteBuffer packed=java.nio.ByteBuffer.allocate(width*height*4);
        byte[] row=new byte[width*4];
        int base=src.position();
        for(int y=0;y<height;y++){
            long offset=(long)base+(long)y*stride;
            if(offset+row.length>src.limit())throw new IllegalStateException("image bounds");
            src.position((int)offset);src.get(row);packed.put(row);
        }
        packed.rewind();
        Bitmap bitmap=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888);
        try{
            bitmap.copyPixelsFromBuffer(packed);
            ByteArrayOutputStream output=new ByteArrayOutputStream();
            if(!bitmap.compress(Bitmap.CompressFormat.JPEG,80,output))throw new IllegalStateException("encode");
            return output.toByteArray();
        }finally{bitmap.recycle();}
    }
    private void end(String reason) {
        running=false;handler.removeCallbacksAndMessages(null);
        if(display!=null){try{display.release();}catch(RuntimeException ignored){}display=null;}
        if(reader!=null){try{reader.close();}catch(RuntimeException ignored){}reader=null;}
        MediaProjection p=projection;projection=null;
        if(p!=null){try{p.unregisterCallback(callback);}catch(RuntimeException ignored){}try{p.stop();}catch(RuntimeException ignored){}}
        buffer.finish(reason);stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();
    }
    @Override public void onTaskRemoved(Intent rootIntent){end("task_removed");buffer.discard();super.onTaskRemoved(rootIntent);}
    @Override public void onDestroy(){if(running || projection!=null || display!=null || reader!=null)end("system_stop");super.onDestroy();}
}
