package com.grandddlc.music;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.database.ContentObserver;
import android.database.Cursor;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;

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

    /** Writes the backup to Downloads/Music-backup.json (it stays there even if the app is uninstalled). */
    @PluginMethod
    public void saveBackup(PluginCall call) {
        final String data = call.getString("data", "");
        if (Build.VERSION.SDK_INT < 29) {
            call.reject("UNSUPPORTED");
            return;
        }
        getBridge().execute(() -> {
            try {
                ContentResolver cr = getContext().getContentResolver();
                Uri col = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
                Uri target = null;
                try (Cursor c = cr.query(col, new String[] { MediaStore.MediaColumns._ID },
                        MediaStore.MediaColumns.DISPLAY_NAME + " = ?", new String[] { "Music-backup.json" }, null)) {
                    if (c != null && c.moveToFirst()) target = ContentUris.withAppendedId(col, c.getLong(0));
                }
                if (target == null) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, "Music-backup.json");
                    v.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    target = cr.insert(col, v);
                }
                try (java.io.OutputStream os = cr.openOutputStream(target, "wt")) {
                    os.write(data.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("BACKUP_FAILED: " + e.getMessage());
            }
        });
    }

    /** Shows / updates / hides the media notification (keeps music playing in the background). */
    @PluginMethod
    public void updatePlayback(PluginCall call) {
        boolean active = call.getBoolean("active", false);
        Intent i = new Intent(getContext(), PlaybackService.class);
        if (!active) {
            getContext().stopService(i);
            call.resolve();
            return;
        }
        PlaybackService.NowPlaying st = PlaybackService.STATE;
        st.title = call.getString("title", "");
        st.artist = call.getString("artist", "");
        st.album = call.getString("album", "");
        st.playing = call.getBoolean("playing", false);
        st.liked = call.getBoolean("liked", false);
        st.duration = call.getLong("duration", 0L);
        st.position = call.getLong("position", 0L);
        String art = call.getString("art");
        if (art != null) {
            // Cover art changed ("" = no cover)
            st.art = null;
            if (!art.isEmpty()) {
                try {
                    byte[] bytes = Base64.decode(art, Base64.DEFAULT);
                    st.art = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                } catch (Exception ignored) { }
            }
        }
        if (PlaybackService.instance != null) {
            // Already running: refresh in place (allowed from the background)
            PlaybackService.instance.refresh();
        } else {
            i.setAction(PlaybackService.ACTION_UPDATE);
            try {
                ContextCompat.startForegroundService(getContext(), i);
            } catch (Exception ignored) { }
        }
        call.resolve();
    }

    /** Called by the notification buttons and headphone / Bluetooth buttons. */
    void sendMediaAction(String action) {
        JSObject r = new JSObject();
        r.put("action", action);
        notifyListeners("mediaAction", r);
    }

    /** Called when the user drags the seek bar in the notification. */
    void sendSeek(long positionMs) {
        JSObject r = new JSObject();
        r.put("action", "seek");
        r.put("position", positionMs);
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
