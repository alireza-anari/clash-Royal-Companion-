package com.crc.companion;

/** Not persisted; process death drops the entire sample. */
final class CaptureSession {
    static final CaptureBuffer BUFFER = new CaptureBuffer();
    private CaptureSession() {}
}
