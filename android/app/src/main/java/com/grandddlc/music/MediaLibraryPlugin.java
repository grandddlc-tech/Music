package com.grandddlc.music;

import android.Manifest;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.ContentObserver;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Gives the web app access to every song on the phone (Android's MediaStore, the same
 * library other music players use), tells it when new songs appear, and keeps playback
 * alive in the background with a notification.
 */
@CapacitorPlugin(
    name = "MediaLibrary",
    permissions = {
        @Permission(alias = "audio", strings = { Manifest.permission.READ_MEDIA_AUDIO }),
        @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class MediaLibraryPlugin extends Plugin {

    static MediaLibraryPlugin instance;
    private ContentObserver observer;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable notifyChange = () -> notifyListeners("libraryChanged", new JSObject());

    @Override
    public void load() {
        instance = this;
    }

    private String audioAlias() {
        return Build.VERSION.SDK_INT >= 33 ? "audio" : "storage";
    }

    private boolean hasAccess() {
        return getPermissionState(audioAlias()) == PermissionState.GRANTED;
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", hasAccess());
        call.resolve(r);
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        if (hasAccess()) {
            askNotifications();
            JSObject r = new JSObject();
            r.put("granted", true);
            call.resolve(r);
            return;
        }
        requestPermissionForAlias(audioAlias(), call, "accessResult");
    }

    @PermissionCallback
    private void accessResult(PluginCall call) {
        askNotifications();
        JSObject r = new JSObject();
        r.put("granted", hasAccess());
        call.resolve(r);
    }

    private void askNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            try {
                getActivity().requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 7041);
            } catch (Exception ignored) { }
        }
    }

    /** Every audio file on the device, except ringtones, alarms and notification sounds. */
    @PluginMethod
    public void getSongs(PluginCall call) {
        if (!hasAccess()) {
            call.reject("NO_ACCESS");
            return;
        }
        getBridge().execute(() -> {
            JSArray list = new JSArray();
            ContentResolver cr = getContext().getContentResolver();
            Uri uri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
            String[] cols = {
                MediaStore.Audio.Media._ID, MediaStore.Audio.Media.TITLE, MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.ALBUM, MediaStore.Audio.Media.ALBUM_ID, MediaStore.Audio.Media.DURATION,
                MediaStore.Audio.Media.SIZE, MediaStore.Audio.Media.DATE_ADDED, MediaStore.Audio.Media.DATE_MODIFIED,
                MediaStore.Audio.Media.DATA, MediaStore.Audio.Media.MIME_TYPE, MediaStore.Audio.Media.TRACK,
                MediaStore.Audio.Media.YEAR
            };
            String sel = MediaStore.Audio.Media.IS_RINGTONE + " = 0 AND "
                + MediaStore.Audio.Media.IS_ALARM + " = 0 AND "
                + MediaStore.Audio.Media.IS_NOTIFICATION + " = 0 AND ("
                + MediaStore.Audio.Media.IS_MUSIC + " != 0 OR " + MediaStore.Audio.Media.DURATION + " >= 30000)";
            try (Cursor c = cr.query(uri, cols, sel, null, MediaStore.Audio.Media.DATE_ADDED + " DESC")) {
                if (c != null) {
                    while (c.moveToNext()) {
                        JSObject s = new JSObject();
                        s.put("id", c.getLong(0));
                        s.put("title", c.getString(1));
                        s.put("artist", c.getString(2));
                        s.put("album", c.getString(3));
                        s.put("albumId", c.getLong(4));
                        s.put("duration", c.getLong(5));
                        s.put("size", c.getLong(6));
                        s.put("dateAdded", c.getLong(7));
                        s.put("dateModified", c.getLong(8));
                        s.put("path", c.getString(9));
                        s.put("mime", c.getString(10));
                        s.put("track", c.getInt(11));
                        s.put("year", c.getInt(12));
                        list.put(s);
                    }
                }
                JSObject r = new JSObject();
                r.put("songs", list);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("QUERY_FAILED: " + e.getMessage());
            }
        });
    }

    /** Fires "libraryChanged" whenever songs are added, changed or deleted anywhere on the phone. */
    @PluginMethod
    public void watch(PluginCall call) {
        if (observer == null) {
            observer = new ContentObserver(handler) {
                @Override
                public void onChange(boolean selfChange) {
                    handler.removeCallbacks(notifyChange);
                    handler.postDelayed(notifyChange, 2500);
                }
            };
            getContext().getContentResolver().registerContentObserver(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, true, observer);
        }
        call.resolve();
    }

    /** Shows / updates / hides the playback notification (keeps music playing in the background). */
    @PluginMethod
    public void updatePlayback(PluginCall call) {
        boolean active = call.getBoolean("active", false);
        Intent i = new Intent(getContext(), PlaybackService.class);
        if (!active) {
            getContext().stopService(i);
            call.resolve();
            return;
        }
        if (PlaybackService.instance != null) {
            // Already in the foreground: just refresh the notification (allowed from the background)
            PlaybackService.instance.update(call.getString("title", ""), call.getString("artist", ""), call.getBoolean("playing", false));
            call.resolve();
            return;
        }
        i.setAction(PlaybackService.ACTION_UPDATE);
        i.putExtra("title", call.getString("title", ""));
        i.putExtra("artist", call.getString("artist", ""));
        i.putExtra("playing", call.getBoolean("playing", false));
        try {
            ContextCompat.startForegroundService(getContext(), i);
        } catch (Exception ignored) { }
        call.resolve();
    }

    /** Called by the notification buttons. */
    void sendMediaAction(String action) {
        JSObject r = new JSObject();
        r.put("action", action);
        notifyListeners("mediaAction", r);
    }

    @Override
    protected void handleOnDestroy() {
        if (observer != null) {
            getContext().getContentResolver().unregisterContentObserver(observer);
            observer = null;
        }
        getContext().stopService(new Intent(getContext(), PlaybackService.class));
        instance = null;
    }
}
