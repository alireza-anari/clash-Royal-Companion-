package com.crc.companion;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.regex.Pattern;

/** Encrypted, device-local storage for the short-lived app access token only. */
final class OidcSessionStore {
    private static final String ALIAS="crc.companion.oidc.session.v1";
    private static final String PREFS="crc_oidc_session";
    private static final Pattern ACCOUNT=Pattern.compile("^acct_[a-f0-9]{32}$");
    private final SharedPreferences preferences;

    static final class Session {
        final String accountSubject,accessToken;
        final long expiresAtMillis;
        Session(String subject,String token,long expires){accountSubject=subject;accessToken=token;expiresAtMillis=expires;}
        boolean valid(){return System.currentTimeMillis()<expiresAtMillis;}
    }

    OidcSessionStore(Context context){
        preferences=context.getApplicationContext().getSharedPreferences(PREFS,Context.MODE_PRIVATE);
    }

    synchronized void save(String subject,String token,long expiresInSeconds){
        if(subject==null||!ACCOUNT.matcher(subject).matches()||token==null||token.isBlank()||
           token.length()>8192||expiresInSeconds<60||expiresInSeconds>900)
            throw new IllegalArgumentException("Invalid short-lived account session.");
        try{
            JSONObject json=new JSONObject();
            json.put("account_subject",subject);
            json.put("access_token",token);
            json.put("expires_at",System.currentTimeMillis()+expiresInSeconds*1000L-30_000L);
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE,key());
            byte[] encrypted=cipher.doFinal(json.toString().getBytes(StandardCharsets.UTF_8));
            preferences.edit()
                .putString("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP))
                .putString("data",Base64.encodeToString(encrypted,Base64.NO_WRAP))
                .apply();
        }catch(Exception e){
            clear();
            throw new IllegalStateException("Secure account storage is unavailable.");
        }
    }

    synchronized Session read(){
        String ivText=preferences.getString("iv",null),dataText=preferences.getString("data",null);
        if(ivText==null||dataText==null)return null;
        try{
            byte[] iv=Base64.decode(ivText,Base64.NO_WRAP);
            byte[] encrypted=Base64.decode(dataText,Base64.NO_WRAP);
            if(iv.length!=12||encrypted.length<32||encrypted.length>16_384)throw new IllegalArgumentException();
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,iv));
            JSONObject json=new JSONObject(new String(cipher.doFinal(encrypted),StandardCharsets.UTF_8));
            String subject=json.getString("account_subject"),token=json.getString("access_token");
            long expires=json.getLong("expires_at");
            if(!ACCOUNT.matcher(subject).matches()||token.isBlank()||token.length()>8192||expires<=System.currentTimeMillis()){
                clear();return null;
            }
            return new Session(subject,token,expires);
        }catch(Exception e){
            clear();return null;
        }
    }

    synchronized void clear(){preferences.edit().clear().apply();}

    private SecretKey key() throws Exception{
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if(store.containsAlias(ALIAS))return (SecretKey)store.getKey(ALIAS,null);
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,
            KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build());
        return generator.generateKey();
    }
}
