import os, re, json, uuid, gzip, ssl, urllib.request, urllib.parse, http.client, traceback
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
_sb_cred_cache = {}

def _init_sign_bridge():
    global _sb_engine, _sb_ctx, _sb_ready
    try:
        from py_mini_racer import MiniRacer
    except ImportError:
        print("[sb] py_mini_racer not installed, sign bridge disabled")
        return False
    try:
        _sb_engine = "mini_racer"
        _sb_ctx = MiniRacer()

        BROWSER_SHIM = """
var window = this;
var self = this;
var globalThis = this;
var crypto = { getRandomValues: function(arr) { for (var i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256); return arr; } };
var btoa = function(s) { s = String(s); var B='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; var o='', i=0; while(i<s.length){ var a=s.charCodeAt(i++), b=i<s.length?s.charCodeAt(i++):NaN, c=i<s.length?s.charCodeAt(i++):NaN; o+=B[a>>2]+B[((a&3)<<4)|(b>>4)]+(isNaN(b)?'=':B[((b&15)<<2)|(c>>6)])+(isNaN(c)?'=':B[c&63]); } return o; };
var atob = function(s) { s = String(s).replace(/[^A-Za-z0-9+/=]/g,''); var eq = s.indexOf('='); if (eq >= 0) s = s.slice(0, eq); var B='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; var o='', i=0; while(i+1<s.length){ var e1=B.indexOf(s[i]), e2=B.indexOf(s[i+1]); var e3=(i+2<s.length)?B.indexOf(s[i+2]):0; var e4=(i+3<s.length)?B.indexOf(s[i+3]):0; o+=String.fromCharCode((e1<<2)|(e2>>4)); if(i+2<s.length) o+=String.fromCharCode(((e2&15)<<4)|(e3>>2)); if(i+3<s.length) o+=String.fromCharCode(((e3&3)<<6)|e4); i+=4; } return o; };
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

def sb_get_credential(auth_token):
    """Get login encryption + roleId from getcredential API using raw MSDK token."""
    cache_key = "default"
    if cache_key in _sb_cred_cache:
        return _sb_cred_cache[cache_key]
    headers = dict(SAVEPOSTER_HEADERS_TEMPLATE)
    headers.pop("Content-Type", None)
    headers["Msdk-Itopencodeparam"] = auth_token
    headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        "https://kgvn-api.mobagarena.com/api/user/game/getcredential",
        data=b"{}", headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
    data = json.loads(raw)
    cred = data.get("data") or {}
    _sb_cred_cache[cache_key] = cred
    return cred

def sb_get_encodeparam_from_token(auth_token):
    """Exchange raw MSDK token for a valid Encodeparam via sign bridge."""
    if not _sb_ready:
        raise Exception("Sign bridge not ready")
    cred = sb_get_credential(auth_token)
    encryption = cred.get("encryption", "")
    roleid = cred.get("roleId", "")
    if not encryption:
        raise Exception("getcredential returned empty encryption")
    sb_set_login(encryption, roleid)
    ep = sb_get_encode_param(roleid)
    if not ep or not isinstance(ep, str) or len(ep) < 8:
        raise Exception("Failed to generate encodeparam")
    return ep

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
    img_ratio = img.width / img.height
    target_ratio = target_size[0] / target_size[1]
    if img_ratio > target_ratio:
        new_h = target_size[1]
        new_w = int(new_h * img_ratio)
    else:
        new_w = target_size[0]
        new_h = int(new_w / img_ratio)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    left = (img.width - target_size[0]) // 2
    top = (img.height - target_size[1]) // 2
    img = img.crop((left, top, left + target_size[0], top + target_size[1]))
    fname = f"{uuid.uuid4().hex}.jpg"
    fpath = os.path.join(UPLOAD_DIR, fname)
    img.save(fpath, "JPEG", quality=92)
    return {"ok": True, "filename": fname, "width": 1080, "height": 1701}

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

@app.post("/api/sb/getcredential")
async def sb_getcredential_api(request: Request):
    body = await request.json()
    auth_token = (body.get("auth_token") or "").strip()
    if not auth_token:
        return JSONResponse({"ok": False, "error": "auth_token required"}, 400)
    try:
        cred = sb_get_credential(auth_token)
    except Exception as e:
        return JSONResponse({"ok": False, "error": f"getcredential failed: {e}"}, 502)
    if not cred.get("encryption"):
        return JSONResponse({"ok": False, "error": "getcredential returned empty encryption"}, 502)
    return JSONResponse({"ok": True, "encryption": cred.get("encryption"), "roleId": cred.get("roleId", "")})

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

# ── Server-side MSDK processing (like lqchecker.pro) ─────────────────────
from concurrent.futures import ThreadPoolExecutor

_msdk_jobs = {}
_msdk_executor = ThreadPoolExecutor(max_workers=4)

def _sb_extract_info(auth_token):
    """Try to extract access_token and roleid from auth_token via sign bridge."""
    info = {"ok": False, "accessToken": "", "roleid": ""}
    if not _sb_ready:
        return info
    try:
        sb_set_login(auth_token, "")
        info["ok"] = True
        info["roleid"] = ""
        return info
    except:
        return info

def _run_job(job_id, auth_token, media_path, mode, is_share, main_job, gender, encodeparam="", encodeparams=None):
    logs = []
    def log(level, msg):
        entry = {"level": level, "msg": msg, "time": time.time()}
        logs.append(entry)
        _msdk_jobs[job_id]["logs"].append(entry)

    def update_progress(pct, label=""):
        _msdk_jobs[job_id]["progress"] = pct
        _msdk_jobs[job_id]["progLabel"] = label

    try:
        log("info", "Đang khởi tạo...")
        log("dim", f"auth_token={auth_token[:20]}... encodeparam={encodeparam[:20] if encodeparam else '(none)'}")

        # Step 1: Try to extract auth info from sign bridge
        sb_info = _sb_extract_info(auth_token)

        # Step 2: Read and prepare image
        log("info", "Đang xử lý ảnh...")
        img = Image.open(media_path)
        img = img.convert("RGB")
        target_size = (1080, 1701)
        # Resize to fill 1080x1701 (crop excess, no black bars)
        img_ratio = img.width / img.height
        target_ratio = target_size[0] / target_size[1]
        if img_ratio > target_ratio:
            new_h = target_size[1]
            new_w = int(new_h * img_ratio)
        else:
            new_w = target_size[0]
            new_h = int(new_w / img_ratio)
        img = img.resize((new_w, new_h), Image.LANCZOS)
        left = (img.width - target_size[0]) // 2
        top = (img.height - target_size[1]) // 2
        img = img.crop((left, top, left + target_size[0], top + target_size[1]))

        large_buf = io.BytesIO()
        img.save(large_buf, "JPEG", quality=92)
        large_bytes = large_buf.getvalue()

        thumb = img.resize((400, 628), Image.LANCZOS)
        thumb_buf = io.BytesIO()
        thumb.save(thumb_buf, "PNG")
        thumb_bytes = thumb_buf.getvalue()

        # Step 3: Build common headers
        common_headers = dict(SAVEPOSTER_HEADERS_TEMPLATE)
        common_headers.pop("Content-Type", None)
        common_headers["Msdk-Itopencodeparam"] = auth_token

        if encodeparams:
            log("ok", f"Nhận {len(encodeparams)} Encodeparam từ trình duyệt")
        elif encodeparam:
            common_headers["Encodeparam"] = encodeparam
        else:
            try:
                fresh_ep = sb_get_encodeparam_from_token(auth_token)
                common_headers["Encodeparam"] = fresh_ep
                log("ok", f"Encodeparam OK ({len(fresh_ep)} chars)")
            except Exception as e:
                log("warn", f"Không tạo được Encodeparam: {e}")

        def api_call(ep, body=None, extra_hdrs=None):
            hdrs = {**common_headers, "Content-Type": "application/json"}
            if extra_hdrs:
                hdrs.update(extra_hdrs)
            use_ep = None
            if encodeparams:
                use_ep = encodeparams.pop(0)
            elif encodeparam:
                use_ep = encodeparam
            else:
                try:
                    use_ep = sb_get_encodeparam_from_token(auth_token)
                except Exception as e:
                    log("warn", f"Không tạo được Encodeparam: {e}")
            if use_ep:
                hdrs["Encodeparam"] = use_ep
            url = f"https://kgvn-api.mobagarena.com{ep}?access_token={auth_token}"
            req_body = json.dumps(body).encode() if body else b"{}"
            log("dim", f">> {ep} body={json.dumps(body)[:200]}")
            for attempt in range(2):
                if attempt > 0:
                    log("warn", f"Retry {ep}")
                    time.sleep(1)
                try:
                    req = urllib.request.Request(url, data=req_body, headers=hdrs, method="POST")
                    with urllib.request.urlopen(req, timeout=30) as r:
                        raw = r.read()
                        if r.headers.get("Content-Encoding") == "gzip":
                            raw = gzip.decompress(raw)
                        data = json.loads(raw)
                        if data.get("code") not in (0, None, "0"):
                            msg = f"code={data.get('code')} msg={data.get('msg','')} data={json.dumps(data.get('data'))[:150]}"
                            log("warn", f"<< {ep} error: {msg}")
                            if attempt > 0:
                                raise Exception(f"API error: {msg}")
                            continue
                        log("ok", f"<< {ep} OK")
                        return data.get("data") or data
                except urllib.error.HTTPError as e:
                    err_text = e.read().decode(errors="ignore")
                    log("warn", f"<< {ep} HTTP {e.code}: {err_text[:200]}")
                    if attempt > 0:
                        raise Exception(f"HTTP {e.code}: {err_text[:200]}")
                    continue
            raise Exception(f"API failed: {ep}")

        if mode == "flowborn":
            # Flowborn flow
            update_progress(10, "Đang lấy editor config...")
            log("info", "getEditorConfig...")
            main_job = main_job or 5
            cfg_data = api_call("/api/game/poster/flowborn/geteditorconfig", {"mainJob": main_job})
            base_list = cfg_data.get("baseList") or []
            if not base_list:
                raise Exception("baseList trống từ editor config")
            cfg = base_list[0]
            log("ok", f"Config: id={cfg.get('id')}")

            update_progress(20, "Đang lưu edit info...")
            log("info", "savePosterEditInfo...")
            api_call("/api/game/poster/flowborn/savepostereditinfo", {
                "mainJob": main_job,
                "picInfo": {
                    "bg": {"id": "30", "picUrl": "https://kg-camp.mobagarena.com/manage/flowborn_official/4uxOQChv.png"},
                    "baseInfo": {"id": cfg.get("id"), "gender": gender or 2, "mainJob": main_job, "picUrl": cfg.get("picUrl"), "skinColor": cfg.get("skinColor", 1)},
                    "stickerList": [],
                },
            })
            log("ok", "Edit info saved")

            update_progress(30, "Đang tạo poster...")
            log("info", "createPoster...")
            create_data = api_call("/api/game/poster/flowborn/createposter")
            poster_id = str(create_data.get("posterId") or create_data.get("posterId", ""))
            log("ok", f"Poster ID: {poster_id}")

            scene = "FlowbornPoster"
            pfx_cos = f"{main_job}/1"
        else:
            # Player flow
            update_progress(20, "Đang tạo poster...")
            log("info", "createPoster Player...")
            create_data = api_call("/api/game/poster/playerimage/createposter")
            poster_id = str(create_data.get("posterId") or create_data.get("posterId", ""))
            log("ok", f"Poster ID: {poster_id}")

            scene = "PlayerimagePoster"
            pfx_cos = "0/1"

        # Get COS credentials
        update_progress(40, "Đang lấy COS credentials...")
        log("info", "getCosCredential _large...")
        cred_large = api_call("/api/game/poster/getcoscredential", {"scene": scene, "fileName": f"{pfx_cos}/{poster_id}_large.png"})
        log("ok", "Cred _large OK")

        log("info", "getCosCredential .png...")
        cred_png = api_call("/api/game/poster/getcoscredential", {"scene": scene, "fileName": f"{pfx_cos}/{poster_id}.png"})
        log("ok", "Cred .png OK")

        # Upload to COS
        update_progress(55, "Đang upload lên CDN...")

        def cos_upload(cred, data, content_type):
            bucket = cred.get("bucket", "")
            app_id = cred.get("appId", "")
            region = cred.get("region", "")
            path = cred.get("path", "")
            s_id = cred.get("tmpSecretId", "")
            s_key = cred.get("tmpSecretKey", "")
            token = cred.get("token", "")
            host = f"{bucket}-{app_id}.cos.{region}.myqcloud.com"
            url = f"https://{host}{path}"

            # COS HMAC-SHA1 signing
            import hmac, hashlib
            def sha1(msg):
                return hashlib.sha1(msg.encode()).hexdigest()
            def hmac_sha1(key, msg):
                return hmac.new(key.encode(), msg.encode(), hashlib.sha1).hexdigest()
            def qenc(s):
                return urllib.parse.quote(s, safe='')

            t0 = int(cred.get("startTime", time.time()))
            exp = cred.get("expiration", str(t0 + 3600))
            t1 = int(exp) if exp.isdigit() else int(time.time()) + 3600
            kt = f"{t0};{t1}"
            sk = hmac_sha1(s_key, kt)

            hdrs = {"content-length": str(len(data)), "host": host, "x-cos-forbid-overwrite": "true"}
            keys = sorted(hdrs.keys())
            hl = ";".join(keys)
            hp = "&".join(f"{qenc(k)}={qenc(hdrs[k])}" for k in keys)
            hs = f"put\n{path}\n\n{hp}\n"
            sh = sha1(hs)
            ss = f"sha1\n{kt}\n{sh}\n"
            sig = hmac_sha1(sk, ss)

            auth = f"q-sign-algorithm=sha1&q-ak={s_id}&q-sign-time={kt}&q-key-time={kt}&q-header-list={hl}&q-url-param-list=&q-signature={sig}"

            req_hdrs = {
                "Authorization": auth,
                "x-cos-security-token": token,
                "x-cos-forbid-overwrite": "true",
                "Content-Type": content_type,
                "Content-Length": str(len(data)),
                "Host": host,
            }
            conn = http.client.HTTPSConnection(host, timeout=60)
            try:
                conn.request("PUT", path, body=data, headers=req_hdrs)
                resp = conn.getresponse()
                resp.read()
                conn.close()
                if resp.status not in (200, 204):
                    raise Exception(f"COS upload failed: HTTP {resp.status}")
            except Exception as e:
                conn.close()
                raise e

        time.sleep(2)  # wait for image propagation
        log("info", "Upload _large...")
        cos_upload(cred_large, large_bytes, "image/jpeg")
        log("ok", "Upload _large OK")

        log("info", "Upload .png...")
        cos_upload(cred_png, thumb_bytes, "image/png")
        log("ok", "Upload .png OK")

        # Save poster
        update_progress(80, "Đang lưu poster...")
        cdn = cred_png.get("cdnHost") or "https://kg-camp-ugc.mobagarena.com"
        parts = cred_png.get("path", "").split("/")
        pfx = "/".join(parts[:max(0, len(parts)-3)]) or ""
        pic_url = f"{cdn}{pfx}/"
        log("dim", f"picUrl={pic_url} (từ path={cred_png.get('path','')}) cdn={cdn}")

        # Try multiple picUrl formats for saveposter
        pic_urls = [pic_url]
        # Also try full file URL
        cred_path = cred_png.get("path", "")
        if cred_path:
            pic_urls.append(f"{cdn}{cred_path}")
        # Also try directory from os.path.dirname
        pic_dir = os.path.dirname(cred_path) if cred_path else ""
        if pic_dir and f"{cdn}{pic_dir}/" not in pic_urls:
            pic_urls.append(f"{cdn}{pic_dir}/")

        if mode == "flowborn":
            log("info", "savePoster Flowborn...")
            api_call("/api/game/poster/flowborn/saveposter", {
                "posterId": poster_id, "isApply": True, "isShare": True, "mainJob": main_job,
                "picUrl": pic_urls[0],
                "picInfo": {
                    "bg": {"id": "30", "picUrl": "https://kg-camp.mobagarena.com/manage/flowborn_official/4uxOQChv.png"},
                    "baseInfo": {"id": cfg.get("id"), "gender": gender or 2, "mainJob": main_job, "picUrl": cfg.get("picUrl"), "skinColor": cfg.get("skinColor", 1)},
                    "stickerList": [],
                },
            })
        else:
            log("info", "savePoster Player...")
            last_save_err = None
            for pu in pic_urls:
                log("dim", f"Thử picUrl={pu}")
                try:
                    api_call("/api/game/poster/playerimage/saveposter", {
                        "posterId": poster_id, "isApply": True, "isShare": True,
                        "picUrl": pu,
                        "picInfo": {
                            "bg": {"id": "21", "picUrl": "https://kg-camp.mobagarena.com/manage/playerimage_official/iDzT817p.png", "source": 1, "width": 320, "height": 503.99, "posX": 0, "posY": 0},
                            "stickerList": [],
                        },
                    })
                    log("ok", f"savePoster OK với picUrl={pu}")
                    break
                except Exception as e:
                    last_save_err = e
                    log("warn", f"picUrl={pu} thất bại: {e}")
                    continue
            else:
                raise last_save_err or Exception("savePoster thất bại với mọi picUrl")

        log("ok", f"savePoster OK — Poster ID: {poster_id}")
        update_progress(100, "✅ Hoàn tất!")
        log("gold", f"🎉 Thành công! Poster ID: {poster_id}")
        _msdk_jobs[job_id]["done"] = {"ok": 1, "fail": 0}

    except Exception as e:
        log("error", f"❌ Lỗi: {str(e)}")
        log("dim", traceback.format_exc()[:300])
        _msdk_jobs[job_id]["done"] = {"ok": 0, "fail": 1}
    finally:
        _msdk_jobs[job_id]["finished"] = True
        # Cleanup temp file
        try:
            if os.path.isfile(media_path):
                os.remove(media_path)
                log("dim", "Đã dọn file tạm")
        except:
            pass

@app.post("/api/msdk/upload")
async def msdk_upload(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename or "image.jpg")[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp"):
        raise HTTPException(400, "Chỉ hỗ trợ JPG, PNG, WEBP")
    content = await file.read()
    fname = f"{uuid.uuid4().hex}{ext}"
    fpath = os.path.join(UPLOAD_DIR, fname)
    with open(fpath, "wb") as f:
        f.write(content)
    return {"ok": True, "filename": fname, "size": len(content), "ext": ext}

@app.post("/api/msdk/start")
async def msdk_start(request: Request):
    body = await request.json()
    auth_token = (body.get("auth_token") or "").strip()
    media_filename = (body.get("media_filename") or "").strip()
    mode = body.get("mode", "player")
    is_share = body.get("is_share", False)
    main_job = body.get("main_job", 5)
    gender = body.get("gender", 2)
    encodeparam = (body.get("encodeparam") or "").strip()
    encodeparams = body.get("encodeparams") or []
    if isinstance(encodeparams, str):
        encodeparams = [e for e in encodeparams.split(",") if e.strip()]
    if isinstance(encodeparams, list):
        encodeparams = [str(e).strip() for e in encodeparams if str(e).strip()]

    if not auth_token:
        return JSONResponse({"error": "Thiếu auth_token"}, 400)
    if not media_filename:
        return JSONResponse({"error": "Thiếu media_filename"}, 400)

    media_path = os.path.join(UPLOAD_DIR, media_filename)
    if not os.path.isfile(media_path):
        return JSONResponse({"error": "File ảnh không tồn tại"}, 400)

    job_id = uuid.uuid4().hex
    _msdk_jobs[job_id] = {
        "logs": [],
        "progress": 0,
        "progLabel": "",
        "done": None,
        "finished": False,
    }
    _msdk_executor.submit(_run_job, job_id, auth_token, media_path, mode, is_share, main_job, gender, encodeparam, encodeparams)
    return JSONResponse({"ok": True, "job_id": job_id})

@app.get("/api/msdk/status/{job_id}")
async def msdk_status(job_id: str, from_index: int = 0):
    job = _msdk_jobs.get(job_id)
    if not job:
        return JSONResponse({"error": "Job not found"}, 404)
    new_logs = job["logs"][from_index:]
    return JSONResponse({
        "logs": new_logs,
        "next": len(job["logs"]),
        "progress": job["progress"],
        "progLabel": job["progLabel"],
        "done": job["done"],
        "finished": job["finished"],
    })

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)