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
import android.media.tv.TvContract
import android.media.tv.TvInputManager
import android.os.Bundle
import android.provider.Settings
import android.util.Base64
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import java.util.concurrent.Executors

/**
 * The whole launcher is one full-screen WebView.
 * Kotlin only does what the web page can't: list installed apps and launch them.
 * Everything you see (the 3D basement, the app dock, the clock) is HTML/JS in app/src/main/assets.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView

    // Background threads for homelab calls, so the page never waits on the network
    private val io = Executors.newFixedThreadPool(3)

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
        // While the home screen is showing, keep the display on: no Google ambient slideshow. Lilly is the screensaver now.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
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
        io.shutdownNow()
        unregisterReceiver(packageChanged)
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        web.onResume(); web.resumeTimers()
        web.evaluateJavascript("window.onResumeApp && window.onResumeApp()", null)
    }

    // Stop rendering the 3D scene while another app is in front (saves the TV's GPU and heat)
    override fun onPause() {
        web.evaluateJavascript("window.onPauseApp && window.onPauseApp()", null)
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

        /** HDMI and other passthrough inputs. A device that announced itself over HDMI-CEC (e.g. "PlayStation 5")
         *  shows up as a child of its HDMI port; we show the device name instead of the bare port. */
        @JavascriptInterface
        fun inputs(): String {
            val tim = getSystemService(Context.TV_INPUT_SERVICE) as? TvInputManager ?: return "[]"
            val all = tim.tvInputList.filter { it.isPassthroughInput && !it.isHidden(this@MainActivity) }
            val parentsWithChildren = all.mapNotNull { it.parentId }.toSet()
            val out = JSONArray()
            for (info in all) {
                if (info.id in parentsWithChildren) continue
                val custom = info.loadCustomLabel(this@MainActivity)?.toString()
                val label = if (!custom.isNullOrBlank()) custom else info.loadLabel(this@MainActivity).toString()
                out.put(JSONObject().put("id", info.id).put("label", label))
            }
            return out.toString()
        }

        /** Hands the input to the TV's own live-TV app, tuned straight to that HDMI port. */
        @JavascriptInterface
        fun switchInput(id: String) {
            runOnUiThread {
                try {
                    val uri = TvContract.buildChannelUriForPassthroughInput(id)
                    startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                } catch (e: Exception) {
                    Log.w("Basement", "Could not switch to input $id", e)
                }
            }
        }

        /**
         * HTTP to the homelab on the page's behalf. The page is served over https, so the WebView blocks its
         * fetch() calls to plain-http LAN services (mixed content). Native code isn't bound by that rule.
         * Only private LAN addresses are allowed, so the page can't be used to call out to the internet.
         * The answer comes back asynchronously through window.__native(id, status, body).
         */
        @JavascriptInterface
        fun request(id: String, method: String, url: String, headersJson: String, body: String) {
            io.execute {
                try {
                    val u = URL(url)
                    if ((u.protocol != "http" && u.protocol != "https") || !isLan(u.host)) {
                        reply(id, -1, "blocked: $url is not a LAN address"); return@execute
                    }
                    val c = u.openConnection() as HttpURLConnection
                    c.requestMethod = method
                    c.connectTimeout = 4000
                    c.readTimeout = 6000
                    val h = JSONObject(headersJson.ifBlank { "{}" })
                    for (k in h.keys()) c.setRequestProperty(k, h.getString(k))
                    if (body.isNotEmpty()) {
                        c.doOutput = true
                        c.outputStream.use { it.write(body.toByteArray()) }
                    }
                    val code = c.responseCode
                    val stream = if (code >= 400) c.errorStream else c.inputStream
                    val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
                    c.disconnect()
                    reply(id, code, text)
                } catch (e: Exception) {
                    reply(id, -1, e.toString())
                }
            }
        }

        /**
         * Minecraft "Server List Ping": the same request the multiplayer menu sends to show players online.
         * Plain TCP to the server port, no AMP login needed.
         */
        @JavascriptInterface
        fun mcPing(id: String, host: String, port: Int) {
            io.execute {
                try {
                    if (!isLan(host)) { reply(id, -1, "blocked: $host is not a LAN address"); return@execute }
                    Socket().use { s ->
                        s.connect(InetSocketAddress(host, port), 3000)
                        s.soTimeout = 4000
                        val out = DataOutputStream(s.getOutputStream())
                        val inp = DataInputStream(s.getInputStream())
                        val packet = ByteArrayOutputStream()
                        DataOutputStream(packet).apply {
                            writeByte(0x00)                       // handshake packet id
                            writeVarInt(this, 767)                // protocol version (any value works for status)
                            val hb = host.toByteArray()
                            writeVarInt(this, hb.size); write(hb) // server address
                            writeShort(port)                      // server port
                            writeVarInt(this, 1)                  // next state: status
                        }
                        writeVarInt(out, packet.size()); out.write(packet.toByteArray())
                        out.writeByte(0x01); out.writeByte(0x00)  // status request: length 1, id 0
                        out.flush()
                        readVarInt(inp)                           // response length
                        readVarInt(inp)                           // packet id
                        val len = readVarInt(inp)
                        val buf = ByteArray(len)
                        inp.readFully(buf)
                        reply(id, 200, String(buf, Charsets.UTF_8))
                    }
                } catch (e: Exception) {
                    reply(id, -1, e.toString())
                }
            }
        }

        @JavascriptInterface
        fun openSettings() {
            runOnUiThread { startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        }
    }

    private fun isLan(host: String): Boolean =
        host == "homelab" || host.startsWith("192.168.") || host.startsWith("10.") ||
            Regex("^172\\.(1[6-9]|2\\d|3[01])\\.").containsMatchIn(host)

    private fun reply(id: String, status: Int, body: String) {
        val js = "window.__native && window.__native(${JSONObject.quote(id)}, $status, ${JSONObject.quote(body)})"
        runOnUiThread { web.evaluateJavascript(js, null) }
    }

    // Minecraft's variable-length integers: 7 bits per byte, high bit means "more bytes follow"
    private fun writeVarInt(o: DataOutputStream, value: Int) {
        var v = value
        while (true) {
            if ((v and 0x7F.inv()) == 0) { o.writeByte(v); return }
            o.writeByte((v and 0x7F) or 0x80)
            v = v ushr 7
        }
    }

    private fun readVarInt(i: DataInputStream): Int {
        var result = 0
        var n = 0
        while (true) {
            val b = i.readByte().toInt()
            result = result or ((b and 0x7F) shl (7 * n))
            n++
            if (n > 5) throw RuntimeException("VarInt too long")
            if ((b and 0x80) == 0) return result
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
