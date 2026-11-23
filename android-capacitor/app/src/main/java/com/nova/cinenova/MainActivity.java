package com.nova.cinenova;

import android.net.Uri;
import android.app.UiModeManager;
import android.content.Context;
import android.os.Bundle;
import android.content.res.Configuration;
import android.os.SystemClock;
import android.content.pm.ActivityInfo;
import android.view.View;
import android.view.ViewGroup;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;
import org.json.JSONObject;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayInputStream;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

public class MainActivity extends BridgeActivity {
    private static final Set<String> AD_HOSTS = new HashSet<>(Arrays.asList(
        "doubleclick.net", "googlesyndication.com", "googleadservices.com",
        "imasdk.googleapis.com", "adnxs.com", "popads.net", "popcash.net",
        "exoclick.com", "juicyads.com", "adsterra.com",
        "highperformanceformat.com", "monetag.com", "onclickalgo.com", "acscdn.com"
    ));

    private View fullscreenView;
    private BridgeWebChromeClient fullscreenChromeClient;
    private BridgeWebChromeClient.CustomViewCallback fullscreenCallback;
    private int previousSystemUiVisibility;
    private int previousRequestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
    private int playerPreviousSystemUiVisibility;
    private int playerPreviousRequestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
    private boolean playerFullscreenActive;
    private String configuredApiHost = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (bridge == null) return;

        loadConfiguredApiHost();

        WebView webView = bridge.getWebView();
        WebSettings settings = webView.getSettings();
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        webView.addJavascriptInterface(new TvRemoteBridge(), "CinenovaTvRemote");

        webView.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isAllowedNavigation(request.getUrl());
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
                if (!isUnlimPlay(host) && !isMediaResource(uri) && isAdHost(host)) {
                    return new WebResourceResponse(
                        "text/plain", "UTF-8", new ByteArrayInputStream(new byte[0])
                    );
                }
                return super.shouldInterceptRequest(view, request);
            }
        });

        fullscreenChromeClient = new BridgeWebChromeClient(bridge) {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullscreenView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                fullscreenView = view;
                fullscreenCallback = callback;
                view.setFocusableInTouchMode(true);
                view.requestFocus();
                previousRequestedOrientation = getRequestedOrientation();
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                WebView currentWebView = bridge.getWebView();
                currentWebView.setVisibility(View.GONE);

                ViewGroup decor = (ViewGroup) getWindow().getDecorView();
                if (view.getParent() instanceof ViewGroup) {
                    ((ViewGroup) view.getParent()).removeView(view);
                }
                decor.addView(view, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
                ));
                previousSystemUiVisibility = decor.getSystemUiVisibility();
                decor.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                );
            }

            @Override
            public void onHideCustomView() {
                hideFullscreenView();
            }
        };
        webView.setWebChromeClient(fullscreenChromeClient);
    }

    private boolean isAllowedNavigation(Uri uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        return "capacitor".equals(scheme)
            || "localhost".equals(host)
            || isUnlimPlay(host)
            || (!configuredApiHost.isEmpty() && configuredApiHost.equals(host))
            || isMediaResource(uri);
    }

    private void loadConfiguredApiHost() {
        try (java.io.InputStream input = getAssets().open("public/app-config.json")) {
            java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[1024];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            String apiBaseUrl = new JSONObject(output.toString("UTF-8")).optString("apiBaseUrl", "");
            String host = Uri.parse(apiBaseUrl).getHost();
            configuredApiHost = host == null ? "" : host.toLowerCase(Locale.ROOT);
        } catch (Exception ignored) {
            configuredApiHost = "";
        }
    }

    private boolean isUnlimPlay(String host) {
        return "unlimplay.com".equals(host) || host.endsWith(".unlimplay.com");
    }

    private boolean isMediaResource(Uri uri) {
        String path = uri.getPath();
        if (path == null) return false;
        String value = path.toLowerCase(Locale.ROOT);
        return value.endsWith(".m3u8") || value.endsWith(".ts")
            || value.endsWith(".mp4") || value.endsWith(".vtt");
    }

    private boolean isAdHost(String host) {
        for (String adHost : AD_HOSTS) {
            if (host.equals(adHost) || host.endsWith("." + adHost)) return true;
        }
        return false;
    }

    private void hideFullscreenView() {
        if (fullscreenView == null) return;
        ViewGroup decor = (ViewGroup) getWindow().getDecorView();
        decor.removeView(fullscreenView);
        fullscreenView = null;
        setRequestedOrientation(previousRequestedOrientation);
        WebView webView = bridge.getWebView();
        webView.setVisibility(View.VISIBLE);
        webView.evaluateJavascript("window.cinenovaExitPlayerFullscreen && window.cinenovaExitPlayerFullscreen()", null);
        decor.setSystemUiVisibility(previousSystemUiVisibility);
        if (fullscreenCallback != null) {
            fullscreenCallback.onCustomViewHidden();
            fullscreenCallback = null;
        }
    }

    private void setPlayerFullscreen(boolean active) {
        View decor = getWindow().getDecorView();
        if (active == playerFullscreenActive) return;
        if (active) {
            playerFullscreenActive = true;
            playerPreviousRequestedOrientation = getRequestedOrientation();
            playerPreviousSystemUiVisibility = decor.getSystemUiVisibility();
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        } else {
            playerFullscreenActive = false;
            setRequestedOrientation(playerPreviousRequestedOrientation);
            decor.setSystemUiVisibility(playerPreviousSystemUiVisibility);
        }
    }

    private final class TvRemoteBridge {
        @JavascriptInterface
        public boolean isTelevisionDevice() {
            return detectTelevisionDevice();
        }

        @JavascriptInterface
        public void setPlayerFullscreen(boolean active) {
            runOnUiThread(() -> MainActivity.this.setPlayerFullscreen(active));
        }

        @JavascriptInterface
        public void sendPlayerTap(float normX, float normY) {
            if (Float.isNaN(normX) || Float.isInfinite(normX) || Float.isNaN(normY) || Float.isInfinite(normY)
                || normX < 0f || normX > 1f || normY < 0f || normY > 1f) return;
            runOnUiThread(() -> {
                WebView target = bridge == null ? null : bridge.getWebView();
                if (target == null || target.getWidth() <= 0 || target.getHeight() <= 0) return;
                float x = normX * target.getWidth();
                float y = normY * target.getHeight();
                long downTime = SystemClock.uptimeMillis();
                MotionEvent down = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, x, y, 0);
                target.dispatchTouchEvent(down);
                down.recycle();
                long upTime = SystemClock.uptimeMillis();
                MotionEvent up = MotionEvent.obtain(downTime, upTime, MotionEvent.ACTION_UP, x, y, 0);
                target.dispatchTouchEvent(up);
                up.recycle();
            });
        }
    }

    private boolean detectTelevisionDevice() {
        UiModeManager uiModeManager = (UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
        boolean televisionUiMode = uiModeManager != null
            && uiModeManager.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
        return getPackageManager().hasSystemFeature(android.content.pm.PackageManager.FEATURE_LEANBACK)
            || getPackageManager().hasSystemFeature(android.content.pm.PackageManager.FEATURE_TELEVISION)
            || televisionUiMode;
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (fullscreenView != null) {
            hideFullscreenView();
            return;
        }
        if (bridge == null) {
            super.onBackPressed();
            return;
        }
        bridge.getWebView().evaluateJavascript(
            "window.onAndroidBackPressed ? window.onAndroidBackPressed() : false",
            result -> {
                if (!"true".equals(result)) super.onBackPressed();
            }
        );
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (playerFullscreenActive || fullscreenView != null) {
            String playerKey = null;
            switch (event.getKeyCode()) {
                case KeyEvent.KEYCODE_DPAD_LEFT: playerKey = "ArrowLeft"; break;
                case KeyEvent.KEYCODE_DPAD_UP: playerKey = "ArrowUp"; break;
                case KeyEvent.KEYCODE_DPAD_RIGHT: playerKey = "ArrowRight"; break;
                case KeyEvent.KEYCODE_DPAD_DOWN: playerKey = "ArrowDown"; break;
                case KeyEvent.KEYCODE_DPAD_CENTER:
                case KeyEvent.KEYCODE_ENTER: playerKey = "Enter"; break;
                case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: playerKey = " "; break;
                default: break;
            }
            if (playerKey != null) {
                if (event.getAction() == KeyEvent.ACTION_DOWN && (event.getRepeatCount() == 0 || !"Enter".equals(playerKey))) {
                    String jsKey = JSONObject.quote(playerKey);
                    bridge.getWebView().evaluateJavascript(
                        "window.cinenovaForwardPlayerKey && window.cinenovaForwardPlayerKey(" + jsKey + ")", null
                    );
                }
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

}
