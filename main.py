import os, re, json, uuid, gzip, ssl, urllib.request, urllib.parse, http.client
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
import io, time, threading

ssl._create_default_https_context = ssl._create_unverified_context

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def _p(path):
    return os.path.join(_BASE_DIR, path)

# ── Sign Bridge ─────────────────────────────────────────────────────────────
_sb_engine = None
_sb_ctx = None
_sb_ready = False
_sb_initialized = False

def _init_sign_bridge():
    global _sb_engine, _sb_ctx, _sb_ready
    try:
        from py_mini_racer import MiniRacer
        _sb_engine = "mini_racer"
        _sb_ctx = MiniRacer()

        BROWSER_SHIM = """
var window = this;
var self = this;
var globalThis = this;
var crypto = { getRandomValues: function(arr) { for (var i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256); return arr; } };
var btoa = function(s) { return ''; };
var atob = function(s) { return ''; };
var navigator = { userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36', platform: 'Linux armv81', language: 'vi-VN', languages: ['vi-VN','vi','en-US','en'], cookieEnabled: true, onLine: true, hardwareConcurrency: 4, maxTouchPoints: 5 };
var location = { hostname: 'kgvn-camp.mobagarena.com', href: 'https://kgvn-camp.mobagarena.com/', protocol: 'https:', origin: 'https://kgvn-camp.mobagarena.com', host: 'kgvn-camp.mobagarena.com', pathname: '/' };
var screen = { width: 412, height: 915, colorDepth: 24 };
var innerWidth = 412; var innerHeight = 915;
var devicePixelRatio = 2.625;
var document = { createElement: function() { return {style:{},setAttribute:function(){},appendChild:function(){},classList:{add:function(){},remove:function(){},contains:function(){return false}},dataset:{},getBoundingClientRect:function(){return {top:0,left:0,width:100,height:100}}}; }, createTextNode: function() { return {}; }, head: {appendChild:function(){},removeChild:function(){}}, body: {appendChild:function(){},removeChild:function(){},style:{}}, getElementById: function() { return null; }, querySelector: function() { return null; }, querySelectorAll: function() { return []; }, addEventListener: function() {}, documentElement: {classList:{add:function(){}},style:{},getAttribute:function(){return null}}, cookie: '', readyState: 'complete', location: {hostname:'kgvn-camp.mobagarena.com'} };
var XMLHttpRequest = function() { this.readyState=0; this.status=0; };
XMLHttpRequest.prototype = {open:function(){},send:function(){},setRequestHeader:function(){},getResponseHeader:function(){return null},addEventListener:function(){}};
var fetch = function() { return Promise.resolve({json:function(){return {}},text:function(){return ''},ok:true}); };
var Image = function() {}; var HTMLElement = function() {};
var localStorage = {getItem:function(){return null},setItem:function(){},removeItem:function(){}};
var sessionStorage = {getItem:function(){return null},setItem:function(){},removeItem:function(){}};
var requestAnimationFrame = function(cb) { return setTimeout(cb, 16); };
var cancelAnimationFrame = function(id) { clearTimeout(id); };
var MutationObserver = function() {}; MutationObserver.prototype = {observe:function(){},disconnect:function(){}};
var performance = { now: function() { return Date.now(); }, getEntriesByType: function() { return []; } };
"""
        sec_path = _p("static/camp-security-oversea.0.1.0.js")
        if not os.path.isfile(sec_path):
            print("[sb] camp-security JS not found")
            return False
        with open(sec_path, "r", encoding="utf-8", errors="ignore") as f:
            sec_code = f.read()
        _sb_ctx.eval(BROWSER_SHIM)
        _sb_ctx.eval(sec_code)
        _sb_ready = True
        print("[sb] Sign bridge ready")
        return True
    except Exception as e:
        print(f"[sb] Init error: {e}")
        return False

def sb_set_login(encryption, camp_roleid):
    global _sb_initialized
    if not _sb_ready:
        raise Exception("Sign bridge not ready")
    _sb_ctx.eval(f"__TCSJ__.setLoginRes('{encryption.replace(chr(39), chr(92)+chr(39))}', '{camp_roleid.replace(chr(39), chr(92)+chr(39))}')")
    _sb_initialized = True

def sb_get_encode_param(roleid=""):
    if not _sb_initialized:
        raise Exception("Sign bridge not initialized, call /api/sign-bridge/init first")
    return _sb_ctx.eval(f"__TCSJ__.getEncodeParam('{roleid.replace(chr(39), chr(92)+chr(39))}')")

# Init sign bridge on startup
_init_sign_bridge()

app = FastAPI(title="AoV Poster Changer")
app.mount("/static", StaticFiles(directory=_p("static")), name="static")

UPLOAD_DIR = _p("uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

with open(_p("templates/index.html"), encoding="utf-8") as f:
    INDEX_HTML = f.read()

@app.get("/", response_class=HTMLResponse)
async def index():
    return HTMLResponse(INDEX_HTML)

SAVEPOSTER_HEADERS_TEMPLATE = {
    "Msdk-Channelid": "10",
    "Camp-Source": "AOV-CAMP",
    "Msdk-Gameid": "1137",
    "Msdk-Os": "2",
    "Camp-Authtype": "msdk",
    "Aov-Region": "1137",
    "Aov-Language": "VN",
    "logicworldid": "1011",
    "areaid": "1",
    "Content-Type": "application/json",
    "Accept": "*/*",
    "Origin": "https://kgvn-camp.mobagarena.com",
    "Referer": "https://kgvn-camp.mobagarena.com/",
}

@app.post("/api/upload")
async def upload_image(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename or "image.jpg")[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp"):
        raise HTTPException(400, "Chỉ hỗ trợ JPG, PNG, WEBP")
    content = await file.read()
    img = Image.open(io.BytesIO(content))
    img = img.convert("RGB")
    target_size = (1080, 1701)
    img.thumbnail(target_size, Image.LANCZOS)
    bg = Image.new("RGB", target_size, (0, 0, 0))
    offset = ((target_size[0] - img.width) // 2, (target_size[1] - img.height) // 2)
    bg.paste(img, offset)
    fname = f"{uuid.uuid4().hex}.jpg"
    fpath = os.path.join(UPLOAD_DIR, fname)
    bg.save(fpath, "JPEG", quality=92)
    return {"ok": True, "filename": fname, "width": target_size[0], "height": target_size[1]}

@app.post("/api/aov")
async def aov_proxy(request: Request):
    body = await request.json()
    target = body.get("url", "")
    if "kgvn-api.mobagarena.com" not in target:
        return JSONResponse({"error": "Forbidden target"}, 403)
    hdrs = body.get("headers", {})
    payload = body.get("body", None)
    req_body = json.dumps(payload).encode() if payload is not None else b"{}"
    req_hdrs = {k: v for k, v in hdrs.items() if v}
    req_hdrs.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(target, data=req_body, headers=req_hdrs, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
        return JSONResponse(content=json.loads(raw))
    except urllib.error.HTTPError as e:
        err = e.read()
        return JSONResponse({"error": f"HTTP {e.code}", "detail": err.decode(errors="ignore")}, e.code)
    except Exception as e:
        return JSONResponse({"error": str(e)}, 502)

@app.put("/api/cos-upload")
async def cos_proxy(request: Request):
    target = request.headers.get("X-Cos-Target", "")
    if not target or "myqcloud.com" not in target:
        return JSONResponse({"error": "Missing or forbidden X-Cos-Target"}, 400)
    parsed = urllib.parse.urlparse(target)
    host = parsed.netloc
    path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
    body = await request.body()
    fwd_hdrs = {"Content-Length": str(len(body))}
    for h in ["Authorization", "x-cos-security-token", "x-cos-forbid-overwrite",
               "Content-Type"]:
        v = request.headers.get(h)
        if v:
            fwd_hdrs[h] = v
    try:
        conn = http.client.HTTPSConnection(host, timeout=60)
        conn.request("PUT", path, body=body, headers=fwd_hdrs)
        resp = conn.getresponse()
        resp_body = resp.read()
        conn.close()
        if resp.status in (200, 204):
            return JSONResponse({"ok": True})
        return JSONResponse({"error": f"COS {resp.status}", "detail": resp_body.decode(errors="ignore")}, resp.status)
    except Exception as e:
        return JSONResponse({"error": str(e)}, 502)

@app.post("/api/sign-bridge/init")
async def sb_init(request: Request):
    body = await request.json()
    encryption = body.get("encryption", "")
    camp_roleid = body.get("campRoleid", "")
    if not encryption:
        return JSONResponse({"ok": False, "error": "Missing encryption"}, 400)
    try:
        sb_set_login(encryption, camp_roleid)
        test_ep = sb_get_encode_param(camp_roleid)
        return JSONResponse({"ok": True, "testEncodeparam": test_ep})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, 500)

@app.post("/api/sign-bridge/sign")
async def sb_sign(request: Request):
    body = await request.json()
    roleid = body.get("roleid", "")
    try:
        ep = sb_get_encode_param(roleid)
        return JSONResponse({"ok": True, "encodeparam": ep})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, 500)

@app.get("/api/sign-bridge/status")
async def sb_status():
    return JSONResponse({
        "ready": _sb_ready,
        "initialized": _sb_initialized,
        "engine": _sb_engine,
    })

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)