package com.grandddlc.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

/**
 * Foreground service that keeps music playing with the screen off and shows a proper
 * Android media notification: cover art, seek bar, like, previous / play-pause / next and close.
 * It also receives headphone / Bluetooth buttons through its MediaSession.
 */
public class PlaybackService extends Service {

    static final String ACTION_UPDATE = "com.grandddlc.music.UPDATE";
    static final String ACTION_PREV = "com.grandddlc.music.PREV";
    static final String ACTION_TOGGLE = "com.grandddlc.music.TOGGLE";
    static final String ACTION_NEXT = "com.grandddlc.music.NEXT";
    static final String ACTION_LIKE = "com.grandddlc.music.LIKE";
    static final String ACTION_CLOSE = "com.grandddlc.music.CLOSE";
    private static final String CHANNEL = "playback";
    private static final int ID = 4107;

    /** What's playing — written by the plugin, read here. */
    static final class NowPlaying {
        String title = "", artist = "", album = "";
        long duration = 0, position = 0;
        boolean playing = false, liked = false;
        Bitmap art = null;
    }
    static final NowPlaying STATE = new NowPlaying();

    static PlaybackService instance;
    private MediaSessionCompat session;
    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Now playing", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            ch.setSound(null, null);
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
        session = new MediaSessionCompat(this, "Music");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { optimistic(true); send("play"); }
            @Override public void onPause() { optimistic(false); send("pause"); }
            @Override public void onSkipToNext() { send("next"); }
            @Override public void onSkipToPrevious() { send("prev"); }
            @Override public void onStop() { send("close"); }
            @Override public void onSeekTo(long pos) {
                STATE.position = pos;
                refresh();
                if (MediaLibraryPlugin.instance != null) MediaLibraryPlugin.instance.sendSeek(pos);
            }
            @Override public void onCustomAction(String action, android.os.Bundle extras) {
                if ("like".equals(action)) send("like");
                if ("close".equals(action)) send("close");
            }
        });
        session.setActive(true);
    }

    /** Flip the button at once so the notification reacts instantly; the app confirms a moment later. */
    private void optimistic(boolean playing) {
        STATE.playing = playing;
        refresh();
    }

    /** Keep the CPU awake only while music is actually playing. */
    private void updateWakeLock() {
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Music:playback");
                wakeLock.setReferenceCounted(false);
            }
            if (STATE.playing) wakeLock.acquire(4 * 60 * 60 * 1000L);
            else if (wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) { }
    }

    private void send(String action) {
        if (MediaLibraryPlugin.instance != null) MediaLibraryPlugin.instance.sendMediaAction(action);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_PREV.equals(action)) send("prev");
        else if (ACTION_TOGGLE.equals(action)) { optimistic(!STATE.playing); send("toggle"); }
        else if (ACTION_NEXT.equals(action)) send("next");
        else if (ACTION_LIKE.equals(action)) send("like");
        else if (ACTION_CLOSE.equals(action)) send("close");
        updateSession();
        int type = Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0;
        ServiceCompat.startForeground(this, ID, build(), type);
        return START_NOT_STICKY;
    }

    /** Refresh notification + media session in place (works while the app is in the background). */
    void refresh() {
        updateSession();
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.notify(ID, build());
    }

    private void updateSession() {
        NowPlaying s = STATE;
        updateWakeLock();
        MediaMetadataCompat.Builder meta = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, s.title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, s.artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, s.album)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, s.duration);
        if (s.art != null) {
            meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, s.art);
            meta.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, s.art);
        }
        session.setMetadata(meta.build());
        PlaybackStateCompat state = new PlaybackStateCompat.Builder()
            .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE
                | PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS | PlaybackStateCompat.ACTION_SEEK_TO
                | PlaybackStateCompat.ACTION_STOP)
            .setState(s.playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                s.position, s.playing ? 1f : 0f, SystemClock.elapsedRealtime())
            // Shown next to the transport buttons on Android 13+ (heart on the left, close on the right)
            .addCustomAction(new PlaybackStateCompat.CustomAction.Builder(
                "like", s.liked ? "Unlike" : "Like", s.liked ? R.drawable.ic_heart_filled : R.drawable.ic_heart).build())
            .addCustomAction(new PlaybackStateCompat.CustomAction.Builder(
                "close", "Close", R.drawable.ic_close).build())
            .build();
        session.setPlaybackState(state);
    }

    private PendingIntent action(String a, int code) {
        Intent i = new Intent(this, PlaybackService.class).setAction(a);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification build() {
        NowPlaying s = STATE;
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_music)
            .setLargeIcon(s.art)
            .setContentTitle(s.title == null || s.title.isEmpty() ? "Music" : s.title)
            .setContentText(s.artist == null ? "" : s.artist)
            .setSubText(s.album)
            .setContentIntent(content)
            .setDeleteIntent(action(ACTION_CLOSE, 9))
            .setOngoing(s.playing)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            // Older Android versions show these buttons; Android 13+ draws its own player from the session
            .addAction(s.liked ? R.drawable.ic_heart_filled : R.drawable.ic_heart, "Like", action(ACTION_LIKE, 4))
            .addAction(R.drawable.ic_prev, "Previous", action(ACTION_PREV, 1))
            .addAction(s.playing ? R.drawable.ic_pause : R.drawable.ic_play, s.playing ? "Pause" : "Play", action(ACTION_TOGGLE, 2))
            .addAction(R.drawable.ic_next, "Next", action(ACTION_NEXT, 3))
            .addAction(R.drawable.ic_close, "Close", action(ACTION_CLOSE, 5))
            .setStyle(new MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(1, 2, 3))
            .build();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
    }

    @Override
    public void onDestroy() {
        instance = null;
        try { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); } catch (Exception ignored) { }
        if (session != null) {
            session.setActive(false);
            session.release();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
