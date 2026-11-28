package com.nova.cinenova;

import android.graphics.Bitmap;
import android.net.Uri;
import android.app.UiModeManager;
import android.content.Context;
import android.os.Bundle;
import android.content.res.Configuration;
import android.os.PowerManager;
import android.os.StatFs;
import android.os.SystemClock;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import org.json.JSONArray;
import org.json.JSONObject;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.io.BufferedOutputStream;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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
    private String configuredGatewayHost = "";
    private CinenovaVault vault;
    private volatile StreamExtractor activeExtractor;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (bridge == null) return;

        loadConfiguredApiHost();

        WebView webView = bridge.getWebView();
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString().replace("; wv", ""));
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(bridge.getWebView(), true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setDatabaseEnabled(true);
        webView.addJavascriptInterface(new TvRemoteBridge(), "CinenovaTvRemote");
        if (!detectTelevisionDevice()) {
            vault = new CinenovaVault();
            webView.addJavascriptInterface(vault, "CinenovaVault");
            vault.reconcileOnStartup();
        }

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
            || isVideoGatewayHost(host)
            || (!configuredApiHost.isEmpty() && configuredApiHost.equals(host))
            || isMediaResource(uri);
    }

    private void loadConfiguredApiHost() {
        try (java.io.InputStream input = getAssets().open("public/app-config.json")) {
            java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[1024];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            JSONObject config = new JSONObject(output.toString("UTF-8"));
            configuredApiHost = hostOf(config.optString("apiBaseUrl", ""));
            configuredGatewayHost = hostOf(config.optString("videoGatewayUrl", ""));
        } catch (Exception ignored) {
            configuredApiHost = "";
            configuredGatewayHost = "";
        }
        if (configuredGatewayHost.isEmpty()) configuredGatewayHost = "vg-core.novapelis.workers.dev";
    }

    private String hostOf(String value) {
        String host = Uri.parse(value).getHost();
        return host == null ? "" : host.toLowerCase(Locale.ROOT);
    }

    private boolean isVideoGatewayHost(String host) {
        return "vg-core.novapelis.workers.dev".equals(host)
            || (!configuredGatewayHost.isEmpty() && configuredGatewayHost.equals(host));
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
        if (bridge == null) {
            if (fullscreenView != null) {
                hideFullscreenView();
                return;
            }
            super.onBackPressed();
            return;
        }
        bridge.getWebView().evaluateJavascript(
            "window.onAndroidBackPressed ? window.onAndroidBackPressed() : false",
            result -> {
                if (fullscreenView != null && !playerFullscreenActive) hideFullscreenView();
                else if (!"true".equals(result)) super.onBackPressed();
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

    @Override
    public void onDestroy() {
        if (vault != null) vault.shutdown();
        super.onDestroy();
    }

    private static final String VAULT_USER_AGENT = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
    private static final long VAULT_MIN_FREE_BYTES = 2_500_000_000L;
    private static final long VAULT_DAY_MS = 24L * 60 * 60 * 1000;
    private static final int VAULT_NONCE_LENGTH = 12;

    private static void deleteRecursive(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteRecursive(child);
        if (!file.delete()) file.delete();
    }

    private static String readText(File file) throws IOException {
        StringBuilder text = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
            new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) text.append(line).append('\n');
        }
        return text.toString();
    }

    private static void writeText(File file, String text) throws IOException {
        File parent = file.getParentFile();
        if (parent != null) parent.mkdirs();
        try (OutputStreamWriter writer = new OutputStreamWriter(
            new FileOutputStream(file, false), StandardCharsets.UTF_8)) {
            writer.write(text);
        }
    }

    /** Cifrado por bloques con contador: permite descifrar rangos arbitrarios sin reescribir el archivo. */
    private static final class VaultCipher {
        private final Cipher aes;
        private final SecureRandom random = new SecureRandom();

        VaultCipher(Context context) {
            try {
                aes = Cipher.getInstance("AES/ECB/NoPadding");
                aes.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(deriveKey(context), "AES"));
            } catch (Exception error) {
                throw new IllegalStateException("No se pudo inicializar la bóveda", error);
            }
        }

        private static byte[] deriveKey(Context context) {
            StringBuilder seed = new StringBuilder("cinenova-vault-v1|").append(context.getPackageName());
            try {
                PackageInfo info = context.getPackageManager().getPackageInfo(
                    context.getPackageName(), PackageManager.GET_SIGNATURES);
                Signature[] signatures = info.signatures;
                if (signatures != null) {
                    for (Signature signature : signatures) {
                        MessageDigest digest = MessageDigest.getInstance("SHA-256");
                        seed.append(android.util.Base64.encodeToString(
                            digest.digest(signature.toByteArray()), android.util.Base64.NO_WRAP));
                    }
                }
            } catch (Exception ignored) {
                // Sin firma disponible: se usa únicamente el paquete como semilla.
            }
            try {
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                byte[] hash = digest.digest(seed.toString().getBytes(StandardCharsets.UTF_8));
                byte[] key = new byte[16];
                System.arraycopy(hash, 0, key, 0, key.length);
                return key;
            } catch (Exception ignored) {
                return "0123456789abcdef".getBytes(StandardCharsets.UTF_8);
            }
        }

        byte[] newNonce() {
            byte[] nonce = new byte[VAULT_NONCE_LENGTH];
            random.nextBytes(nonce);
            return nonce;
        }

        synchronized void writeHeader(File file, byte[] nonce) throws IOException {
            try (FileOutputStream out = new FileOutputStream(file, false)) {
                out.write(nonce);
            }
        }

        synchronized byte[] readNonce(File file) throws IOException {
            byte[] nonce = new byte[VAULT_NONCE_LENGTH];
            try (FileInputStream in = new FileInputStream(file)) {
                if (in.read(nonce) != VAULT_NONCE_LENGTH) throw new IOException("Encabezado inválido");
            }
            return nonce;
        }

        synchronized void writeEncrypted(File file, byte[] plain) throws IOException {
            byte[] nonce = newNonce();
            byte[] encoded = new byte[plain.length];
            crypt(plain, plain.length, encoded, 0, nonce);
            try (FileOutputStream out = new FileOutputStream(file, false)) {
                out.write(nonce);
                out.write(encoded);
            }
        }

        synchronized byte[] readAll(File file) throws IOException {
            long size = file.length() - VAULT_NONCE_LENGTH;
            return size <= 0 ? new byte[0] : decryptRange(file, 0, (int) size);
        }

        synchronized byte[] decryptRange(File file, long offset, int length) throws IOException {
            if (length <= 0 || offset < 0) return new byte[0];
            byte[] nonce = readNonce(file);
            long available = file.length() - VAULT_NONCE_LENGTH - offset;
            if (available <= 0) return new byte[0];
            int count = (int) Math.min(length, available);
            byte[] source = new byte[count];
            try (RandomAccessFile randomAccess = new RandomAccessFile(file, "r")) {
                randomAccess.seek(VAULT_NONCE_LENGTH + offset);
                randomAccess.readFully(source);
            }
            byte[] plain = new byte[count];
            crypt(source, count, plain, offset, nonce);
            return plain;
        }

        synchronized void crypt(byte[] input, int length, byte[] output, long plaintextOffset, byte[] nonce) {
            long blockIndex = plaintextOffset / 16;
            int skip = (int) (plaintextOffset % 16);
            byte[] counter = new byte[16];
            System.arraycopy(nonce, 0, counter, 0, Math.min(nonce.length, 12));
            int written = 0;
            while (written < length) {
                putInt(counter, 12, (int) blockIndex);
                blockIndex++;
                byte[] stream;
                try {
                    stream = aes.doFinal(counter);
                } catch (Exception error) {
                    throw new IllegalStateException(error);
                }
                int take = Math.min(16 - skip, length - written);
                for (int index = 0; index < take; index += 1) {
                    output[written + index] = (byte) (input[written + index] ^ stream[skip + index]);
                }
                written += take;
                skip = 0;
            }
        }

        private static void putInt(byte[] target, int offset, int value) {
            target[offset] = (byte) (value >>> 24);
            target[offset + 1] = (byte) (value >>> 16);
            target[offset + 2] = (byte) (value >>> 8);
            target[offset + 3] = (byte) value;
        }
    }

    private static final class DownloadRecord {
        String itemId;
        int tmdbId;
        String mediaType;
        int season;
        int episode;
        String title;
        String posterPath;
        String status;
        int progress;
        long bytesDownloaded;
        long totalBytes;
        long downloadedAt;
        long expiresAt;
        String streamType;
        String errorReason;

        JSONObject toJson() {
            JSONObject data = new JSONObject();
            try {
                data.put("itemId", itemId);
                data.put("tmdbId", tmdbId);
                data.put("mediaType", mediaType);
                data.put("season", season);
                data.put("episode", episode);
                data.put("title", title);
                data.put("posterPath", posterPath);
                data.put("status", status);
                data.put("progress", progress);
                data.put("bytesDownloaded", bytesDownloaded);
                data.put("totalBytes", totalBytes);
                data.put("downloadedAt", downloadedAt);
                data.put("expiresAt", expiresAt);
                data.put("streamType", streamType);
                data.put("errorReason", errorReason == null ? "" : errorReason);
            } catch (Exception ignored) {
                // JSONObject nunca falla con valores primitivos.
            }
            return data;
        }
    }

    private static final class StreamInfo {
        String url;
        String referer;
        String origin;
        String userAgent;
        String streamType;

        JSONObject toJson() {
            JSONObject data = new JSONObject();
            try {
                data.put("url", url);
                data.put("referer", referer == null ? "" : referer);
                data.put("origin", origin == null ? "" : origin);
                data.put("userAgent", userAgent == null ? "" : userAgent);
                data.put("streamType", streamType);
            } catch (Exception ignored) {
                // No hay valores problemáticos.
            }
            return data;
        }

        static StreamInfo fromJson(JSONObject data) {
            StreamInfo info = new StreamInfo();
            info.url = data.optString("url", "");
            info.referer = data.optString("referer", "");
            info.origin = data.optString("origin", "");
            info.userAgent = data.optString("userAgent", "");
            info.streamType = data.optString("streamType", "mp4");
            return info;
        }
    }

    /** WebView oculto que captura el primer stream real; nunca reenvía los spots del Gateway. */
    private final class StreamExtractor {
        private final String itemId;
        private volatile WebView activeProbe;
        private volatile CountDownLatch activeLatch;

        StreamExtractor(String itemId) {
            this.itemId = itemId == null ? "" : itemId;
        }

        /** Puente JS: detecta manifests y MP4 incluso si la URL no termina en .m3u8. */
        private String detectionJs() {
            return "(function(){"
                + "if(window.__cnVaultHook)return true;window.__cnVaultHook=true;"
                + "var ITEM=" + JSONObject.quote(itemId) + ";"
                + "function text(v){return String(v||'').toLowerCase();}"
                + "function isM3u8(v){return String(v||'').trim().indexOf('#EXTM3U')===0;}"
                + "function isMediaType(v){v=text(v);return v.indexOf('mpegurl')>=0||v.indexOf('video/mp4')>=0;}"
                + "function skip(u){u=text(u);return !u||u.indexOf('blob:')===0||u.indexOf('data:')===0||u.indexOf('test-videos.co.uk')>=0||u.indexOf('/v1/stream/segment')>=0;}"
                + "function report(u){try{if(skip(u))return;CinenovaVault.reportDetectedStream(ITEM,String(u),location.href);}catch(e){}}"
                + "function maybeText(u,ct,res){var lower=text(u),type=text(ct),len=0;try{len=Number(res.headers.get('content-length'))||0;}catch(e){}if(lower.indexOf('.mp4')>=0||lower.indexOf('.webm')>=0||type.indexOf('video/')>=0||type.indexOf('image/')>=0)return;if(lower.indexOf('.m3u8')>=0||lower.indexOf('playlist')>=0||lower.indexOf('master')>=0||lower.indexOf('manifest')>=0||lower.indexOf('index-')>=0||lower.indexOf('.txt')>=0||type.indexOf('text/plain')>=0||type.indexOf('octet-stream')>=0||!ct||(len>0&&len<1048576)){try{res.clone().text().then(function(body){if(isM3u8(body))report(u);}).catch(function(){});}catch(e){}}}"
                + "var of=window.fetch;if(typeof of==='function'){window.fetch=function(){var args=arguments;var u=args[0];try{u=typeof u==='string'?u:(u&&u.url)||String(u);}catch(e){}var pending=of.apply(this,args);if(!pending||typeof pending.then!=='function')return pending;return pending.then(function(res){try{var ct=res.headers&&res.headers.get?res.headers.get('content-type'):'';if(isMediaType(ct))report(u);else maybeText(u,ct,res);}catch(e){}return res;});};}"
                + "var OX=window.XMLHttpRequest;if(OX&&OX.prototype){var oo=OX.prototype.open,os=OX.prototype.send;OX.prototype.open=function(m,u){this.__cnUrl=u;return oo.apply(this,arguments);};OX.prototype.send=function(){var xhr=this;try{xhr.addEventListener('load',function(){try{var ct=xhr.getResponseHeader('content-type')||'';var u=xhr.responseURL||xhr.__cnUrl||'';if(isMediaType(ct)){report(u);}else{var lower=text(u),type=text(ct);if(lower.indexOf('.mp4')<0&&lower.indexOf('.webm')<0&&type.indexOf('video/')<0&&type.indexOf('image/')<0&&(lower.indexOf('.m3u8')>=0||lower.indexOf('playlist')>=0||lower.indexOf('master')>=0||lower.indexOf('manifest')>=0||lower.indexOf('index-')>=0||lower.indexOf('.txt')>=0||type.indexOf('text/plain')>=0||type.indexOf('octet-stream')>=0||!ct)){var body='';try{if(xhr.responseType===''||xhr.responseType==='text')body=xhr.responseText||'';}catch(e){}if(isM3u8(body))report(u);}}}catch(e){}});}catch(e){}return os.apply(this,arguments);};}"
                + "function silence(){var nodes=document.querySelectorAll('video,audio');for(var i=0;i<nodes.length;i++){try{var el=nodes[i];el.muted=true;el.volume=0;el.removeAttribute('autoplay');el.style.visibility='hidden';}catch(e){}}}"
                + "document.addEventListener('DOMContentLoaded',silence,true);setInterval(silence,1200);silence();return true;})()";
        }

        private static final String AUTOPLAY_JS = "(function(){"
            + "var sels=['#pbtn','.play-btn','[data-play]','.vjs-big-play-button','.jw-display-icon-container'];"
            + "for(var i=0;i<sels.length;i++){var b=document.querySelector(sels[i]);if(b){try{b.click();}catch(e){}break;}}"
            + "var v=document.querySelector('video');if(v){try{v.muted=true;var p=v.play();if(p&&p.catch)p.catch(function(){});}catch(e){}}"
            + "var mid=document.elementFromPoint((window.innerWidth||2)/2,(window.innerHeight||2)/2);"
            + "if(mid){try{mid.click();}catch(e){}}return true;})()";

        StreamInfo extract(String embedUrl) {
            if (embedUrl == null || embedUrl.isEmpty()) return null;
            final WebView[] probeHolder = new WebView[1];
            final boolean[] destroyed = new boolean[1];
            final StreamInfo[] found = new StreamInfo[1];
            final CountDownLatch latch = new CountDownLatch(1);
            activeLatch = latch;
            runOnUiThread(() -> {
                try {
                    WebView probe = new WebView(MainActivity.this);
                    probeHolder[0] = probe;
                    activeProbe = probe;
                    if (vault != null) probe.addJavascriptInterface(vault, "CinenovaVault");
                    WebSettings settings = probe.getSettings();
                    settings.setJavaScriptEnabled(true);
                    settings.setDomStorageEnabled(true);
                    settings.setMediaPlaybackRequiresUserGesture(false);
                    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
                    settings.setUserAgentString(VAULT_USER_AGENT);
                    settings.setSupportMultipleWindows(false);
                    settings.setJavaScriptCanOpenWindowsAutomatically(false);
                    CookieManager.getInstance().setAcceptThirdPartyCookies(probe, true);
                    probe.setVisibility(View.INVISIBLE);
                    ViewGroup root = findViewById(android.R.id.content);
                    root.addView(probe, new FrameLayout.LayoutParams(1, 1));
                    final Runnable autoplay = () -> {
                        if (destroyed[0]) return;
                        try { probe.evaluateJavascript(AUTOPLAY_JS, null); } catch (Exception ignored) {}
                        try {
                            long now = SystemClock.uptimeMillis();
                            float x = Math.max(0.5f, probe.getWidth() / 2f);
                            float y = Math.max(0.5f, probe.getHeight() / 2f);
                            MotionEvent down = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, x, y, 0);
                            probe.dispatchTouchEvent(down);
                            down.recycle();
                            MotionEvent up = MotionEvent.obtain(now, now, MotionEvent.ACTION_UP, x, y, 0);
                            probe.dispatchTouchEvent(up);
                            up.recycle();
                        } catch (Exception ignored) {}
                    };
                    probe.setWebViewClient(new WebViewClient() {
                        @Override
                        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                            return !isAllowedNavigation(request.getUrl());
                        }

                        @Override
                        public void onPageStarted(WebView view, String url, Bitmap favicon) {
                            try { view.evaluateJavascript(detectionJs(), null); } catch (Exception ignored) {}
                            super.onPageStarted(view, url, favicon);
                        }

                        @Override
                        public void onPageFinished(WebView view, String url) {
                            try { view.evaluateJavascript(detectionJs(), null); } catch (Exception ignored) {}
                            view.postDelayed(autoplay, 1500L);
                            view.postDelayed(autoplay, 3500L);
                        }

                        @Override
                        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                            Uri uri = request.getUrl();
                            String hostName = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
                            if (!isUnlimPlay(hostName) && !isMediaResource(uri) && isAdHost(hostName)) {
                                return new WebResourceResponse("text/plain", "UTF-8",
                                    new ByteArrayInputStream(new byte[0]));
                            }
                            Map<String, String> headers = request.getRequestHeaders();
                            if (isRealStream(uri, headers)) {
                                capture(view, uri, headers, destroyed, found, latch);
                                return super.shouldInterceptRequest(view, request);
                            }
                            WebResourceResponse response = super.shouldInterceptRequest(view, request);
                            if (response != null && isVideoMime(response.getMimeType())) {
                                capture(view, uri, headers, destroyed, found, latch);
                            }
                            return response;
                        }
                    });
                    probe.loadUrl(embedUrl);
                } catch (Exception ignored) {
                    latch.countDown();
                }
            });
            try {
                if (!latch.await(30, TimeUnit.SECONDS)) {
                    runOnUiThread(() -> destroyProbe(probeHolder[0]));
                    return null;
                }
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                runOnUiThread(() -> destroyProbe(probeHolder[0]));
                return null;
            } finally {
                activeLatch = null;
            }
            return found[0];
        }

        void destroyActiveProbe() {
            WebView probe = activeProbe;
            activeProbe = null;
            if (probe != null) runOnUiThread(() -> destroyProbe(probe));
            CountDownLatch latch = activeLatch;
            if (latch != null) latch.countDown();
        }

        private void capture(WebView view, Uri uri, Map<String, String> headers,
                             boolean[] destroyed, StreamInfo[] found, CountDownLatch latch) {
            if (destroyed[0]) return;
            StreamInfo info = new StreamInfo();
            info.url = uri.toString();
            info.referer = header(headers, "Referer");
            info.origin = header(headers, "Origin");
            String agent = header(headers, "User-Agent");
            info.userAgent = agent.isEmpty() ? VAULT_USER_AGENT : agent;
            String url = info.url.toLowerCase(Locale.ROOT);
            info.streamType = url.contains(".mp4") && !url.contains(".m3u8") ? "mp4" : "m3u8";
            found[0] = info;
            destroyed[0] = true;
            latch.countDown();
            runOnUiThread(() -> destroyProbe(view));
        }

        private boolean isRealStream(Uri uri, Map<String, String> headers) {
            String url = uri.toString().toLowerCase(Locale.ROOT);
            if (url.contains("test-videos.co.uk") || url.contains("/v1/stream/")) return false;
            boolean indexManifest = url.contains("index-")
                && !url.endsWith(".js") && !url.endsWith(".css") && !url.endsWith(".html")
                && !url.endsWith(".png") && !url.endsWith(".jpg");
            boolean media = url.contains(".m3u8") || url.contains(".mp4")
                || url.contains("master.txt") || indexManifest;
            if (!media) {
                String accept = header(headers, "Accept").toLowerCase(Locale.ROOT);
                media = isVideoMime(accept);
            }
            return media;
        }

        private boolean isVideoMime(String value) {
            String mime = value == null ? "" : value.toLowerCase(Locale.ROOT);
            return mime.contains("application/vnd.apple.mpegurl")
                || mime.contains("application/x-mpegurl")
                || mime.contains("video/mp4");
        }

        private String header(Map<String, String> headers, String name) {
            if (headers == null) return "";
            String direct = headers.get(name);
            if (direct != null) return direct;
            for (Map.Entry<String, String> entry : headers.entrySet()) {
                if (name.equalsIgnoreCase(entry.getKey())) {
                    return entry.getValue() == null ? "" : entry.getValue();
                }
            }
            return "";
        }

        private void destroyProbe(WebView probe) {
            if (probe == null) return;
            if (activeProbe == probe) activeProbe = null;
            try { probe.stopLoading(); } catch (Exception ignored) {}
            try {
                ViewParent parent = probe.getParent();
                if (parent instanceof ViewGroup) ((ViewGroup) parent).removeView(probe);
            } catch (Exception ignored) {}
            try { probe.destroy(); } catch (Exception ignored) {}
        }
    }

    /** Servidor loopback: descifra al vuelo y soporta Range para buscar dentro del video. */
    private final class LocalVaultServer implements Runnable {
        private final File vaultDir;
        private final VaultCipher cipher;
        private final CinenovaVault vault;
        private final String token = UUID.randomUUID().toString().replace("-", "");
        private final ExecutorService pool = Executors.newCachedThreadPool();
        private ServerSocket serverSocket;
        private volatile boolean running;

        LocalVaultServer(File vaultDir, VaultCipher cipher, CinenovaVault vault) {
            this.vaultDir = vaultDir;
            this.cipher = cipher;
            this.vault = vault;
        }

        void start() {
            try {
                serverSocket = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
                running = true;
                Thread thread = new Thread(this, "cinenova-vault-http");
                thread.setDaemon(true);
                thread.start();
            } catch (IOException ignored) {
                running = false;
            }
        }

        String urlFor(String itemId) {
            if (serverSocket == null) return "";
            return "http://127.0.0.1:" + serverSocket.getLocalPort() + "/" + token + "/" + itemId + "/stream";
        }

        void stop() {
            running = false;
            try { if (serverSocket != null) serverSocket.close(); } catch (IOException ignored) {}
            pool.shutdownNow();
        }

        @Override
        public void run() {
            while (running) {
                try {
                    final Socket socket = serverSocket.accept();
                    pool.execute(() -> handle(socket));
                } catch (IOException error) {
                    if (!running) break;
                }
            }
        }

        private void handle(Socket socket) {
            try {
                socket.setSoTimeout(10000);
                BufferedReader reader = new BufferedReader(
                    new InputStreamReader(socket.getInputStream(), StandardCharsets.ISO_8859_1));
                String requestLine = reader.readLine();
                if (requestLine == null) return;
                String range = null;
                String line;
                while ((line = reader.readLine()) != null && !line.isEmpty()) {
                    if (line.toLowerCase(Locale.ROOT).startsWith("range:")) {
                        range = line.substring(6).trim();
                    }
                }
                String[] words = requestLine.split(" ");
                String path = words.length > 1 ? words[1] : "";
                String[] parts = path.split("/");
                boolean head = requestLine.startsWith("HEAD ");
                if (parts.length < 4 || !token.equals(parts[1])) {
                    respond(socket, 404, "text/plain", new byte[0], null);
                    return;
                }
                String itemId = parts[2];
                if (!itemId.matches("[A-Za-z0-9_-]+")) {
                    respond(socket, 403, "text/plain", new byte[0], null);
                    return;
                }
                File itemDir = new File(vaultDir, itemId);
                String tail = parts[3];
                if ("stream".equals(tail) && parts.length == 4) {
                    serveMain(socket, itemId, itemDir, range, head);
                } else if ("seg".equals(tail) && parts.length == 5 && parts[4].matches("seg_[0-9]+\\.ts")) {
                    serveEncrypted(socket, new File(itemDir, parts[4] + ".cnv"), "video/mp2t", range, head);
                } else if ("key".equals(tail) && parts.length == 4) {
                    serveEncrypted(socket, new File(itemDir, "key.bin.cnv"), "application/octet-stream", range, head);
                } else {
                    respond(socket, 404, "text/plain", new byte[0], null);
                }
            } catch (Exception ignored) {
                try { respond(socket, 500, "text/plain", new byte[0], null); } catch (Exception inner) {}
            } finally {
                try { socket.close(); } catch (IOException ignored) {}
            }
        }

        private void serveMain(Socket socket, String itemId, File itemDir,
                               String range, boolean head) throws IOException {
            DownloadRecord record = vault.findRecord(itemId);
            if (record == null || !"ready".equals(record.status)
                || System.currentTimeMillis() >= record.expiresAt) {
                respond(socket, 403, "text/plain", new byte[0], null);
                return;
            }
            if ("m3u8".equals(record.streamType)) {
                File playlistFile = new File(itemDir, "index.m3u8.cnv");
                if (!playlistFile.exists()) {
                    respond(socket, 404, "text/plain", new byte[0], null);
                    return;
                }
                String base = urlFor(itemId);
                StringBuilder playlist = new StringBuilder();
                for (String raw : new String(cipher.readAll(playlistFile), StandardCharsets.UTF_8).split("\\r?\\n")) {
                    String entry = raw.trim();
                    if (entry.isEmpty()) continue;
                    if (entry.startsWith("#EXT-X-KEY")) {
                        playlist.append(entry.replaceAll("URI=\"[^\"]*\"",
                            "URI=\"" + Matcher.quoteReplacement(base + "/key") + "\"")).append('\n');
                    } else if (entry.startsWith("#")) {
                        playlist.append(entry).append('\n');
                    } else {
                        playlist.append(base).append("/seg/").append(entry).append('\n');
                    }
                }
                byte[] body = head ? new byte[0] : playlist.toString().getBytes(StandardCharsets.UTF_8);
                respond(socket, 200, "application/vnd.apple.mpegurl", body, null);
                return;
            }
            serveEncrypted(socket, new File(itemDir, "media.cnv"), "video/mp4", range, head);
        }

        private void serveEncrypted(Socket socket, File file, String contentType,
                                    String range, boolean head) throws IOException {
            if (!file.exists()) {
                respond(socket, 404, "text/plain", new byte[0], null);
                return;
            }
            long total = file.length() - VAULT_NONCE_LENGTH;
            if (total <= 0) {
                respond(socket, 404, "text/plain", new byte[0], null);
                return;
            }
            long start = 0;
            long end = total - 1;
            boolean partial = false;
            if (range != null && range.toLowerCase(Locale.ROOT).startsWith("bytes=")) {
                String spec = range.substring(6).trim();
                int dash = spec.indexOf('-');
                if (dash >= 0) {
                    try {
                        if (dash > 0) start = Long.parseLong(spec.substring(0, dash).trim());
                        if (dash + 1 < spec.length()) end = Long.parseLong(spec.substring(dash + 1).trim());
                        partial = true;
                    } catch (NumberFormatException ignored) {
                        partial = false;
                    }
                }
            }
            if (start < 0 || start >= total) {
                respond(socket, 416, "text/plain", new byte[0], "bytes */" + total);
                return;
            }
            if (end < start || end >= total) end = total - 1;
            long length = end - start + 1;
            writeHead(socket, partial ? 206 : 200, contentType, length,
                partial ? "bytes " + start + "-" + end + "/" + total : null);
            if (head) return;
            try (BufferedOutputStream out = new BufferedOutputStream(socket.getOutputStream())) {
                long position = start;
                while (position <= end) {
                    int chunk = (int) Math.min(262144L, end - position + 1);
                    byte[] plain = cipher.decryptRange(file, position, chunk);
                    if (plain.length == 0) break;
                    out.write(plain);
                    position += plain.length;
                }
                out.flush();
            }
        }

        private void respond(Socket socket, int status, String contentType,
                             byte[] body, String contentRange) throws IOException {
            writeHead(socket, status, contentType, body.length, contentRange);
            if (body.length > 0) socket.getOutputStream().write(body);
            socket.getOutputStream().flush();
        }

        private void writeHead(Socket socket, int status, String contentType,
                               long length, String contentRange) throws IOException {
            String reason;
            if (status == 200) reason = "OK";
            else if (status == 206) reason = "Partial Content";
            else if (status == 403) reason = "Forbidden";
            else if (status == 404) reason = "Not Found";
            else if (status == 416) reason = "Range Not Satisfiable";
            else reason = "Error";
            StringBuilder head = new StringBuilder("HTTP/1.1 ").append(status).append(' ').append(reason).append("\r\n")
                .append("Content-Type: ").append(contentType).append("\r\n")
                .append("Content-Length: ").append(length).append("\r\n")
                .append("Accept-Ranges: bytes\r\n")
                .append("Cache-Control: no-store\r\n")
                .append("Connection: close\r\n");
            if (contentRange != null) head.append("Content-Range: ").append(contentRange).append("\r\n");
            head.append("\r\n");
            socket.getOutputStream().write(head.toString().getBytes(StandardCharsets.ISO_8859_1));
        }
    }

    /** Bóveda privada, índice persistente y control de descargas expuesto al WebView. */
    private final class CinenovaVault {
        private final File vaultDir = new File(getFilesDir(), "vault");
        private final File indexFile = new File(vaultDir, "index.json");
        private final VaultCipher cipher = new VaultCipher(MainActivity.this);
        private final ExecutorService executor = Executors.newCachedThreadPool();
        private final Map<String, DownloadTask> tasks = new HashMap<>();
        private final Set<String> startedItems = new HashSet<>();
        private final PowerManager.WakeLock wakeLock;
        private JSONObject index = new JSONObject();
        private LocalVaultServer server;
        private long lastProgressEmit;

        CinenovaVault() {
            PowerManager manager = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wakeLock = manager == null ? null
                : manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "cinenova:vault");
            if (wakeLock != null) wakeLock.setReferenceCounted(false);
            if (!vaultDir.exists()) vaultDir.mkdirs();
            loadIndex();
            server = new LocalVaultServer(vaultDir, cipher, this);
            server.start();
        }

        private synchronized void loadIndex() {
            index = new JSONObject();
            try {
                if (indexFile.exists()) index = new JSONObject(readText(indexFile));
            } catch (Exception ignored) {
                index = new JSONObject();
            }
            items();
        }

        private synchronized JSONArray items() {
            JSONArray array = index.optJSONArray("items");
            if (array == null) {
                array = new JSONArray();
                try { index.put("items", array); } catch (Exception ignored) {}
            }
            return array;
        }

        private synchronized void saveIndex() {
            try { writeText(indexFile, index.toString()); } catch (IOException ignored) {}
        }

        private synchronized List<DownloadRecord> records() {
            JSONArray array = items();
            List<DownloadRecord> result = new ArrayList<>();
            for (int position = 0; position < array.length(); position += 1) {
                JSONObject data = array.optJSONObject(position);
                if (data != null) result.add(recordFrom(data));
            }
            return result;
        }

        private DownloadRecord recordFrom(JSONObject data) {
            DownloadRecord record = new DownloadRecord();
            record.itemId = data.optString("itemId", "");
            record.tmdbId = data.optInt("tmdbId", 0);
            record.mediaType = data.optString("mediaType", "movie");
            record.season = data.optInt("season", 0);
            record.episode = data.optInt("episode", 0);
            record.title = data.optString("title", "");
            record.posterPath = data.optString("posterPath", "");
            record.status = data.optString("status", "paused");
            record.progress = data.optInt("progress", 0);
            record.bytesDownloaded = data.optLong("bytesDownloaded", 0);
            record.totalBytes = data.optLong("totalBytes", 0);
            record.downloadedAt = data.optLong("downloadedAt", 0);
            record.expiresAt = data.optLong("expiresAt", 0);
            record.streamType = data.optString("streamType", "mp4");
            record.errorReason = data.optString("errorReason", "");
            return record;
        }

        synchronized DownloadRecord findRecord(String itemId) {
            for (DownloadRecord record : records()) {
                if (record.itemId.equals(itemId)) return record;
            }
            return null;
        }

        synchronized void syncRecord(DownloadRecord record) {
            JSONArray array = items();
            for (int position = 0; position < array.length(); position += 1) {
                JSONObject data = array.optJSONObject(position);
                if (data != null && record.itemId.equals(data.optString("itemId"))) {
                    try { array.put(position, record.toJson()); } catch (Exception ignored) {}
                    saveIndex();
                    return;
                }
            }
        }

        void reconcileOnStartup() {
            JSONArray array = items();
            JSONArray kept = new JSONArray();
            Set<String> ids = new HashSet<>();
            for (int position = 0; position < array.length(); position += 1) {
                JSONObject data = array.optJSONObject(position);
                if (data == null) continue;
                DownloadRecord record = recordFrom(data);
                if (record.itemId.isEmpty()) continue;
                if ("downloading".equals(record.status)) record.status = "paused";
                if (!hasPhysicalFiles(record, new File(vaultDir, record.itemId))) continue;
                kept.put(record.toJson());
                ids.add(record.itemId);
            }
            try { index.put("items", kept); } catch (Exception ignored) {}
            File[] children = vaultDir.listFiles();
            if (children != null) {
                for (File child : children) {
                    if (child.isDirectory() && !ids.contains(child.getName())) deleteRecursive(child);
                }
            }
            saveIndex();
        }

        private boolean hasPhysicalFiles(DownloadRecord record, File directory) {
            if ("m3u8".equals(record.streamType)) {
                if (!new File(directory, "index.m3u8.cnv").exists()) return false;
                File[] files = directory.listFiles();
                if (files == null) return false;
                for (File file : files) {
                    if (file.getName().endsWith(".ts.cnv")) return true;
                }
                return false;
            }
            return new File(directory, "media.cnv").exists()
                || new File(directory, "media.cnv.part").exists();
        }

        @JavascriptInterface
        public boolean isMobileDownloadsSupported() {
            return !detectTelevisionDevice();
        }

        @JavascriptInterface
        public String getStorageInfo() {
            JSONObject data = new JSONObject();
            try {
                StatFs stats = new StatFs(getFilesDir().getPath());
                data.put("freeBytes", stats.getAvailableBytes());
                data.put("vaultUsedBytes", vaultUsedBytes(vaultDir));
            } catch (Exception ignored) {}
            return data.toString();
        }

        private long vaultUsedBytes(File directory) {
            long total = 0;
            File[] files = directory.listFiles();
            if (files != null) {
                for (File file : files) {
                    total += file.isDirectory() ? vaultUsedBytes(file) : file.length();
                }
            }
            return total;
        }

        @JavascriptInterface
        public String listDownloads() {
            JSONArray array = items();
            boolean changed = false;
            long now = System.currentTimeMillis();
            for (int position = 0; position < array.length(); position += 1) {
                JSONObject data = array.optJSONObject(position);
                if (data == null) continue;
                DownloadRecord record = recordFrom(data);
                if ("ready".equals(record.status) && record.expiresAt <= now) {
                    record.status = "expired";
                    try { array.put(position, record.toJson()); } catch (Exception ignored) {}
                    changed = true;
                }
            }
            if (changed) saveIndex();
            return array.toString();
        }

        /** Recibe el stream detectado por el WebView oculto y arranca la descarga con Referer. */
        @JavascriptInterface
        public void reportDetectedStream(String itemId, String streamUrl, String pageUrl) {
            if (itemId == null || itemId.isEmpty()) return;
            String url = streamUrl == null ? "" : streamUrl.trim();
            String lower = url.toLowerCase(Locale.ROOT);
            if (lower.startsWith("blob:") || lower.startsWith("data:")
                || lower.contains("test-videos.co.uk") || lower.contains("/v1/stream/segment")) return;
            if (!lower.startsWith("http://") && !lower.startsWith("https://")) return;
            DownloadRecord record = findRecord(itemId);
            if (record == null) return;
            StreamInfo info = new StreamInfo();
            info.url = url;
            info.referer = pageUrl == null ? "" : pageUrl;
            info.origin = originOf(info.referer);
            info.userAgent = VAULT_USER_AGENT;
            info.streamType = lower.contains(".mp4") && !lower.contains(".m3u8") && !lower.contains("mpegurl")
                ? "mp4" : "m3u8";
            StreamExtractor extractor = activeExtractor;
            beginDetectedDownload(record, info);
            if (extractor != null) extractor.destroyActiveProbe();
        }

        private boolean beginDetectedDownload(DownloadRecord record, StreamInfo info) {
            if (record == null || info == null || info.url == null || info.url.isEmpty()) return false;
            if (!"downloading".equals(record.status) && !"paused".equals(record.status)) return false;
            synchronized (this) {
                if (!startedItems.add(record.itemId)) return false;
            }
            try {
                writeText(new File(new File(vaultDir, record.itemId), "source.json"), info.toJson().toString());
            } catch (IOException error) {
                synchronized (this) { startedItems.remove(record.itemId); }
                markError(record, "source_write_failed");
                return false;
            }
            DownloadTask task = new DownloadTask(record, info, this);
            synchronized (tasks) { tasks.put(record.itemId, task); }
            acquireWake();
            executor.execute(task);
            return true;
        }

        private String originOf(String pageUrl) {
            if (pageUrl == null || pageUrl.isEmpty()) return "";
            try {
                Uri uri = Uri.parse(pageUrl);
                String scheme = uri.getScheme();
                String host = uri.getHost();
                if (scheme == null || host == null) return "";
                int port = uri.getPort();
                return scheme + "://" + host + (port > 0 ? ":" + port : "");
            } catch (Exception ignored) {
                return "";
            }
        }

        @JavascriptInterface
        public String startDownload(String metadataJson, String embedUrl) {
            try {
                if (!isMobileDownloadsSupported()) return result(false, "not_supported");
                JSONObject metadata = new JSONObject(metadataJson == null ? "{}" : metadataJson);
                final int tmdbId = metadata.optInt("tmdbId", 0);
                final String mediaType = "tv".equals(metadata.optString("mediaType", "movie")) ? "tv" : "movie";
                final int season = metadata.optInt("season", 0);
                final int episode = metadata.optInt("episode", 0);
                final String title = metadata.optString("title", "");
                final String posterPath = metadata.optString("posterPath", "");
                if (tmdbId <= 0) return result(false, "invalid_metadata");
                StatFs stats = new StatFs(getFilesDir().getPath());
                if (stats.getAvailableBytes() < VAULT_MIN_FREE_BYTES) {
                    return result(false, "insufficient_storage");
                }
                synchronized (this) {
                    for (DownloadRecord existing : records()) {
                        if (existing.tmdbId == tmdbId && mediaType.equals(existing.mediaType)
                            && existing.season == season && existing.episode == episode) {
                            return result(false, "duplicate");
                        }
                    }
                }
                final String itemId = UUID.randomUUID().toString().replace("-", "");
                DownloadRecord record = new DownloadRecord();
                record.itemId = itemId;
                record.tmdbId = tmdbId;
                record.mediaType = mediaType;
                record.season = season;
                record.episode = episode;
                record.title = title;
                record.posterPath = posterPath;
                record.status = "downloading";
                record.progress = 0;
                record.bytesDownloaded = 0;
                record.totalBytes = 0;
                record.downloadedAt = 0;
                record.expiresAt = 0;
                record.streamType = "mp4";
                record.errorReason = "";
                synchronized (this) {
                    items().put(record.toJson());
                    saveIndex();
                }
                emitProgress(record, "downloading");
                final DownloadRecord pending = record;
                executor.execute(() -> {
                    StreamExtractor extractor = new StreamExtractor(itemId);
                    activeExtractor = extractor;
                    StreamInfo info;
                    try {
                        info = extractor.extract(embedUrl);
                    } finally {
                        if (activeExtractor == extractor) activeExtractor = null;
                    }
                    if (info != null && info.url != null && !info.url.isEmpty()) {
                        beginDetectedDownload(pending, info);
                        return;
                    }
                    synchronized (this) {
                        if (startedItems.contains(itemId)) return;
                    }
                    markError(pending, "No se detectó stream reproducible en este servidor");
                });
                JSONObject accepted = new JSONObject();
                try {
                    accepted.put("ok", true);
                    accepted.put("itemId", itemId);
                } catch (Exception ignored) {}
                return accepted.toString();
            } catch (Exception error) {
                return result(false, "invalid_metadata");
            }
        }

        @JavascriptInterface
        public String pauseDownload(String itemId) {
            DownloadTask task;
            synchronized (tasks) { task = tasks.get(itemId); }
            if (task != null) task.cancel();
            DownloadRecord record = findRecord(itemId);
            if (record == null) return result(false, "not_found");
            if ("downloading".equals(record.status)) {
                record.status = "paused";
                syncRecord(record);
                emitProgress(record, "paused");
            }
            releaseWakeIfIdle();
            return result(true, null);
        }

        @JavascriptInterface
        public String resumeDownload(String itemId) {
            DownloadRecord record = findRecord(itemId);
            if (record == null || !"paused".equals(record.status)) return result(false, "invalid_state");
            try {
                StreamInfo info = StreamInfo.fromJson(new JSONObject(readText(
                    new File(new File(vaultDir, itemId), "source.json"))));
                record.status = "downloading";
                record.errorReason = "";
                syncRecord(record);
                emitProgress(record, "downloading");
                DownloadTask task = new DownloadTask(record, info, this);
                synchronized (tasks) { tasks.put(itemId, task); }
                acquireWake();
                executor.execute(task);
                return result(true, null);
            } catch (Exception ignored) {
                return result(false, "source_unavailable");
            }
        }

        @JavascriptInterface
        public String deleteDownload(String itemId) {
            if (itemId == null || itemId.isEmpty()) return result(false, "not_found");
            DownloadTask task;
            synchronized (tasks) { task = tasks.get(itemId); }
            if (task != null) {
                task.cancel();
                task.awaitCleanup();
                synchronized (tasks) { tasks.remove(itemId); }
            }
            deleteRecursive(new File(vaultDir, itemId));
            synchronized (this) {
                JSONArray array = items();
                for (int position = array.length() - 1; position >= 0; position -= 1) {
                    JSONObject data = array.optJSONObject(position);
                    if (data != null && itemId.equals(data.optString("itemId"))) array.remove(position);
                }
                startedItems.remove(itemId);
                saveIndex();
            }
            releaseWakeIfIdle();
            JSONObject detail = new JSONObject();
            try { detail.put("itemId", itemId); } catch (Exception ignored) {}
            dispatch("cinenova-download-deleted", detail);
            return result(true, null);
        }

        @JavascriptInterface
        public String deleteExpiredDownloads() {
            listDownloads();
            int removed = 0;
            for (DownloadRecord record : records()) {
                if ("expired".equals(record.status)) {
                    deleteDownload(record.itemId);
                    removed += 1;
                }
            }
            JSONObject data = new JSONObject();
            try { data.put("ok", true); data.put("removed", removed); } catch (Exception ignored) {}
            return data.toString();
        }

        @JavascriptInterface
        public String deleteAllDownloads() {
            List<String> ids = new ArrayList<>();
            for (DownloadRecord record : records()) ids.add(record.itemId);
            for (String itemId : ids) deleteDownload(itemId);
            return deleteExpiredDownloads();
        }

        @JavascriptInterface
        public String renewDownload(String itemId) {
            DownloadRecord record = findRecord(itemId);
            if (record == null) return result(false, "not_found");
            record.expiresAt = System.currentTimeMillis() + VAULT_DAY_MS;
            if ("expired".equals(record.status)) record.status = "ready";
            syncRecord(record);
            emitProgress(record, record.status);
            return result(true, null);
        }

        @JavascriptInterface
        public String getPlaybackUrl(String itemId) {
            DownloadRecord record = findRecord(itemId);
            if (record == null || !"ready".equals(record.status)
                || System.currentTimeMillis() >= record.expiresAt) {
                return "";
            }
            return server == null ? "" : server.urlFor(itemId);
        }

        void markError(DownloadRecord record, String reason) {
            record.status = "error";
            record.errorReason = reason;
            syncRecord(record);
            emitProgress(record, "error");
        }

        private void emitProgress(DownloadRecord record, String status) {
            long now = System.currentTimeMillis();
            if ("downloading".equals(status) && now - lastProgressEmit < 500) return;
            lastProgressEmit = now;
            JSONObject detail = new JSONObject();
            try {
                detail.put("itemId", record.itemId);
                detail.put("tmdbId", record.tmdbId);
                detail.put("mediaType", record.mediaType);
                detail.put("season", record.season);
                detail.put("episode", record.episode);
                detail.put("title", record.title);
                detail.put("status", status);
                detail.put("progress", Math.max(0, Math.min(100, record.progress)));
                detail.put("bytesDownloaded", record.bytesDownloaded);
                detail.put("totalBytes", record.totalBytes);
                detail.put("streamType", record.streamType);
                detail.put("errorReason", record.errorReason == null ? "" : record.errorReason);
                detail.put("expiresAt", record.expiresAt);
            } catch (Exception ignored) {}
            dispatch("cinenova-download-progress", detail);
        }

        private void dispatch(String type, JSONObject detail) {
            final String script = "window.dispatchEvent(new CustomEvent(" + JSONObject.quote(type)
                + ",{detail:" + JSONObject.quote(detail.toString()) + "}));";
            runOnUiThread(() -> {
                try {
                    if (bridge != null) bridge.getWebView().evaluateJavascript(script, null);
                } catch (Exception ignored) {}
            });
        }

        private String result(boolean ok, String reason) {
            JSONObject data = new JSONObject();
            try {
                data.put("ok", ok);
                if (reason != null) data.put("reason", reason);
            } catch (Exception ignored) {}
            return data.toString();
        }

        private void acquireWake() {
            if (wakeLock == null) return;
            try { wakeLock.acquire(10 * 60 * 1000); } catch (Exception ignored) {}
        }

        private void releaseWakeIfIdle() {
            synchronized (tasks) { if (!tasks.isEmpty()) return; }
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        }

        void shutdown() {
            List<DownloadTask> current;
            synchronized (tasks) { current = new ArrayList<>(tasks.values()); }
            for (DownloadTask task : current) task.cancel();
            if (server != null) server.stop();
            executor.shutdownNow();
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        }
    }

    /** Descarga en segundo plano con reanudación por Range y cifrado al vuelo. */
    private final class DownloadTask implements Runnable {
        private final DownloadRecord record;
        private final StreamInfo info;
        private final CinenovaVault owner;
        private final CountDownLatch finished = new CountDownLatch(1);
        volatile boolean cancelled;
        volatile HttpURLConnection connection;
        volatile InputStream inputStream;

        DownloadTask(DownloadRecord record, StreamInfo info, CinenovaVault owner) {
            this.record = record;
            this.info = info;
            this.owner = owner;
        }

        void cancel() {
            cancelled = true;
            closeInput();
        }

        void awaitCleanup() {
            try { finished.await(3, TimeUnit.SECONDS); } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
            }
        }

        @Override
        public void run() {
            try {
                File directory = new File(owner.vaultDir, record.itemId);
                if (!directory.exists()) directory.mkdirs();
                if ("m3u8".equals(info.streamType)) {
                    downloadHls(directory);
                } else {
                    downloadMp4(directory);
                    record.streamType = "mp4";
                }
                if (cancelled) return;
                record.status = "ready";
                record.progress = 100;
                record.bytesDownloaded = Math.max(record.bytesDownloaded, record.totalBytes);
                record.downloadedAt = System.currentTimeMillis();
                record.expiresAt = record.downloadedAt + VAULT_DAY_MS;
                record.errorReason = "";
                owner.syncRecord(record);
                owner.emitProgress(record, "ready");
            } catch (Exception error) {
                if (!cancelled) {
                    record.status = "error";
                    record.errorReason = String.valueOf(error.getMessage());
                    owner.syncRecord(record);
                    owner.emitProgress(record, "error");
                }
            } finally {
                closeInput();
                owner.syncRecord(record);
                finished.countDown();
                synchronized (owner.tasks) {
                    if (owner.tasks.get(record.itemId) == this) owner.tasks.remove(record.itemId);
                }
                owner.releaseWakeIfIdle();
            }
        }

        private HttpURLConnection openConnection(String url) throws IOException {
            HttpURLConnection link = (HttpURLConnection) new URL(url).openConnection();
            link.setConnectTimeout(15000);
            link.setReadTimeout(20000);
            link.setInstanceFollowRedirects(true);
            link.setRequestProperty("User-Agent", info.userAgent == null || info.userAgent.isEmpty()
                ? VAULT_USER_AGENT : info.userAgent);
            if (info.referer != null && !info.referer.isEmpty()) link.setRequestProperty("Referer", info.referer);
            if (info.origin != null && !info.origin.isEmpty()) link.setRequestProperty("Origin", info.origin);
            link.setRequestProperty("Accept", "*/*");
            return link;
        }

        private void downloadMp4(File directory) throws IOException {
            File part = new File(directory, "media.cnv.part");
            byte[] nonce;
            long offset;
            if (part.exists() && part.length() > VAULT_NONCE_LENGTH) {
                nonce = owner.cipher.readNonce(part);
                offset = part.length() - VAULT_NONCE_LENGTH;
            } else {
                nonce = owner.cipher.newNonce();
                owner.cipher.writeHeader(part, nonce);
                offset = 0;
            }
            HttpURLConnection link = openConnection(info.url);
            link.setRequestProperty("Range", "bytes=" + offset + "-");
            connection = link;
            int code = link.getResponseCode();
            if (code < 200 || code >= 300) throw new IOException("HTTP " + code);
            long declared = link.getContentLengthLong();
            if (code == 200 && offset > 0) {
                offset = 0;
                owner.cipher.writeHeader(part, nonce);
            }
            record.totalBytes = Math.max(0, offset + Math.max(0, declared));
            InputStream stream = link.getInputStream();
            inputStream = stream;
            RandomAccessFile output = new RandomAccessFile(part, "rw");
            try {
                output.seek(VAULT_NONCE_LENGTH + offset);
                byte[] buffer = new byte[65536];
                byte[] encoded = new byte[65536];
                long position = offset;
                long last = System.currentTimeMillis();
                int read;
                while (!cancelled && (read = stream.read(buffer)) != -1) {
                    owner.cipher.crypt(buffer, read, encoded, position, nonce);
                    output.write(encoded, 0, read);
                    position += read;
                    record.bytesDownloaded = position;
                    record.progress = record.totalBytes > 0
                        ? (int) Math.min(100, position * 100 / record.totalBytes) : 0;
                    long now = System.currentTimeMillis();
                    if (now - last >= 500) {
                        owner.syncRecord(record);
                        owner.emitProgress(record, "downloading");
                        last = now;
                    }
                }
            } finally {
                output.close();
            }
            if (cancelled) return;
            File finalFile = new File(directory, "media.cnv");
            if (finalFile.exists() && !finalFile.delete()) throw new IOException("No se pudo reemplazar el archivo");
            if (!part.renameTo(finalFile)) throw new IOException("No se pudo finalizar el archivo");
        }

        private void downloadHls(File directory) throws IOException {
            String playlist = fetchText(info.url);
            String baseUrl = info.url;
            if (playlist.contains("#EXT-X-STREAM-INF")) {
                String[] lines = playlist.split("\\r?\\n");
                String variant = null;
                for (int position = 0; position < lines.length; position += 1) {
                    if (!lines[position].trim().startsWith("#EXT-X-STREAM-INF")) continue;
                    for (int next = position + 1; next < lines.length; next += 1) {
                        String candidate = lines[next].trim();
                        if (!candidate.isEmpty() && !candidate.startsWith("#")) {
                            variant = resolve(baseUrl, candidate);
                            break;
                        }
                    }
                    break;
                }
                if (variant != null && !variant.equals(baseUrl)) {
                    baseUrl = variant;
                    playlist = fetchText(variant);
                }
            }
            String[] lines = playlist.split("\\r?\\n");
            for (String raw : lines) {
                String line = raw.trim();
                if (!line.startsWith("#EXT-X-KEY") || !line.toUpperCase(Locale.ROOT).contains("METHOD=AES-128")) continue;
                String uri = attribute(line, "URI");
                if (uri != null && !uri.isEmpty()) {
                    byte[] key = fetchBytes(resolve(baseUrl, uri));
                    if (key.length > 0) owner.cipher.writeEncrypted(new File(directory, "key.bin.cnv"), key);
                }
            }
            List<String> localLines = new ArrayList<>();
            int index = 0;
            long last = System.currentTimeMillis();
            for (String raw : lines) {
                if (cancelled) return;
                String line = raw.trim();
                if (line.startsWith("#EXT-X-KEY")) {
                    localLines.add(line.replaceAll("URI=\"[^\"]*\"", "URI=\"key\""));
                } else if (!line.isEmpty() && !line.startsWith("#")) {
                    byte[] segment = fetchBytes(resolve(baseUrl, line));
                    String name = String.format(Locale.ROOT, "seg_%05d.ts", index++);
                    owner.cipher.writeEncrypted(new File(directory, name + ".cnv"), segment);
                    record.bytesDownloaded += segment.length;
                    record.progress = record.totalBytes > 0
                        ? (int) Math.min(100, record.bytesDownloaded * 100 / record.totalBytes) : record.progress;
                    long now = System.currentTimeMillis();
                    if (now - last >= 500) {
                        owner.syncRecord(record);
                        owner.emitProgress(record, "downloading");
                        last = now;
                    }
                    localLines.add(name);
                } else if (!line.isEmpty()) {
                    localLines.add(line);
                }
            }
            StringBuilder localPlaylist = new StringBuilder();
            for (String line : localLines) localPlaylist.append(line).append('\n');
            owner.cipher.writeEncrypted(new File(directory, "index.m3u8.cnv"),
                localPlaylist.toString().getBytes(StandardCharsets.UTF_8));
            record.streamType = "m3u8";
            if (record.totalBytes <= 0) record.totalBytes = record.bytesDownloaded;
        }

        private byte[] fetchBytes(String url) throws IOException {
            HttpURLConnection link = openConnection(url);
            connection = link;
            int code = link.getResponseCode();
            if (code < 200 || code >= 300) throw new IOException("HTTP " + code);
            InputStream stream = link.getInputStream();
            inputStream = stream;
            java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[16384];
            int read;
            while ((read = stream.read(buffer)) != -1) {
                if (cancelled) break;
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }

        private String fetchText(String url) throws IOException {
            return new String(fetchBytes(url), StandardCharsets.UTF_8);
        }

        private static String resolve(String base, String reference) {
            try { return new URL(new URL(base), reference).toString(); } catch (Exception error) { return reference; }
        }

        private static String attribute(String line, String name) {
            Matcher matcher = Pattern.compile(name + "=\"([^\"]+)\"").matcher(line);
            return matcher.find() ? matcher.group(1) : null;
        }

        private void closeInput() {
            try { if (inputStream != null) inputStream.close(); } catch (Exception ignored) {}
            try { if (connection != null) connection.disconnect(); } catch (Exception ignored) {}
        }
    }

}
