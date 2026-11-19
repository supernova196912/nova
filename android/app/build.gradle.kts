plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

fun prop(name: String): String =
    (project.findProperty(name) as String?) ?: error("Falta la propiedad '$name' en gradle.properties")

android {
    namespace = "com.peliskong.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.peliskong.app"
        minSdk = 21
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        ndk {
            // LibVLC incluye binarios nativos por ABI. Quita las que no necesites para reducir el APK.
            abiFilters += listOf("armeabi-v7a", "arm64-v8a", "x86", "x86_64")
        }
    }

    buildTypes {
        debug {
            buildConfigField("String", "WEB_APP_URL", "\"${prop("peliskong.webUrl.debug")}\"")
        }
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            buildConfigField("String", "WEB_APP_URL", "\"${prop("peliskong.webUrl.release")}\"")
            // Solo para poder instalar el release de prueba. Reemplázalo por tu propia firma.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("org.videolan.android:libvlc-all:3.6.0")
}
