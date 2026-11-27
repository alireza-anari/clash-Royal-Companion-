package com.crc.companion;

import org.junit.Test;
import static org.junit.Assert.*;
import static com.crc.companion.VisionCapability.State.*;

public class VisionCapabilityTest {
    private VisionCapability.State classify(int status,Object schema,Object enabled,Object upload,Object analysis,Object credits){
        return VisionCapability.classify(status,schema,enabled,upload,analysis,credits,true,true,true);
    }
    @Test public void knownGatewayDisabledResponseIsNotAnAuthorization(){
        assertEquals(DISABLED,classify(200,"1.0",false,false,false,false));
        assertEquals(SIGN_IN,classify(401,null,null,null,null,null));
        assertEquals(UNAVAILABLE,classify(403,null,null,null,null,null));
        assertEquals(UNAVAILABLE,classify(503,null,null,null,null,null));
    }
    @Test public void malformedOrPartialCapabilitiesFailClosed(){
        assertEquals(UNAVAILABLE,classify(200,"1.0","true",true,true,true));
        assertEquals(UNAVAILABLE,classify(200,"2.0",true,true,true,true));
        assertEquals(UNAVAILABLE,classify(200,"1.0",true,true,false,true));
        assertEquals(UNAVAILABLE,classify(200,"1.0",true,true,true,null));
        assertEquals(UNAVAILABLE,VisionCapability.classify(200,"1.0",true,true,true,true,false,true,true));
        assertEquals(UNAVAILABLE,VisionCapability.classify(200,"1.0",true,true,true,true,true,true,false));
    }
    @Test public void affirmativeFlagsAreOnlyReportedNotPermissionOrBalance(){
        assertEquals(REPORTED_ENABLED,classify(200,"1.0",true,true,true,true));
        assertTrue(VisionCapability.message(REPORTED_ENABLED).contains("تأیید نشده‌اند"));
    }
}
