package com.crc.companion;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.List;
public class CaptureBufferTest {
    private byte[] jpeg(int n){byte[] b=new byte[n];b[0]=(byte)255;b[1]=(byte)216;b[n-2]=(byte)255;b[n-1]=(byte)217;return b;}
    @Test public void consentStateAndNoReviewUntilStop(){
        CaptureBuffer b=new CaptureBuffer();
        assertFalse(b.activate());assertTrue(b.prepare());assertFalse(b.prepare());assertTrue(b.activate());
        assertEquals(CaptureBuffer.Add.ACCEPTED,b.add(0,180,320,jpeg(12)));
        assertNull(b.frame(0));assertFalse(b.discard());assertEquals(List.of(),b.labIndices());
        b.finish("user_stop");assertEquals(CaptureBuffer.State.READY,b.summary().state());
        assertNotNull(b.frame(0));assertFalse(b.prepare());assertTrue(b.discard());assertNull(b.frame(0));assertEquals(0,b.summary().bytes());
    }
    @Test public void intervalLimitsAndPlan(){
        CaptureBuffer b=new CaptureBuffer();b.prepare();b.activate();
        assertEquals(CaptureBuffer.Add.ACCEPTED,b.add(0,180,320,jpeg(12)));
        assertEquals(CaptureBuffer.Add.SKIP,b.add(1999,180,320,jpeg(12)));
        for(int i=1;i<120;i++)assertEquals(CaptureBuffer.Add.ACCEPTED,b.add(i*2000,180,320,jpeg(12)));
        assertEquals(CaptureBuffer.Add.LIMIT,b.add(240000,180,320,jpeg(12)));
        b.finish("limit");assertEquals(120,b.summary().count());
        assertEquals(238000,b.summary().spanMs());assertEquals(2000,b.summary().largestGapMs());
        assertEquals(8,b.labIndices().size());assertEquals(Integer.valueOf(0),b.labIndices().get(0));assertEquals(Integer.valueOf(119),b.labIndices().get(7));
    }
    @Test public void byteBudgetAndInvalidFrames(){
        CaptureBuffer b=new CaptureBuffer();b.prepare();b.activate();
        assertEquals(CaptureBuffer.Add.INVALID,b.add(0,321,320,jpeg(12)));
        assertEquals(CaptureBuffer.Add.INVALID,b.add(0,180,320,new byte[12]));
        assertEquals(CaptureBuffer.Add.INVALID,b.add(0,180,320,jpeg(262145)));
        for(int i=0;i<96;i++)assertEquals(CaptureBuffer.Add.ACCEPTED,b.add(i*2000,180,320,jpeg(262144)));
        assertEquals(CaptureBuffer.Add.LIMIT,b.add(192000,180,320,jpeg(12)));
        b.finish("limit");assertEquals(24*1024*1024,b.summary().bytes());
    }
    @Test public void frameCopiesAndGaps(){
        CaptureBuffer b=new CaptureBuffer();b.prepare();b.activate();
        byte[] image=jpeg(12);b.add(0,180,320,image);image[0]=0;
        assertEquals(CaptureBuffer.Add.INVALID,b.add(-1,180,320,jpeg(12)));
        b.add(6000,180,320,jpeg(12));b.finish("system_stop");
        assertEquals(6000,b.summary().largestGapMs());assertEquals(255,b.frame(0).jpeg()[0]&255);
        byte[] copy=b.frame(0).jpeg();copy[0]=0;assertEquals(255,b.frame(0).jpeg()[0]&255);
    }
    @Test public void resizeAndAbortedConsent(){
        assertArrayEquals(new int[]{180,320},CaptureBuffer.dimensions(1080,1920));
        assertArrayEquals(new int[]{320,180},CaptureBuffer.dimensions(1920,1080));
        assertArrayEquals(new int[]{100,200},CaptureBuffer.dimensions(100,200));
        CaptureBuffer b=new CaptureBuffer();b.prepare();b.finish("permission_error");
        assertEquals(CaptureBuffer.State.IDLE,b.summary().state());assertTrue(b.prepare());
    }
}
