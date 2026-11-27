package com.crc.companion;

/** Android Keystore-backed account session. No Player Tag is used as identity. */
public final class AndroidAccountSession implements AccountSession {
    private final OidcSessionStore store;
    public AndroidAccountSession(android.content.Context context){store=new OidcSessionStore(context);}
    @Override public boolean isAuthenticated(){OidcSessionStore.Session s=store.read();return s!=null&&s.valid();}
    @Override public String stableAccountSubject(){OidcSessionStore.Session s=store.read();return s!=null&&s.valid()?s.accountSubject:null;}
    @Override public String accessToken(){OidcSessionStore.Session s=store.read();return s!=null&&s.valid()?s.accessToken:null;}
    void save(String subject,String token,long expiresInSeconds){store.save(subject,token,expiresInSeconds);}
    void clear(){store.clear();}
}
