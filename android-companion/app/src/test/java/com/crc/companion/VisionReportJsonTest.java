package com.crc.companion;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Set;

public class VisionReportJsonTest {
    private String fixture()throws Exception{
        try(InputStream in=getClass().getResourceAsStream("/vision-worker-result-v1.json")){
            assertNotNull(in);return new String(in.readAllBytes(),StandardCharsets.UTF_8);
        }
    }
    @Test public void decodesSharedWorkerResult()throws Exception{
        var report=VisionReportJson.decode(fixture(),List.of(0L),Set.of(1,2));
        assertEquals(1,report.processed());assertEquals(1,report.battleFrames());
        assertEquals(Integer.valueOf(120),report.samples().get(0).clock());
        assertEquals(Integer.valueOf(5),report.samples().get(0).elixir());
        assertEquals(List.of(1),report.samples().get(0).hand());
        assertEquals(1,report.samples().get(0).visibleUnits());
    }
    @Test public void rejectsMalformedAndUnboundInput()throws Exception{
        String json=fixture();
        for(String invalid:new String[]{json+"{}",json.replace("120","301"),json.replace("false","true"),
            "[".repeat(20)+"0"+"]".repeat(20)," ".repeat(65537),json.replace("\"hand\": [","\"hand\": null,\"extra\": [")}){
            try{VisionReportJson.decode(invalid,List.of(0L),Set.of(1,2));fail();}
            catch(IllegalArgumentException expected){}
        }
        try{VisionReportJson.decode(json,List.of(2000L),Set.of(1,2));fail();}
        catch(IllegalArgumentException expected){}
        try{VisionReportJson.decode(json,List.of(0L),Set.of(1));fail();}
        catch(IllegalArgumentException expected){}
    }
}
