/**
 * 『空白の意味』松林図教材 ― 共有用 Google Apps Script（ウェブアプリ）
 *
 * 使い方（くわしくは README の「教員のセットアップ手順」）
 *  1. 新しいスプレッドシートを作り、［拡張機能］→［Apps Script］を開く
 *  2. このファイルの中身を Code.gs に貼り付けて保存
 *  3. 関数 setup を一度実行（権限を許可）→ シートが作られる
 *  4. ［プロジェクトの設定］→［スクリプト プロパティ］に TEACHER_PIN を追加
 *  5. ［デプロイ］→［新しいデプロイ］→ 種類「ウェブアプリ」
 *     実行ユーザー：自分 ／ アクセスできるユーザー：全員（または組織内の全員）
 *  6. 表示された URL（…/exec）を教材の教員用画面に貼る
 *
 * 個人情報は集めない：生徒の名前・メールは保存しない。client は端末ごとのランダムな英数字。
 * 生徒の記録（続きから再開するため）は、学校のアカウントから作った「元に戻せない符号」で見分けて保存する。
 * メールアドレスそのものはシートに書かない（符号の材料の USER_SALT はスクリプト プロパティ。消すと記録を引き継げなくなる）。
 *
 * 公開範囲が「学校のドメイン内の全員」しか選べない場合（GitHub Pages の教材から直接つなげない場合）：
 *   このウェブアプリの URL そのものを生徒に配る。教材の画面もここから配信し（doGet）、
 *   共有の通信は google.script.run → api() で行う（ログイン済みの学校アカウントがそのまま使える）。
 *   教材の本体は、開いた人のブラウザが教材の置き場所（スクリプト プロパティ APP_URL、既定は下の APP_URL）から読み込む。
 *   そのため、この Apps Script は外部への通信の権限を求めない（求める権限は、このスプレッドシートの読み書きだけ）。
 *   学校のネットワークで教材の置き場所が開けないときは、教材の index.html を Apps Script に
 *   HTML ファイル「Index」として貼り付ければ、そちらを使う。
 */
var APP_URL = 'https://sakadosoutan-boop.github.io/kuuhaku/';
var VERSION = '1.3.1';
var CFG = {
  MAX_LEN: 30,               // 投稿の最大文字数
  POST_INTERVAL_SEC: 15,     // 同じ端末の連投間隔
  MAX_POSTS_PER_CLIENT: 10,  // 1クラスで1端末が投稿できる数
  MAX_POSTS_RETURN: 200,     // state で返す投稿の数
  STATE_CACHE_SEC: 5,        // state のキャッシュ（実行時間とシート読み取りを節約）
  VOTE_INTERVAL_SEC: 2,
  PIN_FAIL_LIMIT: 10,
  PIN_LOCK_SEC: 600,
};
var HEADERS = {
  posts: ['id', 'class', 'text', 'x', 'y', 'client', 'time', 'hidden'],
  votes: ['class', 'client', 'kind', 'value', 'time'],
  classes: ['class', 'open', 'updated'],
  progress: ['key', 'class', 'data', 'updated'],
};
var KINDS = ['brush', 'mist', 'blur'];  // 描き込み・靄・ぼかし絵（何段階目でわかったか）
var NG = ['しね', '死ね', 'ころす', '殺す', 'ころせ', '殺せ', 'きもい', 'きしょい', 'うざい', 'うぜ', 'ばか(?!り|す)', '馬鹿', 'あほ(?!う)', '阿呆', 'ぶす(?!い)', 'くず(?!れ|す|も)', 'きえろ', '消えろ', '死んで', 'ちんこ', 'まんこ', 'うんこ', 'ちんちん', 'おっぱい', 'せっくす', 'sex', 'fuck', 'shit', 'でぶ', 'はげ(?!し|む|ま)'];

/* ---------------- 入口 ---------------- */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action) return out_(handle_(p));   // 公開範囲が「全員」のとき、GitHub Pages の教材から fetch で呼ばれる
  return page_(p);                          // それ以外は、教材の画面を配信する
}
/* google.script.run から呼ぶ入口（末尾に _ を付けない）。引数も返り値も JSON の文字列 */
function api(json) {
  var p;
  try { p = JSON.parse(String(json || '{}')); } catch (err) { return JSON.stringify({ ok: false, error: 'badjson' }); }
  return JSON.stringify(handle_(p, true));
}
function doPost(e) {
  var p = {};
  try { p = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return out_({ ok: false, error: 'badjson' }); }
  return out_(handle_(p));
}
/* ---------------- 教材の画面を配信する ---------------- */
function appBase_() {
  var b = PropertiesService.getScriptProperties().getProperty('APP_URL') || APP_URL;
  return /\/$/.test(b) ? b : b + '/';
}
function ownIndex_() {
  /* Apps Script に貼った HTML ファイル「Index」があれば、それを使う */
  try { var own = HtmlService.createHtmlOutputFromFile('Index').getContent(); if (own && own.length > 1000) return own; } catch (err) { /* なければ null */ }
  return null;
}
function jsStr_(v) { return JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }
function esc_(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function page_(p) {
  var self = ''; try { self = ScriptApp.getService().getUrl(); } catch (err) { /* 取れなくても動く */ }
  var base = appBase_();
  var params = { 'class': String(p['class'] || ''), lesson: String(p.lesson || ''), scene: String(p.scene || ''), q: String(p.q || '') };
  var boot = '<script>window.KUUHAKU_EMBEDDED=true;window.KUUHAKU_BASE=' + jsStr_(base) + ';window.KUUHAKU_SELF=' + jsStr_(self) + ';window.KUUHAKU_PARAMS=' + jsStr_(params) + ';window.KUUHAKU_VERSION=' + jsStr_(VERSION) + ';</script>';
  var own = ownIndex_(), html;
  if (own) {
    html = /<head[^>]*>/i.test(own) ? own.replace(/<head[^>]*>/i, function (m) { return m + boot; }) : boot + own;
  } else {
    /* 読み込み役の小さなページ。開いた人のブラウザが教材を取り寄せ、このページに書き込む（google.script.run はそのまま使える） */
    html = '<!doctype html><html lang="ja"><head><meta charset="utf-8">' + boot +
      '<style>body{margin:0;background:#f6f3ea;color:#1c1c1c;font:16px/1.8 "Hiragino Sans","Noto Sans JP",sans-serif}#ld{padding:28vh 24px 0;text-align:center;letter-spacing:.1em}#ld small{display:block;color:#777;font-size:13px;letter-spacing:0;margin-top:12px}</style></head>' +
      '<body><div id="ld">霧の中から、教材を呼んでいます…</div><script>(function(){' +
      'var B=window.KUUHAKU_BASE,ld=document.getElementById("ld");' +
      'function bad(m){ld.innerHTML="教材を読み込めませんでした。<small>"+m+"<br>教材の置き場所（"+B.replace(/</g,"&lt;")+"）が、この端末・この学校のネットワークで開けるか確かめてください。<br>開けないときは、先生が教材の index.html を Apps Script に HTML ファイル「Index」として貼り付けると動きます。</small>";}' +
      'fetch(B+"index.html",{cache:"no-cache"}).then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.text();}).then(function(h){' +
      'if(h.indexOf("<html")<0)throw new Error("教材ではないページが返りました");' +
      'var s=document.head.querySelector("script").outerHTML;' +
      'h=/<head[^>]*>/i.test(h)?h.replace(/<head[^>]*>/i,function(m){return m+s;}):s+h;' +
      'document.open();document.write(h);document.close();' +
      '}).catch(function(e){bad(String(e&&e.message||e).replace(/</g,"&lt;"));});' +
      '})();</script></body></html>';
  }
  return HtmlService.createHtmlOutput(html).setTitle('松林図をあるく')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function handle_(p, viaApi) {
  try {
    switch (String(p.action || '')) {
      /* 生徒の記録：学校のアカウントで開いた GAS のページ（google.script.run）からだけ受け付ける */
      case 'me': return viaApi ? me_() : { ok: false, error: 'embedonly' };
      case 'save': return viaApi ? save_(p) : { ok: false, error: 'embedonly' };
      case 'ping': return { ok: true, version: VERSION, time: Date.now() };
      case 'state': return state_(p);
      case 'post': return post_(p);
      case 'vote': return vote_(p);
      case 'admin': return admin_(p);
      default: return { ok: false, error: 'unknown' };
    }
  } catch (err) {
    if (err && err.userError) return { ok: false, error: err.userError };
    console.error(err);
    return { ok: false, error: 'server' };
  }
}
function fail_(code) { var e = new Error(code); e.userError = code; throw e; }

/* ---------------- 入力の確認 ---------------- */
function cls_(p) {
  var c = String(p['class'] || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,16}$/.test(c)) fail_('class');
  return c;
}
function client_(p) {
  var c = String(p.client || '');
  if (!/^[A-Za-z0-9]{8,40}$/.test(c)) fail_('client');
  return c;
}
function normText_(s) {
  return String(s || '').normalize('NFKC')
    .replace(/[ァ-ヶ]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0x60); })
    .toLowerCase().replace(/[\s・．。、,.!！?？ー〜~_\-]/g, '');
}
function checkText_(text) {
  var t = String(text || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  var len = Array.from(t).length;
  if (len < 1 || len > CFG.MAX_LEN) fail_('length');
  if (/(\d[\d\-]{7,}\d)|@|https?:|www\.|\.(com|jp|net)/i.test(t)) fail_('personal');
  var n = normText_(t);
  for (var i = 0; i < NG.length; i++) if (new RegExp(NG[i]).test(n)) fail_('ng');
  return t;
}
function num01_(v) { var n = Number(v); if (!isFinite(n)) n = 0.5; return Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000; }

/* ---------------- シート ---------------- */
function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(HEADERS[name]); }
  return sh;
}
function rows_(name) {
  var sh = sheet_(name), n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, HEADERS[name].length).getValues();
}
function rewrite_(name, rows) {
  var sh = sheet_(name), n = sh.getLastRow(), w = HEADERS[name].length;
  if (n >= 2) sh.getRange(2, 1, n - 1, w).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, w).setValues(rows);
}
/* セルに数式として解釈されないよう、先頭が = + - @ の文字列には ' を付ける */
function safeCell_(s) { return /^[=+\-@]/.test(s) ? "'" + s : s; }
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function cache_() { return CacheService.getScriptCache(); }
function isOpen_(c) {
  var rows = rows_('classes');
  for (var i = 0; i < rows.length; i++) if (String(rows[i][0]) === c) return rows[i][1] !== false && String(rows[i][1]).toUpperCase() !== 'FALSE';
  return true;
}
function setOpen_(c, open) {
  var sh = sheet_('classes'), rows = rows_('classes');
  for (var i = 0; i < rows.length; i++) if (String(rows[i][0]) === c) { sh.getRange(i + 2, 2, 1, 2).setValues([[open, new Date()]]); return; }
  sh.appendRow([c, open, new Date()]);
}
function bins_(rows, c) {
  var b = {}, n = {};
  KINDS.forEach(function (k) { b[k] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; n[k] = 0; });
  rows.forEach(function (r) {
    if (String(r[0]) !== c || !b[r[2]]) return;
    b[r[2]][Math.min(9, Math.floor(Number(r[3]) / 10))]++; n[r[2]]++;
  });
  return { votes: b, n: n };
}
function timeOf_(v) { return v instanceof Date ? v.getTime() : Number(v) || 0; }
function hidden_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

/* ---------------- API ---------------- */
function state_(p) {
  var c = cls_(p), key = 'st:' + c, cached = cache_().get(key);
  if (cached) return JSON.parse(cached);
  var posts = rows_('posts').filter(function (r) { return String(r[1]) === c && !hidden_(r[7]); })
    .map(function (r) { return { id: String(r[0]), text: String(r[2]), x: Number(r[3]), y: Number(r[4]), t: timeOf_(r[6]) }; })
    .sort(function (a, b) { return a.t - b.t; })
    .slice(-CFG.MAX_POSTS_RETURN);
  var v = bins_(rows_('votes'), c);
  var res = { ok: true, 'class': c, open: isOpen_(c), posts: posts, votes: v.votes, n: v.n, time: Date.now() };
  cache_().put(key, JSON.stringify(res), CFG.STATE_CACHE_SEC);
  return res;
}

function post_(p) {
  var c = cls_(p), cl = client_(p), text = checkText_(p.text), x = num01_(p.x), y = num01_(p.y);
  var rl = 'rl:' + c + ':' + cl;
  if (cache_().get(rl)) fail_('rate');
  return withLock_(function () {
    if (!isOpen_(c)) fail_('closed');
    var mine = rows_('posts').filter(function (r) { return String(r[1]) === c && String(r[5]) === cl; }).length;
    if (mine >= CFG.MAX_POSTS_PER_CLIENT) fail_('limit');
    var now = Date.now(), id = 'P' + now.toString(36) + Utilities.getUuid().slice(0, 4);
    sheet_('posts').appendRow([id, c, safeCell_(text), x, y, cl, now, false]);
    cache_().put(rl, '1', CFG.POST_INTERVAL_SEC);
    cache_().remove('st:' + c);
    return { ok: true, post: { id: id, text: text, x: x, y: y, t: now } };
  });
}

function vote_(p) {
  var c = cls_(p), cl = client_(p), kind = String(p.kind || '');
  if (KINDS.indexOf(kind) < 0) fail_('kind');
  var v = Math.round(Number(p.value));
  if (!isFinite(v) || v < 0 || v > 100) fail_('value');
  var rl = 'rv:' + c + ':' + cl + ':' + kind;
  if (cache_().get(rl)) fail_('rate');
  return withLock_(function () {
    var sh = sheet_('votes'), rows = rows_('votes'), now = Date.now();
    var found = -1;
    for (var i = 0; i < rows.length; i++) if (String(rows[i][0]) === c && String(rows[i][1]) === cl && rows[i][2] === kind) { found = i; break; }
    if (found >= 0) sh.getRange(found + 2, 4, 1, 2).setValues([[v, now]]);
    else sh.appendRow([c, cl, kind, v, now]);
    cache_().put(rl, '1', CFG.VOTE_INTERVAL_SEC);
    cache_().remove('st:' + c);
    return { ok: true };
  });
}

function admin_(p) {
  var c = cls_(p);
  var pin = PropertiesService.getScriptProperties().getProperty('TEACHER_PIN');
  if (!pin) fail_('nopin');
  var fk = 'pf', fails = Number(cache_().get(fk) || 0);
  if (fails >= CFG.PIN_FAIL_LIMIT) fail_('locked');
  if (String(p.pin || '') !== String(pin)) { cache_().put(fk, String(fails + 1), CFG.PIN_LOCK_SEC); fail_('pin'); }
  var op = String(p.op || 'list');
  return withLock_(function () {
    switch (op) {
      case 'list': break;
      case 'hide': case 'unhide': {
        var sh = sheet_('posts'), rows = rows_('posts');
        for (var i = 0; i < rows.length; i++) if (String(rows[i][0]) === String(p.id) && String(rows[i][1]) === c) { sh.getRange(i + 2, 8).setValue(op === 'hide'); break; }
        break;
      }
      case 'clear': rewrite_('posts', rows_('posts').filter(function (r) { return String(r[1]) !== c; })); break;
      case 'clearVotes': rewrite_('votes', rows_('votes').filter(function (r) { return String(r[0]) !== c; })); break;
      case 'open': setOpen_(c, true); break;
      case 'close': setOpen_(c, false); break;
      default: fail_('op');
    }
    cache_().remove('st:' + c);
    var posts = rows_('posts').filter(function (r) { return String(r[1]) === c; })
      .map(function (r) { return { id: String(r[0]), text: String(r[2]), t: timeOf_(r[6]), hidden: hidden_(r[7]) }; })
      .sort(function (a, b) { return a.t - b.t; });
    var v = bins_(rows_('votes'), c);
    return { ok: true, op: op, 'class': c, open: isOpen_(c), posts: posts, votes: v.votes, n: v.n };
  });
}

/* ---------------- 生徒の記録（続きから再開） ---------------- */
var PROG_FIELDS = ['pre', 'post', 'mistBest', 'brushVote', 'myPosts', 'reflection', 'lab', 'client'];
var PROG_MAX = 30000;   // 1人分の記録の上限（文字数）
function salt_() {
  var props = PropertiesService.getScriptProperties(), s = props.getProperty('USER_SALT');
  if (s) return s;
  return withLock_(function () {
    var again = props.getProperty('USER_SALT'); if (again) return again;
    var made = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('USER_SALT', made); return made;
  });
}
/* 開いた人の学校アカウントから、元に戻せない符号を作る（メールアドレスは保存しない） */
function userKey_() {
  var email = ''; try { email = String(Session.getActiveUser().getEmail() || ''); } catch (err) { email = ''; }
  if (!email) return null;
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt_() + '|' + email.toLowerCase(), Utilities.Charset.UTF_8);
  return 'U' + Utilities.base64EncodeWebSafe(d).replace(/=+$/, '').slice(0, 32);
}
function findProgress_(key) {
  var rows = rows_('progress');
  for (var i = 0; i < rows.length; i++) if (String(rows[i][0]) === key) return { i: i, row: rows[i] };
  return null;
}
function me_() {
  var key = userKey_();
  if (!key) return { ok: true, signed: false };
  var f = findProgress_(key), data = null;
  if (f) { try { data = JSON.parse(String(f.row[2])); } catch (err) { data = null; } }
  return { ok: true, signed: true, who: key, progress: data, 'class': f ? String(f.row[1] || '') : '', updated: f ? timeOf_(f.row[3]) : 0 };
}
function save_(p) {
  var key = userKey_();
  if (!key) fail_('signin');
  var src = p.data;
  if (typeof src === 'string') { try { src = JSON.parse(src); } catch (err) { fail_('badjson'); } }
  if (!src || typeof src !== 'object' || Array.isArray(src)) fail_('data');
  var data = {};
  PROG_FIELDS.forEach(function (k) { if (src[k] !== undefined) data[k] = src[k]; });
  var json = JSON.stringify(data);
  if (json.length > PROG_MAX) fail_('toolarge');
  var rl = 'sv:' + key;
  if (cache_().get(rl)) fail_('rate');
  var c = String(p['class'] || '').trim().toUpperCase(); if (!/^[A-Z0-9_-]{1,16}$/.test(c)) c = '';
  return withLock_(function () {
    var sh = sheet_('progress'), f = findProgress_(key), now = Date.now();
    /* ほかの端末の新しい記録を、古い記録で上書きしない（base＝この端末が最後に受け取った版） */
    if (f && p.base != null && timeOf_(f.row[3]) > Number(p.base)) fail_('conflict');
    if (f) sh.getRange(f.i + 2, 2, 1, 3).setValues([[c || String(f.row[1] || ''), json, now]]);
    else sh.appendRow([key, c, json, now]);
    cache_().put(rl, '1', 1);
    return { ok: true, updated: now };
  });
}

/* ---------------- 教員が最初に一度だけ実行 ---------------- */
function setup() {
  if (!SpreadsheetApp.getActiveSpreadsheet()) throw new Error('このスクリプトはスプレッドシートに紐づいていません。スプレッドシートを開き、［拡張機能］→［Apps Script］から作り直してください。');
  Object.keys(HEADERS).forEach(function (name) {
    var sh = sheet_(name);
    sh.setFrozenRows(1);
  });
  sheet_('posts').getRange('C:C').setNumberFormat('@');
  sheet_('progress').getRange('C:C').setNumberFormat('@');
  salt_();
  try { Session.getActiveUser().getEmail(); } catch (err) { /* 権限の確認のため */ }
  var pin = PropertiesService.getScriptProperties().getProperty('TEACHER_PIN');
  console.log(pin ? 'セットアップ完了。TEACHER_PIN は設定済みです。' : 'セットアップ完了。［プロジェクトの設定］→［スクリプト プロパティ］で TEACHER_PIN を追加してください。');
  return 'OK ' + VERSION;
}
/* 権限の確認だけをする小さな関数（setup で「不明なエラー」が出たとき、切り分けに使う） */
function check() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  console.log('スプレッドシート：' + (ss ? ss.getName() : '（紐づいていない）') + '／版 ' + VERSION + '／PIN ' + (PropertiesService.getScriptProperties().getProperty('TEACHER_PIN') ? '設定済み' : '未設定'));
  return 'OK';
}
