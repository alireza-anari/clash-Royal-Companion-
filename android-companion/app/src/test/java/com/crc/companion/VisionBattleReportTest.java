package com.crc.companion;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.*;

public class VisionBattleReportTest {
    private static final List<Long> TIMES=List.of(0L,2000L,4000L);
    private static final Set<Integer> IDS=Set.of(1,2);
    private Map<String,Object> observation(){
        Map<String,Object> m=new HashMap<>();
        m.put("screen","battle");m.put("game_clock_s",120);m.put("elixir",0);
        m.put("hand",List.of(1));
        m.put("units",List.of(Map.of("card_id",2,"x",0.4,"y",0.5,"side","opponent")));return m;
    }
    private Map<String,Object> entry(int at,String status,Object observation){
        Map<String,Object> m=new HashMap<>();
        m.put("at_ms",at);m.put("status",status);m.put("observation",observation);return m;
    }
    private Map<String,Object> run(List<?> results){
        Map<String,Object> m=new HashMap<>();
        m.put("version","crc-vision-lab-v1");m.put("model","@cf/google/gemma-4-26b-a4b-it");
        m.put("replay_analyzed",false);m.put("selected",List.of(0,2000,4000));
        m.put("calls",results.size());m.put("results",results);return m;
    }
    private void rejects(Object raw){
        try{VisionBattleReport.parse(raw,TIMES,IDS);fail("Accepted invalid result");}
        catch(IllegalArgumentException expected){}
    }
    @Test public void partialRunMarksMissingFramesAndDoesNotTreatZeroAsUnknown(){
        var report=VisionBattleReport.parse(run(List.of(entry(0,"unverified",observation()),entry(2000,"provider_error",null))),TIMES,IDS);
        assertEquals(2,report.processed());assertEquals(1,report.battleFrames());
        assertEquals(1,report.elixirReads());assertEquals(Integer.valueOf(0),report.samples().get(0).elixir());
        assertEquals("not_processed",report.samples().get(2).status());
        assertTrue(VisionBattleReport.summaryFa(report).contains("تأییدنشده"));
        assertTrue(VisionBattleReport.sampleFa(report.samples().get(0)).contains("اکسیر: 0"));
        assertEquals(2,VisionBattleReport.practiceTopicsFa(report).size());
    }
    @Test public void rejectsUnexpectedEvidenceAndSchema(){
        var m=run(List.of(entry(0,"unverified",observation())));
        m.put("replay_analyzed",true);rejects(m);
        m=run(List.of(entry(2000,"unverified",observation())));rejects(m);
        m=run(List.of(entry(0,"invalid_output",observation())));rejects(m);
        m=run(List.of(entry(0,"provider_error",null),entry(2000,"unverified",observation())));rejects(m);
        var o=observation();o.put("hand",List.of(99));rejects(run(List.of(entry(0,"unverified",o))));
        o=observation();o.put("screen","other");rejects(run(List.of(entry(0,"unverified",o))));
        o=observation();o.put("elixir",11);rejects(run(List.of(entry(0,"unverified",o))));
        o=observation();o.put("tactical_mistake","invented");rejects(run(List.of(entry(0,"unverified",o))));
        m=run(List.of(entry(0,"unverified",observation())));m.put("calls",2);rejects(m);
        try{VisionBattleReport.parse(run(List.of(entry(0,"unverified",observation()))),List.of(0L,2001L,4000L),IDS);fail();}
        catch(IllegalArgumentException expected){}
    }
    @Test public void unknownFramesDoNotProducePersonalizedDiagnoses(){
        var o=observation();o.put("screen","unknown");o.put("game_clock_s",null);o.put("elixir",null);
        o.put("hand",List.of());o.put("units",List.of());
        var report=VisionBattleReport.parse(run(List.of(entry(0,"unverified",o))),TIMES,IDS);
        assertEquals(0,report.battleFrames());assertEquals(0,report.clockReads());
        assertEquals(1,VisionBattleReport.practiceTopicsFa(report).size());
        assertFalse(VisionBattleReport.sampleFa(report.samples().get(0)).contains("اکسیر:"));
        assertTrue(VisionBattleReport.coachPromptFa().contains("اطلاعات واقعی حسابم"));
    }
}
