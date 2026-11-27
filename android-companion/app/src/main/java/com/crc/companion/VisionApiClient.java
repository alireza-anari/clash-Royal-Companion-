package com.crc.companion;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.URL;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;
import javax.net.ssl.HttpsURLConnection;

/** Stage 17: account-bound, bounded HTTPS transport. No automatic submission or retry. */
public final class VisionApiClient {
    private static final String ROOT="/api/v1/vision/";
    private static final int MAX_REQUEST=3*1024*1024, MAX_RESPONSE=256*1024;
    private static final Pattern SUBJECT=Pattern.compile("^acct_[a-f0-9]{32}$");
    private static final Pattern JOB=Pattern.compile("^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$");
    private final String base;
    private final AccountSession session;

    public record Response(int status,String json) {
        @Override public String toString(){return "Vision response: HTTP "+status;}
    }
    /** Holds sensitive image data in memory only. Reuse the same request ID if reconciling an ambiguous submission. */
    public static final class Attempt {
        private final String subject;
        private final VisionUploadPackage.PreparedUpload payload;
        private Attempt(String subject,VisionUploadPackage.PreparedUpload payload){
            this.subject=subject;this.payload=payload;
        }
        public String requestId(){return payload.requestId();}
        public int frameCount(){return payload.frameCount();}
        public int totalBytes(){return payload.totalBytes();}
        @Override public String toString(){return "Vision attempt: "+payload.requestId();}
    }

    public VisionApiClient(String baseUrl,AccountSession session){
        this.base=normalizeBase(baseUrl);
        this.session=session;
        if(session==null)throw new IllegalArgumentException("Account session required");
    }
    static String normalizeBase(String value){
        if(value==null||value.isBlank())throw new IllegalArgumentException("Gateway not configured");
        URI uri=URI.create(value.trim());
        if(!"https".equals(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null||
            uri.getRawQuery()!=null||uri.getRawFragment()!=null||
            !(uri.getRawPath().isEmpty()||"/".equals(uri.getRawPath())))
            throw new IllegalArgumentException("HTTPS gateway origin required");
        return "https://"+uri.getRawAuthority();
    }
    static String jobPath(String id){
        if(id==null||!JOB.matcher(id).matches())throw new IllegalArgumentException("Invalid job identifier");
        return ROOT+"jobs/"+id;
    }
    private String subject(){
        String s=session.stableAccountSubject();
        if(!session.isAuthenticated()||s==null||!SUBJECT.matcher(s).matches())
            throw new SecurityException("Sign-in required");
        return s;
    }
    public Attempt prepare(CaptureBuffer buffer,boolean uploadConsent,boolean aiConsent){
        String s=subject();
        VisionUploadPackage.PreparedUpload payload=VisionUploadPackage.build(buffer,session,uploadConsent,aiConsent);
        if(!s.equals(subject()))throw new SecurityException("Account changed");
        return new Attempt(s,payload);
    }
    public Response capabilities()throws Exception{return capabilities(subject());}
    public Response capabilities(String expectedSubject)throws Exception{
        return request("GET",ROOT+"capabilities",expectedSubject,null);
    }
    /** Call only after a fresh capabilities check and explicit user confirmation. Never retries. */
    public Response submit(Attempt attempt,boolean uploadConsent,boolean aiConsent)throws Exception{
        if(attempt==null||!uploadConsent||!aiConsent)throw new SecurityException("Both consents required");
        return request("POST",ROOT+"jobs",attempt.subject,attempt.payload.jsonBody());
    }
    public Response status(String jobId,String expectedSubject)throws Exception{
        return request("GET",jobPath(jobId),expectedSubject,null);
    }
    public Response cancel(String jobId,String expectedSubject)throws Exception{
        return request("DELETE",jobPath(jobId),expectedSubject,null);
    }
    private Response request(String method,String path,String expectedSubject,String body)throws Exception{
        if(!subject().equals(expectedSubject))throw new SecurityException("Account changed");
        String token=session.accessToken();
        if(token==null||token.isBlank()||token.length()>8185||!token.matches("[A-Za-z0-9._~-]+")||
            !subject().equals(expectedSubject))throw new SecurityException("Invalid account session");
        byte[] bytes=body==null?null:body.getBytes(StandardCharsets.UTF_8);
        if(bytes!=null&&bytes.length>MAX_REQUEST)throw new IllegalArgumentException("Request too large");
        HttpsURLConnection connection=(HttpsURLConnection)new URL(base+path).openConnection();
        try{
            connection.setRequestMethod(method);
            connection.setConnectTimeout(8000);connection.setReadTimeout(15000);
            connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);
            connection.setRequestProperty("Accept","application/json");
            connection.setRequestProperty("Authorization","Bearer "+token);
            connection.setRequestProperty("Origin",base);
            connection.setRequestProperty("Cache-Control","no-store");
            connection.setRequestProperty("Connection","close");
            if(bytes!=null){
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type","application/json");
                connection.setFixedLengthStreamingMode(bytes.length);
                try(OutputStream out=connection.getOutputStream()){out.write(bytes);}
            }
            int status=connection.getResponseCode();
            if(status>=300&&status<400)throw new IllegalStateException("Unexpected redirect");
            InputStream input=status>=400?connection.getErrorStream():connection.getInputStream();
            String json="";
            if(input!=null){
                try(InputStream in=input;ByteArrayOutputStream out=new ByteArrayOutputStream()){
                    byte[] chunk=new byte[4096];int n,total=0;
                    while((n=in.read(chunk))!=-1){
                        total+=n;if(total>MAX_RESPONSE)throw new IllegalStateException("Response too large");
                        out.write(chunk,0,n);
                    }
                    json=out.toString(StandardCharsets.UTF_8.name());
                }
            }
            if(!subject().equals(expectedSubject))throw new SecurityException("Account changed");
            return new Response(status,json);
        }finally{connection.disconnect();}
    }
}
