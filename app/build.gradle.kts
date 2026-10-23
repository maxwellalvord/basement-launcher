plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.maxxity.basement"
    compileSdk = 34

    defaultConfig {
        applicationId = "dev.maxxity.basement"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1"
    }
    buildTypes {
        release { isMinifyEnabled = false }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    // Serves app/src/main/assets over a real https:// origin so ES modules and fetch() behave like a normal site
    implementation("androidx.webkit:webkit:1.11.0")
}
