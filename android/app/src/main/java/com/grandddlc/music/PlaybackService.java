package com.grandddlc.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Foreground service that keeps the app alive while music plays with the screen off,
 * and shows a notification with previous / play-pause / next buttons.
 */
public class PlaybackService extends Service {

    static final String ACTION_UPDATE = "com.grandddlc.music.UPDATE";
    static final String ACTION_PREV = "com.grandddlc.music.PREV";
    static final String ACTION_TOGGLE = "com.grandddlc.music.TOGGLE";
    static final String ACTION_NEXT = "com.grandddlc.music.NEXT";
    private static final String CHANNEL = "playback";
    private static final int ID = 4107;

    static PlaybackService instance;
    private String title = "", artist = "";
    private boolean playing = false;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Playback", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_UPDATE.equals(action)) {
            title = intent.getStringExtra("title");
            artist = intent.getStringExtra("artist");
            playing = intent.getBooleanExtra("playing", false);
        } else if (action != null && MediaLibraryPlugin.instance != null) {
            if (ACTION_PREV.equals(action)) MediaLibraryPlugin.instance.sendMediaAction("prev");
            if (ACTION_TOGGLE.equals(action)) MediaLibraryPlugin.instance.sendMediaAction("toggle");
            if (ACTION_NEXT.equals(action)) MediaLibraryPlugin.instance.sendMediaAction("next");
        }
        int type = Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0;
        ServiceCompat.startForeground(this, ID, build(), type);
        return START_NOT_STICKY;
    }

    private PendingIntent action(String a, int code) {
        Intent i = new Intent(this, PlaybackService.class).setAction(a);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification build() {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(playing ? android.R.drawable.ic_media_play : android.R.drawable.ic_media_pause)
            .setContentTitle(title == null || title.isEmpty() ? "Music" : title)
            .setContentText(artist == null ? "" : artist)
            .setContentIntent(content)
            .setOngoing(playing)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .addAction(android.R.drawable.ic_media_previous, "Previous", action(ACTION_PREV, 1))
            .addAction(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                playing ? "Pause" : "Play", action(ACTION_TOGGLE, 2))
            .addAction(android.R.drawable.ic_media_next, "Next", action(ACTION_NEXT, 3))
            .build();
    }

    /** Update the notification in place (works while the app is in the background). */
    void update(String t, String a, boolean p) {
        title = t; artist = a; playing = p;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.notify(ID, build());
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
    }

    @Override
    public void onDestroy() {
        instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
