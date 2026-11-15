// Code.gs を Node の vm で動かすための、Apps Script のモック（メモリ上のスプレッドシート）
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createGas({ pin = '1234' } = {}) {
  let clock = 1_700_000_000_000;
  const now = () => clock;
  const sheets = new Map();
  const unquote = v => (typeof v === 'string' && v.startsWith("'")) ? v.slice(1) : v;
  function makeSheet(name) {
    const data = []; // 行の配列（1行目＝見出し）
    const range = (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const row = data[r - 1 + i] || []; const v = row[c - 1 + j]; return v === undefined ? '' : v; })),
      setValues: vals => vals.forEach((row, i) => row.forEach((v, j) => { data[r - 1 + i] = data[r - 1 + i] || []; data[r - 1 + i][c - 1 + j] = unquote(v); })),
      setValue: v => { data[r - 1] = data[r - 1] || []; data[r - 1][c - 1] = unquote(v); },
      clearContent: () => { for (let i = 0; i < nr; i++) if (data[r - 1 + i]) for (let j = 0; j < nc; j++) data[r - 1 + i][c - 1 + j] = ''; trim(); },
      setNumberFormat: () => {},
    });
    const trim = () => { while (data.length && data[data.length - 1].every(v => v === '' || v === undefined)) data.pop(); };
    return {
      name, data,
      appendRow: row => { data.push(row.map(unquote)); },
      getLastRow: () => data.length,
      getRange: (a, b, c, d) => typeof a === 'string' ? range(1, 1) : range(a, b, c, d),
      setFrozenRows: () => {},
    };
  }
  const ss = { getName: () => '空白の意味_共有', getSheetByName: n => sheets.get(n) || null, insertSheet: n => { const s = makeSheet(n); sheets.set(n, s); return s; } };
  const cacheStore = new Map();
  const who = { user: '' };                         // いま開いている人の学校アカウント（Session.getActiveUser）
  const props = { TEACHER_PIN: pin };
  const files = {};                                  // Apps Script に貼った HTML ファイル
  const net = { code: 200, body: '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>松林図をあるく</title></head><body><main>' + 'x'.repeat(30000) + '</main></body></html>', log: [] };
  const cacheGet = k => { const e = cacheStore.get(k); if (!e || e.exp <= now()) { cacheStore.delete(k); return null; } return e.v; };
  const sandbox = {
    console: { log() {}, error() {} },
    Date: class extends Date { constructor(...a) { if (a.length) super(...a); else super(now()); } static now() { return now(); } },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    CacheService: { getScriptCache: () => ({
      get: cacheGet,
      getAll: keys => { const o = {}; keys.forEach(k => { const v = cacheGet(k); if (v != null) o[k] = v; }); return o; },
      put: (k, v, sec) => { if (Buffer.byteLength(String(v)) > 100 * 1024) throw new Error('Argument too large: value'); cacheStore.set(k, { v: String(v), exp: now() + (sec || 600) * 1000 }); },
      putAll: (o, sec) => Object.keys(o).forEach(k => { if (Buffer.byteLength(String(o[k])) > 100 * 1024) throw new Error('Argument too large: value'); cacheStore.set(k, { v: String(o[k]), exp: now() + (sec || 600) * 1000 }); }),
      remove: k => cacheStore.delete(k),
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props && props[k] != null ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    Session: { getActiveUser: () => ({ getEmail: () => who.user }), getEffectiveUser: () => ({ getEmail: () => 'teacher@saitama.example' }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ content: s, setMimeType() { return this; }, getContent() { return this.content; } }) },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createHtmlOutputFromFile: name => { if (!(name in files)) throw new Error('No HTML file named ' + name + ' was found.'); return { getContent: () => files[name] }; },
      createHtmlOutput: html => ({ html, title: '', meta: [], mode: null, setTitle(t) { this.title = t; return this; }, addMetaTag(k, v) { this.meta.push([k, v]); return this; }, setXFrameOptionsMode(m) { this.mode = m; return this; }, getContent() { return this.html; } }),
    },
    UrlFetchApp: { fetch: url => { net.log.push(url); return { getResponseCode: () => net.code, getContentText: () => net.body }; } },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/a/macros/saitama.example/s/DEPLOY/exec' }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, str) => Array.from(require('crypto').createHash(alg).update(String(str), 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
      base64EncodeWebSafe: arr => Buffer.from(arr.map(b => b & 255)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'), getUuid: () => Math.random().toString(16).slice(2, 10) + '-0000' },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8'), sandbox, { filename: 'Code.gs' });
  return {
    get: params => JSON.parse(sandbox.doGet({ parameter: params }).getContent()),
    post: body => JSON.parse(sandbox.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent()),
    advance: sec => { clock += sec * 1000; },
    page: params => sandbox.doGet({ parameter: params }),      // 教材の画面（HtmlService の出力）
    api: json => sandbox.api(json),
    apiAs: (user, json) => { who.user = user || ''; try { return sandbox.api(json); } finally { who.user = ''; } },   // その人のアカウントで google.script.run から呼ぶ
    who,                            // google.script.run から呼ぶ入口
    files, net,
    sheets, props, sandbox,
  };
}
module.exports = { createGas };
