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
 * 個人情報は集めない：生徒の名前・メールは受け取らない。client は端末ごとのランダムな英数字。
 */
var VERSION = '1.1.0';
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
};
var KINDS = ['brush', 'mist', 'blur'];  // 描き込み・靄・ぼかし絵（何段階目でわかったか）
var NG = ['しね', '死ね', 'ころす', '殺す', 'ころせ', '殺せ', 'きもい', 'きしょい', 'うざい', 'うぜ', 'ばか(?!り|す)', '馬鹿', 'あほ(?!う)', '阿呆', 'ぶす(?!い)', 'くず(?!れ|す|も)', 'きえろ', '消えろ', '死んで', 'ちんこ', 'まんこ', 'うんこ', 'ちんちん', 'おっぱい', 'せっくす', 'sex', 'fuck', 'shit', 'でぶ', 'はげ(?!し|む|ま)'];

/* ---------------- 入口 ---------------- */
function doGet(e) { return out_(handle_((e && e.parameter) || {})); }
function doPost(e) {
  var p = {};
  try { p = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return out_({ ok: false, error: 'badjson' }); }
  return out_(handle_(p));
}
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function handle_(p) {
  try {
    switch (String(p.action || '')) {
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

/* ---------------- 教員が最初に一度だけ実行 ---------------- */
function setup() {
  Object.keys(HEADERS).forEach(function (name) {
    var sh = sheet_(name);
    sh.setFrozenRows(1);
  });
  sheet_('posts').getRange('C:C').setNumberFormat('@');
  var pin = PropertiesService.getScriptProperties().getProperty('TEACHER_PIN');
  console.log(pin ? 'セットアップ完了。TEACHER_PIN は設定済みです。' : 'セットアップ完了。［プロジェクトの設定］→［スクリプト プロパティ］で TEACHER_PIN を追加してください。');
}
