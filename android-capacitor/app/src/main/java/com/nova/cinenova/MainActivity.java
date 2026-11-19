package com.nova.cinenova;

import android.net.Uri;
import android.os.Bundle;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.view.MotionEvent;
import android.view.KeyEvent;
import android.os.SystemClock;
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
    private WebView appWebView;
    private View nativeRemoteCursor;
    private float nativeRemoteCursorX;
    private float nativeRemoteCursorY;
    private boolean nativeRemoteCursorVisible;
    private final Handler uiHandler = new Handler(Looper.getMainLooper());
    private final Runnable hideNativeRemoteCursor = () -> {
        nativeRemoteCursorVisible = false;
        if (nativeRemoteCursor != null) nativeRemoteCursor.invalidate();
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (bridge == null) return;

        loadConfiguredApiHost();

        WebView webView = bridge.getWebView();
        appWebView = webView;
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
                if (isTelevisionDevice()) showNativeRemoteCursor(decor);
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
        if (nativeRemoteCursor != null) {
            decor.removeView(nativeRemoteCursor);
            nativeRemoteCursor = null;
        }
        uiHandler.removeCallbacks(hideNativeRemoteCursor);
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
        public void setPlayerFullscreen(boolean active) {
            runOnUiThread(() -> MainActivity.this.setPlayerFullscreen(active));
        }

        @JavascriptInterface
        public void tap(float xCss, float yCss) {
            runOnUiThread(() -> {
                WebView target = appWebView;
                if (target == null || target.getVisibility() != View.VISIBLE) return;
                float density = getResources().getDisplayMetrics().density;
                float x = Math.max(1, Math.min(target.getWidth() - 1, xCss * density));
                float y = Math.max(1, Math.min(target.getHeight() - 1, yCss * density));
                long downTime = SystemClock.uptimeMillis();
                MotionEvent down = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, x, y, 0);
                target.dispatchTouchEvent(down);
                down.recycle();
                target.postDelayed(() -> {
                    MotionEvent up = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, x, y, 0);
                    target.dispatchTouchEvent(up);
                    up.recycle();
                }, 70);
            });
        }
    }

    private boolean isTelevisionDevice() {
        return getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK)
            || getPackageManager().hasSystemFeature(PackageManager.FEATURE_TELEVISION);
    }

    private void showNativeRemoteCursor(ViewGroup decor) {
        nativeRemoteCursorX = decor.getWidth() / 2f;
        nativeRemoteCursorY = decor.getHeight() / 2f;
        nativeRemoteCursorVisible = true;
        nativeRemoteCursor = new View(this) {
            private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

            @Override
            protected void onDraw(Canvas canvas) {
                super.onDraw(canvas);
                if (!nativeRemoteCursorVisible) return;
                float radius = 19f * getResources().getDisplayMetrics().density;
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(Color.argb(105, 76, 130, 255));
                canvas.drawCircle(nativeRemoteCursorX, nativeRemoteCursorY, radius, paint);
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(3f * getResources().getDisplayMetrics().density);
                paint.setColor(Color.WHITE);
                canvas.drawCircle(nativeRemoteCursorX, nativeRemoteCursorY, radius, paint);
                paint.setStyle(Paint.Style.FILL);
                canvas.drawCircle(nativeRemoteCursorX, nativeRemoteCursorY, 3f * getResources().getDisplayMetrics().density, paint);
            }
        };
        nativeRemoteCursor.setFocusableInTouchMode(true);
        nativeRemoteCursor.setClickable(false);
        decor.addView(nativeRemoteCursor, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
        ));
        nativeRemoteCursor.requestFocus();
        revealNativeRemoteCursor();
    }

    private void revealNativeRemoteCursor() {
        if (nativeRemoteCursor == null) return;
        nativeRemoteCursorVisible = true;
        nativeRemoteCursor.invalidate();
        uiHandler.removeCallbacks(hideNativeRemoteCursor);
        uiHandler.postDelayed(hideNativeRemoteCursor, 1800);
    }

    private void moveNativeRemoteCursor(int keyCode) {
        if (nativeRemoteCursor == null || fullscreenView == null) return;
        int step = Math.round(36 * getResources().getDisplayMetrics().density);
        View decor = getWindow().getDecorView();
        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_UP: nativeRemoteCursorY -= step; break;
            case KeyEvent.KEYCODE_DPAD_DOWN: nativeRemoteCursorY += step; break;
            case KeyEvent.KEYCODE_DPAD_LEFT: nativeRemoteCursorX -= step; break;
            case KeyEvent.KEYCODE_DPAD_RIGHT: nativeRemoteCursorX += step; break;
        }
        nativeRemoteCursorX = Math.max(8, Math.min(decor.getWidth() - 8, nativeRemoteCursorX));
        nativeRemoteCursorY = Math.max(8, Math.min(decor.getHeight() - 8, nativeRemoteCursorY));
        nativeRemoteCursor.invalidate();
        revealNativeRemoteCursor();
    }

    private void tapNativeRemoteCursor() {
        View target = fullscreenView;
        if (target == null) return;
        int[] targetLocation = new int[2];
        target.getLocationOnScreen(targetLocation);
        float x = nativeRemoteCursorX - targetLocation[0];
        float y = nativeRemoteCursorY - targetLocation[1];
        long downTime = SystemClock.uptimeMillis();
        MotionEvent down = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, x, y, 0);
        target.dispatchTouchEvent(down);
        down.recycle();
        target.postDelayed(() -> {
            MotionEvent up = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, x, y, 0);
            target.dispatchTouchEvent(up);
            up.recycle();
        }, 70);
        revealNativeRemoteCursor();
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
        if (fullscreenView != null && nativeRemoteCursor != null) {
            int code = event.getKeyCode();
            boolean direction = code == KeyEvent.KEYCODE_DPAD_UP || code == KeyEvent.KEYCODE_DPAD_DOWN
                || code == KeyEvent.KEYCODE_DPAD_LEFT || code == KeyEvent.KEYCODE_DPAD_RIGHT;
            boolean select = code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER;
            if (direction || select) {
                if (event.getAction() == KeyEvent.ACTION_DOWN) {
                    if (direction) moveNativeRemoteCursor(code);
                    else if (!event.isLongPress() && event.getRepeatCount() == 0) tapNativeRemoteCursor();
                }
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }
}
