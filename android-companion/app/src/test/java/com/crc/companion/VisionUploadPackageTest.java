package com.crc.companion;

import org.junit.Test;
import static org.junit.Assert.*;
import android.util.Base64;
import org.json.JSONObject;
import org.json.JSONArray;
import java.nio.charset.StandardCharsets;

public class VisionUploadPackageTest {
    private static final String SUBJECT="acct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final String TOKEN="short-lived-test-access-token-not-real";
    private static final class Session implements AccountSession {
        final boolean authenticated;final String subject,token;
        Session(boolean a,String s,String t){authenticated=a;subject=s;token=t;}
        public boolean isAuthenticated(){return authenticated;}
        public String stableAccountSubject(){return subject;}
        public String accessToken(){return token;}
    }
    private byte[] jpeg(int n){byte[] b=new byte[n];b[0]=(byte)255;b[1]=(byte)216;b[n-2]=(byte)255;b[n-1]=(byte)217;return b;}
    private CaptureBuffer ready(int count){
        CaptureBuffer b=new CaptureBuffer();b.prepare();b.activate();
        for(int i=0;i<count;i++)assertEquals(CaptureBuffer.Add.ACCEPTED,b.add(i*2000,180,320,jpeg(32)));
        b.finish("user_stop");return b;
    }
    @Test public void requiresExplicitConsentsAndRealAccountSession(){
        CaptureBuffer b=ready(2);
        try{VisionUploadPackage.build(b,new Session(true,SUBJECT,TOKEN),false,true);fail();}
        catch(SecurityException expected){}
        try{VisionUploadPackage.build(b,new Session(true,SUBJECT,TOKEN),true,false);fail();}
        catch(SecurityException expected){}
        try{VisionUploadPackage.build(b,new Session(false,SUBJECT,TOKEN),true,true);fail();}
        catch(SecurityException expected){}
        for(String subject:new String[]{"shared-beta-subject","#ABC123","acct_not_hex"}){
            try{VisionUploadPackage.build(b,new Session(true,subject,TOKEN),true,true);fail();}
            catch(SecurityException expected){}
        }
        try{VisionUploadPackage.build(b,new Session(true,SUBJECT,""),true,true);fail();}
        catch(SecurityException expected){}
    }
    @Test public void buildsOnlyBoundedPostBattleManifestAndNeverEmbedsAccountCredentials() throws Exception {
        CaptureBuffer b=ready(120);
        VisionUploadPackage.PreparedUpload result=VisionUploadPackage.build(b,new Session(true,SUBJECT,TOKEN),true,true);
        assertEquals(8,result.frameCount());assertEquals(8*32,result.totalBytes());
        assertFalse(result.jsonBody().contains(SUBJECT));assertFalse(result.jsonBody().contains(TOKEN));
        JSONObject root=new JSONObject(result.jsonBody());
        assertEquals(result.requestId(),root.getString("client_request_id"));
        assertTrue(root.getBoolean("consent_to_upload"));assertTrue(root.getBoolean("consent_to_external_ai"));
        JSONArray frames=root.getJSONArray("frames");assertEquals(8,frames.length());
        long previous=-1;
        for(int i=0;i<frames.length();i++){
            JSONObject frame=frames.getJSONObject(i);
            assertEquals("image/jpeg",frame.getString("mime"));
            assertTrue(frame.getLong("at_ms")>previous);previous=frame.getLong("at_ms");
            byte[] decoded=Base64.decode(frame.getString("data_base64"),Base64.NO_WRAP);
            assertEquals(32,decoded.length);assertEquals(255,decoded[0]&255);
        }
        assertFalse(result.toString().contains("data_base64"));
    }
    @Test public void refusesActiveOrMissingCapture(){
        CaptureBuffer active=new CaptureBuffer();active.prepare();active.activate();
        try{VisionUploadPackage.build(active,new Session(true,SUBJECT,TOKEN),true,true);fail();}
        catch(IllegalStateException expected){}
        try{VisionUploadPackage.build(new CaptureBuffer(),new Session(true,SUBJECT,TOKEN),true,true);fail();}
        catch(IllegalStateException expected){}
    }
}
