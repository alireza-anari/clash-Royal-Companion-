package com.crc.companion;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Stage 18: strict offline renderer for the documented Worker result, not the job API envelope. */
public final class VisionBattleReport {
    private static final String VERSION="crc-vision-lab-v1";
    private static final Set<String> MODELS=Set.of("@cf/google/gemma-4-26b-a4b-it","@cf/qwen/qwen3.8-27b");
    public record Sample(long atMs,String status,String screen,Integer clock,Integer elixir,
                         List<Integer> hand,int visibleUnits) {}
    public record Report(List<Sample> samples,int processed,int battleFrames,int clockReads,int elixirReads) {}
    private VisionBattleReport(){}
    private static IllegalArgumentException invalid(){return new IllegalArgumentException("Invalid vision result");}
    private static Map<?,?> object(Object value,String... keys){
        if(!(value instanceof Map<?,?> m)||!m.keySet().equals(Set.of(keys)))throw invalid();
        return m;
    }
    private static List<?> list(Object value,int max){
        if(!(value instanceof List<?> a)||a.size()>max)throw invalid();
        return a;
    }
    private static int integer(Object value,int min,int max){
        if(!(value instanceof Number n)||!Double.isFinite(n.doubleValue())||
           n.doubleValue()!=Math.rint(n.doubleValue())||n.doubleValue()<min||n.doubleValue()>max)throw invalid();
        return n.intValue();
    }
    private static Integer optionalInt(Object value,int min,int max){return value==null?null:integer(value,min,max);}
    private static String choice(Object value,String... choices){
        if(!(value instanceof String s)||!Set.of(choices).contains(s))throw invalid();
        return s;
    }
    private static double coordinate(Object value){
        if(!(value instanceof Number n)||!Double.isFinite(n.doubleValue())||n.doubleValue()<0||n.doubleValue()>1)throw invalid();
        return n.doubleValue()==0?0:n.doubleValue();
    }
    private static int card(Object value,Set<Integer> ids){
        int id=integer(value,1,1000000000);
        if(!ids.contains(id))throw invalid();
        return id;
    }
    public static Report parse(Object raw,List<Long> expectedTimes,Set<Integer> knownCardIds){
        if(expectedTimes==null||expectedTimes.isEmpty()||expectedTimes.size()>8||knownCardIds==null||
           knownCardIds.isEmpty()||knownCardIds.size()>400)throw invalid();
        Set<Integer> ids=Set.copyOf(knownCardIds);
        Map<?,?> root=object(raw,"version","model","selected","calls","results","replay_analyzed");
        if(!VERSION.equals(root.get("version"))||!(root.get("model") instanceof String model)||!MODELS.contains(model)||
           !Boolean.FALSE.equals(root.get("replay_analyzed")))throw invalid();
        List<?> selected=list(root.get("selected"),8),results=list(root.get("results"),8);
        if(selected.size()!=expectedTimes.size()||results.isEmpty()||results.size()>selected.size()||
           integer(root.get("calls"),1,8)!=results.size())throw invalid();
        List<Sample> samples=new ArrayList<>();
        int battles=0,clocks=0,elixirs=0;long previous=-1;
        for(int i=0;i<selected.size();i++){
            long at=integer(selected.get(i),0,239999);
            if(at<=previous||expectedTimes.get(i)==null||expectedTimes.get(i)!=at)throw invalid();
            previous=at;
            if(i>=results.size()){
                samples.add(new Sample(at,"not_processed","unknown",null,null,List.of(),0));continue;
            }
            Map<?,?> entry=object(results.get(i),"at_ms","status","observation");
            if(integer(entry.get("at_ms"),0,239999)!=at)throw invalid();
            String status=choice(entry.get("status"),"unverified","invalid_output","provider_error");
            if(!status.equals("unverified")){
                if(entry.get("observation")!=null||status.equals("provider_error")&&i!=results.size()-1)throw invalid();
                samples.add(new Sample(at,status,"unknown",null,null,List.of(),0));continue;
            }
            Map<?,?> observation=object(entry.get("observation"),"screen","game_clock_s","elixir","hand","units");
            String screen=choice(observation.get("screen"),"battle","other","unknown");
            Integer clock=optionalInt(observation.get("game_clock_s"),0,300),elixir=optionalInt(observation.get("elixir"),0,10);
            List<Integer> hand=new ArrayList<>();
            for(Object value:list(observation.get("hand"),4)){
                int id=card(value,ids);if(hand.contains(id))throw invalid();hand.add(id);
            }
            List<?> units=list(observation.get("units"),12);
            Set<List<?>> distinct=new HashSet<>();
            for(Object value:units){
                Map<?,?> unit=object(value,"card_id","x","y","side");
                int id=card(unit.get("card_id"),ids);
                double x=coordinate(unit.get("x")),y=coordinate(unit.get("y"));
                String side=choice(unit.get("side"),"player","opponent","unknown");
                if(!distinct.add(List.of(id,x,y,side)))throw invalid();
            }
            if(!screen.equals("battle")&&(clock!=null||elixir!=null||!hand.isEmpty()||!units.isEmpty()))throw invalid();
            if(screen.equals("battle"))battles++;
            if(clock!=null)clocks++;
            if(elixir!=null)elixirs++;
            samples.add(new Sample(at,status,screen,clock,elixir,List.copyOf(hand),units.size()));
        }
        return new Report(List.copyOf(samples),results.size(),battles,clocks,elixirs);
    }
    public static String summaryFa(Report report){
        return "مشاهدات تصویری آزمایشی — تأییدنشده\n"+
            report.processed()+" از "+report.samples().size()+" نمونه بررسی شده‌اند.\n"+
            report.battleFrames()+" نمونه به‌عنوان صفحه نبرد گزارش شده‌اند.\n"+
            "زمان بازی در "+report.clockReads()+" نمونه و اکسیر در "+report.elixirReads()+" نمونه خوانده شده است.\n"+
            "این اعداد دقت مدل یا نتیجه نبرد نیستند. تصاویر پراکنده‌اند؛ بازپخش کامل تحلیل نشده است.";
    }
    public static String sampleFa(Sample sample){
        String state=switch(sample.status()){
            case "not_processed"->"بررسی نشده";
            case "invalid_output"->"خروجی نامعتبر";
            case "provider_error"->"خطای پردازش";
            default->switch(sample.screen()){case "battle"->"صفحه نبرد احتمالی";case "other"->"صفحه دیگر";default->"صفحه نامشخص";};
        };
        String text="زمان از شروع ثبت: "+sample.atMs()/1000.0+" ثانیه — "+state;
        if(!sample.status().equals("unverified")||!sample.screen().equals("battle"))return text;
        return text+"\nزمان بازی: "+(sample.clock()==null?"خوانده نشد":sample.clock()+" ثانیه")+
            " · اکسیر: "+(sample.elixir()==null?"خوانده نشد":sample.elixir())+
            "\nکارت‌های دست گزارش‌شده: "+sample.hand().size()+" · واحدهای گزارش‌شده: "+sample.visibleUnits()+
            " (تأییدنشده)";
    }
    /** Fixed generic practice prompts, not personalized diagnoses or automatic AI requests. */
    public static List<String> practiceTopicsFa(Report report){
        if(report.battleFrames()==0)return List.of("ابتدا مطمئن شو نمونه‌ها صفحه نبرد را نشان می‌دهند.");
        return List.of("برای تمرین، روش مدیریت اکسیر را از مربی بپرس.",
            "برای تمرین، نقش کارت‌های دک و زمان مناسب استفاده از آن‌ها را مرور کن.");
    }
    public static String coachPromptFa(){
        return "با توجه به دک و اطلاعات واقعی حسابم، یک تمرین ساده برای مدیریت اکسیر و زمان استفاده از کارت‌ها پیشنهاد بده. درباره اشتباهات نبرد تصویری ادعای تأییدنشده نکن.";
    }
}
