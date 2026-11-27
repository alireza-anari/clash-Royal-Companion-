package com.crc.companion;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import net.openid.appauth.AuthorizationException;
import net.openid.appauth.AuthorizationRequest;
import net.openid.appauth.AuthorizationResponse;
import net.openid.appauth.AuthorizationService;
import net.openid.appauth.AuthorizationServiceConfiguration;
import net.openid.appauth.ResponseTypeValues;
import net.openid.appauth.TokenResponse;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** OIDC Authorization Code + PKCE client. Tokens are exchanged at the same-origin private gateway. */
public final class OidcAuthClient {
    public static final int REQUEST_CODE=73;
    public interface Listener { void onStatus(String message); }
    private final Activity activity;
    private final String baseUrl;
    private final AndroidAccountSession session;
    private final Listener listener;
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private final Handler main=new Handler(Looper.getMainLooper());
    private AuthorizationService authorizationService;
    private String nonceToken;

    public OidcAuthClient(Activity activity,String baseUrl,AndroidAccountSession session,
                          Listener listener,Bundle savedState){
        this.activity=activity;this.baseUrl=normalizeBaseUrl(baseUrl);
        this.session=session;this.listener=listener;
        if(savedState!=null)nonceToken=savedState.getString("oidc_nonce_token");
    }

    public void start(){
        if(baseUrl==null){status("ورود آنلاین هنوز پیکربندی نشده است.");return;}
        status("در حال دریافت تنظیمات ورود امن…");
        io.execute(()->{
            try{
                JSONObject config=requestJson("GET","/api/v1/auth/oidc/config",null);
                if(!config.optBoolean("enabled",false)||!config.optBoolean("pkce_required",false)||
                   !config.optBoolean("nonce_required",false)||!"code".equals(config.optString("response_type")))
                    throw new IllegalStateException();
                JSONObject nonce=requestJson("POST","/api/v1/auth/oidc/nonce",new JSONObject());
                String value=nonce.getString("nonce"),signed=nonce.getString("nonce_token");
                if(value.length()<32||signed.length()<100||signed.length()>4096)throw new IllegalStateException();
                nonceToken=signed;
                main.post(()->beginAuthorization(config,value));
            }catch(Exception e){status("ورود در حال حاضر در دسترس نیست؛ تنظیمات سرویس را بررسی کن.");}
        });
    }

    private void beginAuthorization(JSONObject config,String nonce){
        try{
            String issuer=config.getString("issuer");
            String clientId=config.getString("client_id");
            Uri redirect=Uri.parse(config.getString("redirect_uri"));
            if(!"com.crc.companion".equals(redirect.getScheme())||
               !"/oauth2redirect".equals(redirect.getPath())||!redirect.toString().equals("com.crc.companion:/oauth2redirect"))
                throw new IllegalArgumentException();
            AuthorizationServiceConfiguration.fetchFromIssuer(Uri.parse(issuer),(serviceConfig,exception)->{
                if(exception!=null||serviceConfig==null){status("اتصال به ارائه‌دهنده ورود برقرار نشد.");return;}
                try{
                    String verifier=randomVerifier();
                    String challenge=challenge(verifier);
                    AuthorizationRequest request=new AuthorizationRequest.Builder(
                        serviceConfig,clientId,ResponseTypeValues.CODE,redirect)
                        .setScopes("openid","profile")
                        .setNonce(nonce)
                        .setCodeVerifier(verifier,challenge,"S256")
                        .build();
                    authorizationService=new AuthorizationService(activity);
                    status("صفحه ورود امن باز می‌شود…");
                    activity.startActivityForResult(authorizationService.getAuthorizationRequestIntent(request),REQUEST_CODE);
                }catch(Exception e){status("شروع ورود امن امکان‌پذیر نشد.");}
            });
        }catch(Exception e){status("تنظیمات OIDC معتبر نیست.");}
    }

    public boolean handleActivityResult(int requestCode,int resultCode,Intent data){
        if(requestCode!=REQUEST_CODE)return false;
        AuthorizationException exception=AuthorizationException.fromIntent(data);
        AuthorizationResponse response=AuthorizationResponse.fromIntent(data);
        if(exception!=null||response==null){
            nonceToken=null;status("ورود لغو شد یا ارائه‌دهنده آن را نپذیرفت.");return true;
        }
        if(authorizationService==null)authorizationService=new AuthorizationService(activity);
        status("در حال تأیید هویت حساب…");
        authorizationService.performTokenRequest(response.createTokenExchangeRequest(),(tokenResponse,tokenError)->{
            if(tokenError!=null||tokenResponse==null||tokenResponse.idToken==null){
                nonceToken=null;status("دریافت شناسه معتبر از ارائه‌دهنده ناموفق بود.");return;
            }
            final String idToken=tokenResponse.idToken,proof=nonceToken;
            nonceToken=null;
            io.execute(()->exchangeIdentity(idToken,proof));
        });
        return true;
    }

    private void exchangeIdentity(String idToken,String proof){
        try{
            if(proof==null||proof.length()<100)throw new IllegalStateException();
            JSONObject body=new JSONObject().put("id_token",idToken).put("nonce_token",proof);
            JSONObject result=requestJson("POST","/api/v1/auth/oidc/exchange",body);
            String subject=result.getString("account_subject");
            String access=result.getString("access_token");
            long expires=result.getLong("expires_in");
            session.save(subject,access,expires);
            status("ورود موفق بود؛ حساب مستقل و امن متصل شد.");
        }catch(Exception e){status("تأیید حساب ناموفق بود؛ دوباره تلاش کن.");}
    }

    public void signOut(){session.clear();status("از حساب خارج شدی.");}
    public void saveState(Bundle out){if(nonceToken!=null)out.putString("oidc_nonce_token",nonceToken);}
    public void dispose(){
        if(authorizationService!=null){authorizationService.dispose();authorizationService=null;}
        io.shutdownNow();
    }

    private JSONObject requestJson(String method,String path,JSONObject body)throws Exception{
        if(baseUrl==null||!path.matches("^/api/v1/auth/oidc/(?:config|nonce|exchange)$"))throw new IllegalArgumentException();
        HttpURLConnection connection=(HttpURLConnection)new URL(baseUrl+path).openConnection();
        connection.setRequestMethod(method);connection.setConnectTimeout(5000);connection.setReadTimeout(8000);
        connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);
        connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("Connection","close");
        // No browser cookies or caller Authorization headers are ever attached.
        if(body!=null){
            byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);
            if(bytes.length>16*1024)throw new IllegalArgumentException();
            connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");
            try(OutputStream output=connection.getOutputStream()){output.write(bytes);}
        }
        try{
            int code=connection.getResponseCode();
            InputStream input=code>=200&&code<300?connection.getInputStream():connection.getErrorStream();
            if(input==null)throw new IllegalStateException();
            byte[] bytes=readBounded(input,16*1024);
            if(code!=200)throw new IllegalStateException();
            return new JSONObject(new String(bytes,StandardCharsets.UTF_8));
        }finally{connection.disconnect();}
    }

    private static byte[] readBounded(InputStream input,int limit)throws Exception{
        try(InputStream source=input;ByteArrayOutputStream output=new ByteArrayOutputStream()){
            byte[] buffer=new byte[2048];int count,total=0;
            while((count=source.read(buffer))!=-1){total+=count;if(total>limit)throw new IllegalArgumentException();output.write(buffer,0,count);}
            return output.toByteArray();
        }
    }
    private static String randomVerifier(){
        byte[] bytes=new byte[32];new SecureRandom().nextBytes(bytes);
        return Base64.encodeToString(bytes,Base64.URL_SAFE|Base64.NO_PADDING|Base64.NO_WRAP);
    }
    private static String challenge(String verifier)throws Exception{
        byte[] digest=MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
        return Base64.encodeToString(digest,Base64.URL_SAFE|Base64.NO_PADDING|Base64.NO_WRAP);
    }
    private static String normalizeBaseUrl(String value){
        try{
            if(value==null||value.isBlank())return null;
            URI uri=URI.create(value.trim());
            if(!"https".equals(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null||
               uri.getQuery()!=null||uri.getFragment()!=null||!(uri.getPath().isEmpty()||"/".equals(uri.getPath())))return null;
            return "https://"+uri.getRawAuthority();
        }catch(Exception e){return null;}
    }
    private void status(String message){main.post(()->listener.onStatus(message));}
}
