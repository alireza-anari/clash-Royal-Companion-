package com.crc.companion;

/** Read-only presentation state. Even an affirmative capability is not an upload authorization. */
public final class VisionCapability {
    public enum State { SIGN_IN, DISABLED, UNAVAILABLE, REPORTED_ENABLED }
    private VisionCapability(){}
    public static State classify(int status,Object schema,Object enabled,Object upload,Object analysis,
                                 Object credits,Object identity,Object uploadConsent,Object aiConsent){
        if(status==401)return State.SIGN_IN;
        if(status==403||status==503)return State.UNAVAILABLE;
        if(status!=200||!"1.0".equals(schema)||
            !(enabled instanceof Boolean)||!(upload instanceof Boolean)||
            !(analysis instanceof Boolean)||!(credits instanceof Boolean)||
            !Boolean.TRUE.equals(identity)||!Boolean.TRUE.equals(uploadConsent)||
            !Boolean.TRUE.equals(aiConsent))return State.UNAVAILABLE;
        if(Boolean.FALSE.equals(enabled))return State.DISABLED;
        if(Boolean.TRUE.equals(upload)&&Boolean.TRUE.equals(analysis)&&Boolean.TRUE.equals(credits))
            return State.REPORTED_ENABLED;
        return State.UNAVAILABLE;
    }
    public static String message(State state){
        return switch(state){
            case SIGN_IN -> "نشست حساب معتبر نیست؛ دوباره وارد شو.";
            case DISABLED -> "سرویس تحلیل تصویری هنوز فعال نیست.";
            case UNAVAILABLE -> "وضعیت سرویس قابل تأیید نیست؛ ارسال غیرفعال است.";
            case REPORTED_ENABLED -> "سرور قابلیت تحلیل را فعال گزارش کرده است؛ اعتبار و امکان ارسال هنوز تأیید نشده‌اند.";
        };
    }
}
