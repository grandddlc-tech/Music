package com.grandddlc.music;

import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaLibraryPlugin.class);
        super.onCreate(savedInstanceState);
        WebView web = getBridge().getWebView();
        WebSettings s = web.getSettings();
        // Let the next song start by itself while the screen is off
        s.setMediaPlaybackRequiresUserGesture(false);
        // Keep the player responsive (notification buttons, next track) when the app is in the background
        if (Build.VERSION.SDK_INT >= 26) {
            web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
        web.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
    }

    @Override
    public void onPause() {
        super.onPause();
        // Android pauses the page's timers when the app leaves the screen; keep them running for playback
        WebView web = getBridge() != null ? getBridge().getWebView() : null;
        if (web != null) {
            web.onResume();
            web.resumeTimers();
        }
    }
}
