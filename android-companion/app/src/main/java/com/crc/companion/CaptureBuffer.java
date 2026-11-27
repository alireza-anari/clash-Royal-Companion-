package com.crc.companion;

import java.util.ArrayList;
import java.util.List;

/** Process-memory only. All calls synchronized; no account, files, network or gameplay inference. */
public final class CaptureBuffer {
    public static final long DURATION_MS = 240_000L, INTERVAL_MS = 2_000L;
    public static final int MAX_FRAMES = 120, MAX_BYTES = 24 * 1024 * 1024;
    public static final int MAX_FRAME_BYTES = 256 * 1024, MAX_SIDE = 320, MAX_LAB_FRAMES = 8;
    public enum State { IDLE, STARTING, CAPTURING, READY }
    public enum Add { ACCEPTED, SKIP, LIMIT, INVALID }
    public record Summary(State state, int count, int bytes, long spanMs, long largestGapMs, String reason) {}
    public record Frame(long atMs, int width, int height, byte[] jpeg) {
        public Frame { jpeg = jpeg.clone(); }
        @Override public byte[] jpeg() { return jpeg.clone(); }
    }
    private State state = State.IDLE;
    private String reason = "";
    private int bytes;
    private final ArrayList<Frame> frames = new ArrayList<>();
    public synchronized boolean prepare() {
        if (state != State.IDLE || !frames.isEmpty()) return false;
        state = State.STARTING; reason = ""; return true;
    }
    public synchronized boolean activate() {
        if (state != State.STARTING) return false;
        state = State.CAPTURING; return true;
    }
    public synchronized Add add(long atMs, int width, int height, byte[] jpeg) {
        if (state != State.CAPTURING) return Add.INVALID;
        if (atMs >= DURATION_MS || frames.size() >= MAX_FRAMES) return Add.LIMIT;
        if (atMs < 0 || width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE ||
            jpeg == null || jpeg.length < 4 || jpeg.length > MAX_FRAME_BYTES ||
            (jpeg[0] & 255) != 255 || (jpeg[1] & 255) != 216 ||
            (jpeg[jpeg.length-2] & 255) != 255 || (jpeg[jpeg.length-1] & 255) != 217) return Add.INVALID;
        if (!frames.isEmpty()) {
            long delta = atMs - frames.get(frames.size()-1).atMs();
            if (delta < 0) return Add.INVALID;
            if (delta < INTERVAL_MS) return Add.SKIP;
        }
        if (bytes + jpeg.length > MAX_BYTES) return Add.LIMIT;
        frames.add(new Frame(atMs,width,height,jpeg)); bytes += jpeg.length; return Add.ACCEPTED;
    }
    public synchronized void finish(String why) {
        if (state != State.STARTING && state != State.CAPTURING) return;
        reason = why; state = frames.isEmpty() ? State.IDLE : State.READY;
    }
    public synchronized boolean discard() {
        if (state == State.STARTING || state == State.CAPTURING) return false;
        frames.clear(); bytes = 0; reason = ""; state = State.IDLE; return true;
    }
    public synchronized Summary summary() {
        long span = 0, gap = 0;
        if (frames.size() > 1) {
            span = frames.get(frames.size()-1).atMs() - frames.get(0).atMs();
            for (int i=1;i<frames.size();i++) gap=Math.max(gap,frames.get(i).atMs()-frames.get(i-1).atMs());
        }
        return new Summary(state,frames.size(),bytes,span,gap,reason);
    }
    public synchronized Frame frame(int index) {
        return state == State.READY && index >= 0 && index < frames.size() ? frames.get(index) : null;
    }
    /** Indices for the existing offline vision lab; not an upload or detection. */
    public synchronized List<Integer> labIndices() {
        if (state != State.READY || frames.isEmpty()) return List.of();
        int n=Math.min(MAX_LAB_FRAMES,frames.size());
        ArrayList<Integer> indices=new ArrayList<>();
        if(n==1) return List.of(0);
        for(int i=0;i<n;i++) indices.add((int)Math.round((double)i*(frames.size()-1)/(n-1)));
        return List.copyOf(indices);
    }
    public static int[] dimensions(int width,int height) {
        if(width<=0 || height<=0) throw new IllegalArgumentException("Invalid capture size");
        double scale=Math.min(1.0,(double)MAX_SIDE/Math.max(width,height));
        return new int[]{Math.max(1,(int)Math.round(width*scale)),Math.max(1,(int)Math.round(height*scale))};
    }
}
