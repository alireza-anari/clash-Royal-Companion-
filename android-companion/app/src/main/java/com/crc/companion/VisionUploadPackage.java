package com.crc.companion;

import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.List;
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
        private PreparedUpload(String id,String body,int count,int bytes) {
            requestId=id;jsonBody=body;frameCount=count;totalBytes=bytes;
        }
        public String requestId(){return requestId;}
        /** Contains base64 image data. Keep in memory only; do not log or persist. */
        public String jsonBody(){return jsonBody;}
        public int frameCount(){return frameCount;}
        public int totalBytes(){return totalBytes;}
        @Override public String toString(){return "PreparedUpload{requestId="+requestId+", frameCount="+frameCount+", totalBytes="+totalBytes+"}";}
    }

    private VisionUploadPackage() {}

    public static PreparedUpload build(CaptureBuffer buffer,AccountSession session,
                                        boolean uploadConsent,boolean externalAiConsent)
            throws JSONException {
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

        JSONArray frames=new JSONArray();
        int total=0;
        long previous=-1;
        for(int index:indices){
            CaptureBuffer.Frame frame=buffer.frame(index);
            if(frame==null)throw new IllegalStateException("Capture frame is no longer available.");
            byte[] jpeg=frame.jpeg();
            if(frame.atMs()<=previous||frame.atMs()<0||frame.atMs()>=CaptureBuffer.DURATION_MS||
               frame.width()<1||frame.height()<1||frame.width()>CaptureBuffer.MAX_SIDE||
               frame.height()>CaptureBuffer.MAX_SIDE||jpeg.length<4||jpeg.length>MAX_FRAME_BYTES||
               (jpeg[0]&255)!=255||(jpeg[1]&255)!=216||
               (jpeg[jpeg.length-2]&255)!=255||(jpeg[jpeg.length-1]&255)!=217)
                throw new IllegalArgumentException("Captured frame does not meet the upload contract.");
            previous=frame.atMs();total+=jpeg.length;
            if(total>MAX_TOTAL_BYTES)throw new IllegalArgumentException("Upload exceeds the total image budget.");
            JSONObject item=new JSONObject();
            item.put("at_ms",frame.atMs());
            item.put("mime","image/jpeg");
            item.put("width",frame.width());
            item.put("height",frame.height());
            item.put("data_base64",Base64.encodeToString(jpeg,Base64.NO_WRAP));
            frames.put(item);
        }
        String id=UUID.randomUUID().toString();
        JSONObject body=new JSONObject();
        body.put("client_request_id",id);
        body.put("consent_to_upload",true);
        body.put("consent_to_external_ai",true);
        body.put("frames",frames);
        // The account subject and access token are deliberately excluded from JSON.
        return new PreparedUpload(id,body.toString(),indices.size(),total);
    }
}
