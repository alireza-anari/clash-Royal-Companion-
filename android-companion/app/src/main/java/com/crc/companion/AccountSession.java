package com.crc.companion;

/**
 * Implement only with a real per-user OIDC/device session.
 * The current shared private-beta browser subject and Player Tag are not account identities.
 */
public interface AccountSession {
    boolean isAuthenticated();
    String stableAccountSubject();
    /** Short-lived account-scoped bearer token; never persist or log it in this interface. */
    String accessToken();
}
