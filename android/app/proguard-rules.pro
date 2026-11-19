# Métodos expuestos a JavaScript: R8 no debe renombrarlos ni eliminarlos.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface

# LibVLC usa JNI y reflexión.
-keep class org.videolan.libvlc.** { *; }
-keep class org.videolan.medialibrary.** { *; }
