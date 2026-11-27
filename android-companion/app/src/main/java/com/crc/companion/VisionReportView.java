package com.crc.companion;

import android.content.Context;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.List;
import java.util.Set;

/** Reusable post-battle report panel. Caller must verify account/job ownership before providing a result. */
public final class VisionReportView extends LinearLayout {
    public VisionReportView(Context context){
        super(context);setOrientation(VERTICAL);setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
    }
    private void line(String value,int size){
        TextView text=new TextView(getContext());text.setText(value);text.setTextSize(size);
        int p=(int)(8*getResources().getDisplayMetrics().density);
        text.setPadding(p,p,p,p);addView(text);
    }
    /** The expected frame timestamps must originate from the same trusted submission, never the response. */
    public void displayResult(Object result,List<Long> expectedTimes,Set<Integer> knownCardIds){
        removeAllViews();
        final VisionBattleReport.Report report;
        try{report=VisionBattleReport.parse(result,expectedTimes,knownCardIds);}
        catch(RuntimeException invalid){
            line("گزارش قابل تأیید نیست؛ داده‌ای نمایش داده نمی‌شود.",16);return;
        }
        renderReport(report);
    }
    /** Caller must authenticate the job response and use original submitted times. */
    public void displayJson(String result,List<Long> expectedTimes,Set<Integer> knownCardIds){
        removeAllViews();
        final VisionBattleReport.Report report;
        try{report=VisionReportJson.decode(result,expectedTimes,knownCardIds);}
        catch(RuntimeException invalid){line("گزارش قابل تأیید نیست؛ داده‌ای نمایش داده نمی‌شود.",16);return;}
        renderReport(report);
    }
    private void renderReport(VisionBattleReport.Report report){
        line("گزارش تصویری نبرد",22);
        line(VisionBattleReport.summaryFa(report),16);
        line("مشاهدات به تفکیک نمونه",18);
        for(var sample:report.samples())line(VisionBattleReport.sampleFa(sample),15);
        line("موضوع‌های پیشنهادی برای تمرین عمومی",18);
        for(String topic:VisionBattleReport.practiceTopicsFa(report))line(topic,15);
        line("این پیشنهادها تشخیص اشتباهات شخصی نیستند. برای تمرین اختصاصی از مربی آنلاین و اطلاعات واقعی حساب استفاده کن.",14);
    }
    public void clear(){removeAllViews();}
}
