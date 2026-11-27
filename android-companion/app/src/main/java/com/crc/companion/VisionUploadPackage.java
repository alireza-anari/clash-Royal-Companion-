package com.crc.companion;

import java.util.Base64;
import java.util.List;
import java.util.ArrayList;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Creates the bounded stage-15 API payload in memory only.
 * No HTTP client, upload, storage, billing or model invocation is implemented here.
 */
public final class VisionUploadPackage {
    public static final int MAX_FRAMES = 8;
    public static final int MAX_FRAME_BYTES = 256 * 1024;
    public static final int MAX_TOTAL_BYTES = 2 * 1024 * 1024;
    private static final Pattern ACCOUNT = Pattern.compile("^acct_[a-f0-9]{32}$");

    public static final class PreparedUpload {
        private final String requestId;
        private final String jsonBody;
        private final int frameCount;
        private final int totalBytes;
        private final List<Long> selectedTimes;
        private PreparedUpload(String id,String body,int count,int bytes,List<Long> times) {
            requestId=id;jsonBody=body;frameCount=count;totalBytes=bytes;selectedTimes=List.copyOf(times);
        }
        public String requestId(){return requestId;}
        /** Contains base64 image data. Keep in memory only; do not log or persist. */
        public String jsonBody(){return jsonBody;}
        public int frameCount(){return frameCount;}
        public int totalBytes(){return totalBytes;}
        public List<Long> selectedTimes(){return selectedTimes;}
        @Override public String toString(){return "PreparedUpload{requestId="+requestId+", frameCount="+frameCount+", totalBytes="+totalBytes+"}";}
    }

    private VisionUploadPackage() {}

    public static PreparedUpload build(CaptureBuffer buffer,AccountSession session,
                                        boolean uploadConsent,boolean externalAiConsent) {
        if(!uploadConsent||!externalAiConsent)throw new SecurityException("Both upload and external AI consent are required.");
        if(session==null||!session.isAuthenticated())throw new SecurityException("Account sign-in is required.");
        String subject=session.stableAccountSubject();
        String token=session.accessToken();
        if(subject==null||!ACCOUNT.matcher(subject).matches()||token==null||token.isBlank()||token.length()>8192)
            throw new SecurityException("A verified per-account mobile session is required.");
        if(buffer==null||buffer.summary().state()!=CaptureBuffer.State.READY)
            throw new IllegalStateException("Stop capture before preparing an upload.");
        List<Integer> indices=buffer.labIndices();
        if(indices.isEmpty()||indices.size()>MAX_FRAMES)
            throw new IllegalArgumentException("No bounded post-battle frames are available.");

        String id=UUID.randomUUID().toString();
        StringBuilder json=new StringBuilder(1024);
        json.append("{\"client_request_id\":\"").append(id)
            .append("\",\"consent_to_upload\":true,\"consent_to_external_ai\":true,\"frames\":[");
        int total=0;
        List<Long> times=new ArrayList<>();
        long previous=-1;
        for(int i=0;i<indices.size();i++){
            CaptureBuffer.Frame frame=buffer.frame(indices.get(i));
            if(frame==null)throw new IllegalStateException("Capture frame is no longer available.");
            byte[] jpeg=frame.jpeg();
            if(frame.atMs()<=previous||frame.atMs()<0||frame.atMs()>=CaptureBuffer.DURATION_MS||
               frame.width()<1||frame.height()<1||frame.width()>CaptureBuffer.MAX_SIDE||
               frame.height()>CaptureBuffer.MAX_SIDE||jpeg.length<4||jpeg.length>MAX_FRAME_BYTES||
               (jpeg[0]&255)!=255||(jpeg[1]&255)!=216||
               (jpeg[jpeg.length-2]&255)!=255||(jpeg[jpeg.length-1]&255)!=217)
                throw new IllegalArgumentException("Captured frame does not meet the upload contract.");
            previous=frame.atMs();times.add(previous);total+=jpeg.length;
            if(total>MAX_TOTAL_BYTES)throw new IllegalArgumentException("Upload exceeds the total image budget.");
            if(i>0)json.append(',');
            json.append("{\"at_ms\":").append(frame.atMs())
                .append(",\"mime\":\"image/jpeg\",\"width\":").append(frame.width())
                .append(",\"height\":").append(frame.height())
                .append(",\"data_base64\":\"")
                .append(Base64.getEncoder().encodeToString(jpeg)).append("\"}");
        }
        json.append("]}");
        // Account subject and bearer token are deliberately excluded from JSON.
        return new PreparedUpload(id,json.toString(),indices.size(),total,times);
    }
}
