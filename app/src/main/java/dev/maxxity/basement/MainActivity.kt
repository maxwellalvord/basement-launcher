package dev.maxxity.basement

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.IntentFilter
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.Drawable
import android.os.Bundle
import android.provider.Settings
import android.util.Base64
import android.util.Log
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * The whole launcher is one full-screen WebView.
 * Kotlin only does what the web page can't: list installed apps and launch them.
 * Everything you see (the 3D basement, the app dock, the clock) is HTML/JS in app/src/main/assets.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView

    // Building the app list renders every icon to PNG, which is slow. Do it once, redo it only when apps change
    @Volatile private var appsCache: String? = null
    private val packageChanged = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) { appsCache = null }
    }

    // Serves assets/ at https://appassets.androidplatform.net/assets/... (a real origin, so modules and fetch work)
    private val assets by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Lets you open chrome://inspect on your Windows PC (with adb forwarding) and debug the page like a website
        WebView.setWebContentsDebuggingEnabled(true)

        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#0B0F17"))
            setLayerType(View.LAYER_TYPE_HARDWARE, null)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            addJavascriptInterface(Bridge(), "Android")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    assets.shouldInterceptRequest(request.url)
            }
        }
        setContentView(web)
        registerReceiver(packageChanged, IntentFilter().apply {
            addAction(Intent.ACTION_PACKAGE_ADDED)
            addAction(Intent.ACTION_PACKAGE_REMOVED)
            addAction(Intent.ACTION_PACKAGE_REPLACED)
            addDataScheme("package")
        })
        web.loadUrl("https://appassets.androidplatform.net/assets/index.html")
    }

    // Home pressed while we're already on screen: tell the page so it can reset focus
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        web.evaluateJavascript("window.onHome && window.onHome()", null)
    }

    // A launcher has nowhere to go "back" to. Let the page decide (close a menu, etc.)
    @Deprecated("Fine for a TV launcher targeting API 34")
    override fun onBackPressed() {
        web.evaluateJavascript("window.onBack && window.onBack()", null)
    }

    override fun onDestroy() {
        unregisterReceiver(packageChanged)
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        web.onResume(); web.resumeTimers()
    }

    // Stop rendering the 3D scene while another app is in front (saves the TV's GPU and heat)
    override fun onPause() {
        web.onPause(); web.pauseTimers()
        super.onPause()
    }

    /** Methods the page calls as window.Android.xxx(). They run on a background thread. */
    inner class Bridge {

        @JavascriptInterface
        fun apps(): String {
            appsCache?.let { return it }
            val pm = packageManager
            val seen = mutableSetOf<String>()
            val out = JSONArray()
            val queries = listOf(Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER)
            for (cat in queries) {
                val intent = Intent(Intent.ACTION_MAIN).addCategory(cat)
                for (ri in pm.queryIntentActivities(intent, 0)) {
                    val pkg = ri.activityInfo.packageName
                    if (pkg == packageName || !seen.add(pkg)) continue
                    val app = ri.activityInfo.applicationInfo
                    // TV apps ship a 16:9 banner; phone apps only have a square icon
                    val banner = pm.getApplicationBanner(app) ?: ri.activityInfo.loadBanner(pm)
                    val art = banner ?: ri.loadIcon(pm)
                    out.put(JSONObject().apply {
                        put("pkg", pkg)
                        put("label", ri.loadLabel(pm).toString())
                        put("tv", cat == Intent.CATEGORY_LEANBACK_LAUNCHER)
                        put("banner", banner != null)
                        put("art", toDataUri(art, if (banner != null) 320 else 128, if (banner != null) 180 else 128))
                    })
                }
            }
            return out.toString().also { appsCache = it }
        }

        @JavascriptInterface
        fun launch(pkg: String) {
            runOnUiThread {
                val pm = packageManager
                val intent = pm.getLeanbackLaunchIntentForPackage(pkg) ?: pm.getLaunchIntentForPackage(pkg)
                if (intent == null) {
                    Log.w("Basement", "No launch intent for $pkg")
                    return@runOnUiThread
                }
                startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        }

        @JavascriptInterface
        fun openSettings() {
            runOnUiThread { startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        }
    }

    private fun toDataUri(d: Drawable, w: Int, h: Int): String {
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        d.setBounds(0, 0, w, h)
        d.draw(c)
        val bytes = ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        bmp.recycle()
        return "data:image/png;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
    }
}
