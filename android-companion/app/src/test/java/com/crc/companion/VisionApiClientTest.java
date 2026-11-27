package com.crc.companion;

import org.junit.Test;
import static org.junit.Assert.*;

public class VisionApiClientTest {
    static class Session implements AccountSession {
        String subject="acct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        boolean signedIn=true;
        public boolean isAuthenticated(){return signedIn;}
        public String stableAccountSubject(){return subject;}
        public String accessToken(){return "test.token.signature";}
    }
    @Test public void restrictsGatewayAndJobRoutes(){
        assertEquals("https://example.test",VisionApiClient.normalizeBase("https://example.test/"));
        for(String url:new String[]{"http://example.test","https://user@example.test","https://example.test/api",
            "https://example.test?x=1","https://example.test/#x",""}){
            try{VisionApiClient.normalizeBase(url);fail(url);}catch(IllegalArgumentException expected){}
        }
        String id="123e4567-e89b-42d3-a456-426614174000";
        assertEquals("/api/v1/vision/jobs/"+id,VisionApiClient.jobPath(id));
        for(String invalid:new String[]{"../capabilities",id+"?x=1",id+"/",id.toUpperCase(),"shared"}){
            try{VisionApiClient.jobPath(invalid);fail(invalid);}catch(IllegalArgumentException expected){}
        }
    }
    private CaptureBuffer ready(){
        CaptureBuffer b=new CaptureBuffer();b.prepare();b.activate();
        byte[] jpeg={(byte)255,(byte)216,1,2,(byte)255,(byte)217};
        assertEquals(CaptureBuffer.Add.ACCEPTED,b.add(0,180,320,jpeg));
        b.finish("user_stop");return b;
    }
    @Test public void blocksChangedAccountAndMissingConsentBeforeNetwork()throws Exception{
        Session session=new Session();
        VisionApiClient client=new VisionApiClient("https://example.test",session);
        VisionApiClient.Attempt attempt=client.prepare(ready(),true,true);
        assertEquals(1,attempt.frameCount());
        assertFalse(attempt.toString().contains("data_base64"));
        try{client.submit(attempt,false,true);fail();}catch(SecurityException expected){}
        try{client.submit(attempt,true,false);fail();}catch(SecurityException expected){}
        session.subject="acct_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        try{client.submit(attempt,true,true);fail();}catch(SecurityException expected){}
        try{client.status("123e4567-e89b-42d3-a456-426614174000","acct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");fail();}
        catch(SecurityException expected){}
        session.signedIn=false;
        try{client.capabilities();fail();}catch(SecurityException expected){}
    }
    @Test public void responseDebugStringDoesNotExposePayload(){
        assertEquals("Vision response: HTTP 200",new VisionApiClient.Response(200,"sensitive").toString());
    }
}
