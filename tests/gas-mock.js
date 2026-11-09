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
  const ss = { getSheetByName: n => sheets.get(n) || null, insertSheet: n => { const s = makeSheet(n); sheets.set(n, s); return s; } };
  const cacheStore = new Map();
  const props = { TEACHER_PIN: pin };
  const sandbox = {
    console: { log() {}, error() {} },
    Date: class extends Date { constructor(...a) { if (a.length) super(...a); else super(now()); } static now() { return now(); } },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    CacheService: { getScriptCache: () => ({
      get: k => { const e = cacheStore.get(k); if (!e || e.exp <= now()) { cacheStore.delete(k); return null; } return e.v; },
      put: (k, v, sec) => cacheStore.set(k, { v: String(v), exp: now() + (sec || 600) * 1000 }),
      remove: k => cacheStore.delete(k),
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null) }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ content: s, setMimeType() { return this; }, getContent() { return this.content; } }) },
    Utilities: { getUuid: () => Math.random().toString(16).slice(2, 10) + '-0000' },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8'), sandbox, { filename: 'Code.gs' });
  return {
    get: params => JSON.parse(sandbox.doGet({ parameter: params }).getContent()),
    post: body => JSON.parse(sandbox.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent()),
    advance: sec => { clock += sec * 1000; },
    sheets, props, sandbox,
  };
}
module.exports = { createGas };
