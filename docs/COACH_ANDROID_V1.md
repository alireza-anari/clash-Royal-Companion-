# Android Companion capture alpha — stage 14

An isolated native Java Android project at android-companion/. No website/Worker changes, no production deployment or account integration. Android 14+ (API 34 minimum; compile/target 35 for this internal alpha), AGP 8.9.2, Gradle 8.11.1 and JDK 17. Debug-only CI artifact, not a Play Store release. No Gradle wrapper is bundled; use the documented Gradle version locally or Android Studio. Store target API and distribution policy must be checked at release.

## Flow
1. Open the companion, enable the notification permission and select Start. Android's system MediaProjection picker requires fresh consent for every capture. Choose the Clash Royale app window, not entire screen. The OS may offer entire-screen sharing; this prototype cannot inspect/verify the selected app. Cancel if app-only selection is unavailable. The app itself uses FLAG_SECURE to avoid recording its own preview.
2. A non-exported mediaProjection foreground service starts with a persistent stop notification before acquiring the projection. No audio, camera, INTERNET, external storage, accessibility, overlays, boot receivers, automation or direct game-client integration. No automatic start after reboot/process death, no hidden capture. Stop via app, notification, or system screen-sharing control.
3. ImageReader samples JPEG frames at a target interval of 2 seconds, maximum side 320px, JPEG quality 80; one virtual display per fresh grant; resize existing surface on system content-size callback. In-memory cap 120 frames, 24 MiB JPEG data, 256 KiB/frame and 240 elapsed seconds. Memory overhead is additional. Actual interval, coverage and battery use depend on device; no measured power claim. OS can suspend or terminate process; no guaranteed hard real-time deadline.
4. Only after stopping, inspect frames and choose previous/next. Show observed span/gaps, and choose up to eight uniform sample indices compatible with the stage-13 lab time/dimension contract. The frames are not submitted to the lab, not a replay, and not analyzed. Clear drops references; process death also drops data. No permanent files. Removing app task stops and discards when Android delivers the callback. Java memory is not secure-erased; avoid capturing sensitive information.

## Verification
Dedicated PR workflow compiles debug APK and runs JVM tests covering state, sample cadence, duration/count/byte limits, validation, resize dimensions, copying, gaps and 8-frame plan. No emulator/device or real game capture test in CI yet. Before any release: test actual consent denial, permission revocation, notification visibility, task switching, screen lock, rotation, resize, system stop, task removal, low memory/process kill, color conversion, real Clash Royale app-only capture, battery and frame fidelity on supported devices. Test private data accidentally shown; add reviewed redaction/consent before upload. MediaProjection may blank protected content; do not bypass protections.

## References
- https://developer.android.com/media/grow/media-projection
- https://developer.android.com/develop/background-work/services/fgs/service-types
- https://developer.android.com/build/releases/agp-8-9-0-release-notes
- https://supercell.com/en/fan-content-policy/ (review before distribution and paid coaching; no game modification or live tactical assist).

Next: native device validation and an independently reviewed, separately consented post-battle vision upload/analysis path with per-user identity, credits, retention and deletion. iOS ReplayKit feasibility is a separate task. No billing or production model adapter activated.
