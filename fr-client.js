/* FIELD REPORT - client for web / WebXR builds. No dependencies, no cookies, no personal data.
   FieldReport.init({endpoint, app, build, phase: () => "level 2"}) once at start; then:
   - every uncaught error and failed promise is sent as a crash report (with the last 200 log lines);
   - FieldReport.bug(category, {canvas, note}) sends a player bug report (screenshot of the canvas if given);
   - FieldReport.event(name, extra) sends a small event (session_start, xr_enter, ...).
   Reports that cannot be sent (offline, receiver down) wait in localStorage (max 20) and go with the next one.
   Each install gets one random id (crypto.randomUUID), never a hardware id.
   (c) 2026 Spiridon Tsakonas (Cyrus Nash) - Light in the Dark Solutions - All Rights Reserved */
(function (root) {
  "use strict";
  var cfg = null, logs = [], QKEY = "fieldreport.queue", IKEY = "fieldreport.install", MAXQ = 20, sent = {};
  function store(k, v) { try { if (v === undefined) return root.localStorage.getItem(k); root.localStorage.setItem(k, v); } catch (e) { return null; } }
  function install() {
    var id = store(IKEY);
    if (!id || !/^[A-Za-z0-9._:-]{1,80}$/.test(id)) { id = (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID() : String(Math.random()).slice(2); store(IKEY, id); }
    return id;
  }
  function text(v) { try { return typeof v === "string" ? v : (v instanceof Error ? v.message : JSON.stringify(v)); } catch (e) { return String(v); } }
  function log(level, args) {
    logs.push(new Date().toISOString().slice(11, 23) + " " + level + " " + Array.prototype.map.call(args, text).join(" ").slice(0, 500));
    if (logs.length > 200) logs.shift();
  }
  ["log", "info", "warn", "error"].forEach(function (lv) {
    var orig = root.console && root.console[lv];
    if (!orig) return;
    root.console[lv] = function () { log(lv, arguments); return orig.apply(root.console, arguments); };
  });
  function device() {
    var n = root.navigator || {}, s = root.screen || {};
    return [n.userAgent || "", "screen " + (s.width || "?") + "x" + (s.height || "?"), "xr " + (n.xr ? "yes" : "no")].join(" | ");
  }
  function phase() { try { return cfg && cfg.phase ? String(cfg.phase()) : ""; } catch (e) { return "phase unknown"; } }
  function queue() { try { return JSON.parse(store(QKEY) || "[]"); } catch (e) { return []; } }
  function post(rep) {
    return root.fetch(cfg.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rep), keepalive: !rep.screenshot })
      .then(function (r) { return r.status === 201 ? "ok" : (r.status >= 500 || r.status === 429 ? "retry" : "drop"); }, function () { return "retry"; });
  }
  function send(rep) {
    if (!cfg) return Promise.resolve("not started");
    var q = queue(); q.push(rep); if (q.length > MAXQ) q = q.slice(q.length - MAXQ);
    store(QKEY, JSON.stringify(q.map(function (x) { var y = Object.assign({}, x); delete y.screenshot; return y; })));
    var keep = [], chain = Promise.resolve(), last = "ok";
    q.forEach(function (r) { chain = chain.then(function () { return post(r).then(function (res) { if (res === "retry") keep.push(r); last = res; }); }); });
    return chain.then(function () { store(QKEY, JSON.stringify(keep.map(function (x) { var y = Object.assign({}, x); delete y.screenshot; return y; }))); return last; });
  }
  function base(kind) {
    return { kind: kind, app: cfg.app, build: cfg.build, install: install(), phase: phase(), device: device(), logs: logs.slice() };
  }
  function crash(message, stack) {
    var key = message + "|" + (stack || "").split("\n")[1];
    if (sent[key]) return Promise.resolve("already sent");   // one report per distinct error per page load
    sent[key] = 1;
    var r = base("crash"); r.message = String(message).slice(0, 4000); r.stack = String(stack || "").slice(0, 4000);
    return send(r);
  }
  var FR = {
    init: function (o) {
      if (!o || !o.endpoint || !o.app || !o.build) throw new Error("FieldReport.init needs endpoint, app and build");
      cfg = o; install();
      root.addEventListener("error", function (e) { crash(e.message || "error", e.error && e.error.stack || (e.filename + ":" + e.lineno + ":" + e.colno)); });
      root.addEventListener("unhandledrejection", function (e) { var x = e.reason; crash("unhandled rejection: " + text(x), x && x.stack || ""); });
      return FR;
    },
    crash: crash,
    bug: function (category, opt) {
      if (!cfg) return Promise.resolve("not started");
      opt = opt || {};
      var r = base("bug"); r.category = String(category || "other").slice(0, 80); r.message = String(opt.note || "").slice(0, 4000);
      if (opt.canvas && opt.canvas.toDataURL) { try { var u = opt.canvas.toDataURL("image/png"); if (u.length < 1900000) r.screenshot = u; } catch (e) { r.extra = { screenshot: "not allowed" }; } }
      return send(r);
    },
    event: function (name, extra) {
      if (!cfg) return Promise.resolve("not started");
      var r = base("event"); r.message = String(name).slice(0, 200); r.logs = []; r.extra = extra || {};
      return send(r);
    },
    _logs: function () { return logs.slice(); }
  };
  root.FieldReport = FR;
})(typeof window !== "undefined" ? window : this);
