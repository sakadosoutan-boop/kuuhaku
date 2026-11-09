// ブラウザでの煙テストとスクリーンショット（node tests/e2e.js）
// Playwright（インストール済みの Chromium）を使う。playwright install は不要。
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const { createGas } = require('./gas-mock');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'screenshots');
const GAS_URL = 'https://script.google.com/macros/s/MOCK/exec';
fs.mkdirSync(SHOTS, { recursive: true });

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' }); fs.createReadStream(p).pipe(rsp);
    }).listen(0, () => res(srv));
  });
}
let count = 0;
const step = async (name, fn) => { await fn(); count++; console.log('  ok', name); };

async function newPage(browser, vp, name, extra = {}) {
  const { noSensors, ...opts } = extra;
  const ctx = await browser.newContext(Object.assign({ viewport: vp, deviceScaleFactor: 1, hasTouch: vp.width < 800, isMobile: vp.width < 800, locale: 'ja-JP' }, opts));
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  if (!noSensors) await ctx.grantPermissions(['accelerometer', 'gyroscope', 'magnetometer']).catch(() => {}); // 屏風モードの「傾きで見る」
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) page.errors.push(m.text()); });
  page.shot = async n => page.screenshot({ path: path.join(SHOTS, `${name}-${n}.png`) });
  return { ctx, page };
}
const setRange = (page, sel, v) => page.$eval(sel, (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, v);
async function findWhite(page) {
  return page.evaluate(() => {
    const f = writeForest;
    for (let y = f.H * 0.15; y < f.H * 0.85; y += 13) for (let x = f.W * 0.15; x < f.W * 0.85; x += 17) if (f.isWhite(x, y)) { const r = f.cv.getBoundingClientRect(); return { x: r.left + x, y: r.top + y }; }
    return null;
  });
}
// 画面の切り替えは霧をはさんで約0.2秒遅れる。#s-◯◯.on になるのを待つ
async function open(page, base, hash) {
  await page.goto(base + '#/' + hash);
  await page.waitForSelector(`#s-${hash.split("/")[0]}.on`, { state: "attached" });
}
const rectOf = (page, sel) => page.$eval(sel, e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });
async function tapAt(page, p, touch) { if (touch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y); }

async function localFlow(browser, base, vp, name) {
  console.log(`[端末内モード] ${name} ${vp.width}×${vp.height}`);
  const { ctx, page } = await newPage(browser, vp, name, { acceptDownloads: true });
  const touch = vp.width < 800;
  await open(page, base, 'home'); await page.waitForTimeout(400);
  await step('ホーム（はじめる・クラスコード）', async () => {
    assert.match(await page.textContent('#shareStatus'), /端末内/); await page.shot('01-home');
    assert.strictEqual((await page.textContent('#startBtn')).trim(), 'はじめる');
    assert.match(await page.getAttribute('#startBtn', 'href'), /#\/check\/pre$/);
    assert.strictEqual(await page.locator('#trail li.done').count(), 0);
    assert.ok(await page.isHidden('#classBox'));
    await page.click('#classChip'); assert.ok(await page.isVisible('#classBox'));
    await page.fill('#classInput', '2b'); await page.click('#classSave');
    assert.ok(/2B/.test(await page.textContent('#shareStatus')) || /2B/.test(await page.textContent('#classChip')), 'クラス 2B が表示されない');
    assert.ok(await page.isHidden('#classBox'));
    await page.click('#classChip'); await page.fill('#classInput', ''); await page.click('#classSave'); // 元に戻す
    assert.strictEqual((await page.textContent('#classChip')).trim(), 'クラスコードを入れる');
    assert.match(await page.textContent('#shareStatus'), /端末内/);
  });

  await step('うめたい度（前）', async () => {
    await open(page, base, 'check/pre');
    for (let i = 0; i < 6; i++) await page.click(`button[data-q="${i}"][data-v="${(i % 4) + 1}"]`);
    await page.click('#checkDone');
    const t = await page.textContent('#checkKake'); assert.match(t, /前：.*13点・バランス派/); assert.match(t, /良し悪しはありません/);
    await page.locator('#checkResult').scrollIntoViewIfNeeded(); await page.shot('02-check');
  });

  await step('ホーム（つづきから・道のり）', async () => {
    await open(page, base, 'home');
    assert.match(await page.textContent('#startBtn'), /つづきから/);
    assert.ok(await page.locator('#trail li.done').count() >= 1, 'li.done が無い');
    assert.strictEqual(await page.locator('#trail li.next').count(), 1);
  });

  await step('道しるべ（今いる丸・つぎへ）', async () => {
    await open(page, base, 'brush');
    assert.strictEqual((await page.textContent('#journey li.cur')).trim(), '2');
    await page.click('#journey a.jb.next'); await page.waitForSelector('#s-forest.on');
    assert.match(page.url(), /#\/forest$/);
  });

  await step('補完ラボ', async () => {
    await open(page, base, 'lab'); await page.click('#kzAns [data-kz="見えた"]'); await page.click('#kzLine'); assert.match(await page.textContent('#kzNote'), /補って/); await page.shot('03-lab-kanizsa');
    await page.click('#labNext'); await page.fill('#hideGuess', '幹が続いている'); await page.click('#hideBtn'); assert.match(await page.textContent('#hideNote'), /想像/);
    await page.click('#labNext'); for (let i = 0; i < 2; i++) await page.click('#blurBtn');
    await page.click('#blurGot'); await page.waitForTimeout(300); assert.match(await page.textContent('#blurNote'), /3段階目/);
    assert.strictEqual(await page.locator('#blurHist .bar.mine b').textContent(), '1');
    for (let i = 0; i < 2; i++) await page.click('#blurBtn'); assert.match(await page.textContent('#blurNote'), /ねこ/);
    await page.click('#labNext'); await page.fill('#mangaGuess', 'コップが落ちた'); await page.click('#mangaGap'); assert.match(await page.textContent('#mangaNote'), /コマとコマ/);
    const sum = await page.textContent('#labSum'); for (const re of [/三角形：見えた/, /幹が続いている/, /3段階目/, /コップが落ちた/]) assert.match(sum, re);
    await page.shot('04-lab-manga');
    await page.click('#labNext'); await page.waitForURL(/#\/brush/);
  });

  await step('描き込みスライダーと投票', async () => {
    await open(page, base, 'brush'); await page.waitForTimeout(300);
    await setRange(page, '#brushRange', 5); await page.waitForTimeout(100); assert.match(await page.textContent('#brushCap'), /北宋/); await page.shot('05-brush-05');
    await setRange(page, '#brushRange', 92); await page.waitForTimeout(100); assert.match(await page.textContent('#brushCap'), /等伯/);
    await page.click('#brushVote'); await page.waitForTimeout(300);
    assert.match(await page.textContent('#brushMine'), /92/);
    assert.ok(await page.locator('#toast.on').count() === 1, '記録のお知らせ（toast）が出ない');
    assert.strictEqual(await page.locator('#brushHist .bar.mine b').textContent(), '1');
    await page.shot('06-brush-92');
  });

  await step('一画面レイアウト（スマホ：舞台・スライダー・主ボタン）', async () => {
    if (vp.width >= 800) return;
    for (const [h, items] of [['brush', ['#brushStage', '#brushRange', '#brushVote']], ['forest', ['#forestStage', '#mistRange', '#mistRec']]]) {
      await open(page, base, h); await page.waitForTimeout(400);
      const jt = (await rectOf(page, '#journey')).top;
      for (const sel of items) {
        const r = await rectOf(page, sel);
        if (sel === '#brushVote' || sel === '#mistRec') { assert.ok(r.top >= 0 && r.bottom <= jt, `${h} ${sel} が道しるべに重なる bottom=${r.bottom} journey=${jt}`); if (r.bottom > jt + 1) console.log(`     (保留) ${sel} が道しるべに ${(r.bottom - jt).toFixed(1)}px 重なる`); continue; }
        // assert.ok(r.bottom <= jt + 1, `${h} ${sel} が道しるべより上に収まらない`);
        assert.ok(r.top >= 0 && r.bottom <= jt + 1 && r.bottom <= vp.height, `${h} ${sel} が画面内（道しるべより上）に収まらない top=${r.top} bottom=${r.bottom} journey=${jt}`);
      }
    }
  });

  await step('霧の松林：進む・靄・記録', async () => {
    await open(page, base, 'forest'); await page.waitForTimeout(900);
    assert.ok(!(await page.evaluate(() => document.querySelector('#coach').classList.contains('gone'))), '歩く前から coach が消えている');
    const z0 = await page.evaluate(() => forest.camZ);
    const box = await page.locator('#forestCv').boundingBox();
    if (touch) { await page.locator('#walkF').dispatchEvent('pointerdown'); await page.waitForTimeout(600); await page.locator('#walkF').dispatchEvent('pointerup'); }
    else { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, 600); await page.waitForTimeout(500); }
    const z1 = await page.evaluate(() => forest.camZ); assert.ok(z1 > z0 + 0.1, `前進していない ${z0}→${z1}`);
    await page.waitForFunction(() => document.querySelector('#coach').classList.contains('gone'), null, { timeout: 3000 }).catch(() => assert.fail('前進しても #coach に gone が付かない'));
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.3, { steps: 6 }); await page.mouse.up();
    const z2 = await page.evaluate(() => forest.camZ); assert.ok(z2 > z1, 'スワイプで前進していない');
    await page.shot('07-forest-70');
    await setRange(page, '#mistRange', 0); await page.waitForTimeout(700);
    assert.ok(await page.isVisible('#overBadge')); await page.shot('08-forest-00');
    await setRange(page, '#mistRange', 64); await page.click('#mistRec'); await page.waitForTimeout(300);
    assert.match(await page.textContent('#mistMine'), /64/);
    const snd = await page.evaluate(async () => { Sound.set(true); setMist(100); await new Promise(r => setTimeout(r, 1500)); const lo = Sound.lp.frequency.value; setMist(0); await new Promise(r => setTimeout(r, 1500)); const hi = Sound.lp.frequency.value; forest.vel = 1; Sound.nextGust = 0; Sound.move(1); Sound.set(false); return { on: !!Sound.ctx, lo, hi }; });
    assert.ok(snd.on, '音が作れない'); assert.ok(snd.hi > snd.lo + 1000, `霧で音がこもらない ${snd.lo} ${snd.hi}`);
    await setRange(page, '#mistRange', 64);
    const ft = await page.evaluate(() => new Promise(r => { let n = 0, t0 = performance.now(); const f = () => { if (++n < 60) requestAnimationFrame(f); else r((performance.now() - t0) / 60); }; requestAnimationFrame(f); }));
    console.log(`     平均フレーム時間 ${ft.toFixed(1)}ms（ヘッドレス・品質 ${await page.evaluate(() => Q.level)}）`);
  });

  await step('本文の要旨のたたみ方', async () => {
    await open(page, base, 'forest');
    const isOpen = () => page.$eval('#s-forest details.passage', d => d.open);
    if (touch) {
      assert.strictEqual(await isOpen(), false, 'スマホ幅で要旨が開いている');
      await page.click('#lessonBtn'); await page.waitForTimeout(200);
      assert.strictEqual(await isOpen(), true, '文字 大で要旨が開かない');
      await page.click('#lessonBtn'); await page.waitForTimeout(200);
    } else assert.strictEqual(await isOpen(), true, 'Chromebook 幅で要旨が閉じている');
  });

  await step('実物を見る（ColBase の画像・見どころ・拡大）', async () => {
    await open(page, base, 'real'); await page.waitForFunction(() => document.querySelector('#realR').naturalWidth > 0 && document.querySelector('#realL').naturalWidth > 0);
    assert.ok(await page.evaluate(() => { const t = document.querySelector('#realTrack'); return t.scrollLeft > 0; }), '右隻から始まっていない');
    await page.click('#realRow figure[data-side=right] .hs >> nth=0'); assert.match(await page.textContent('#realNote'), /右隻/);
    const w0 = await page.evaluate(() => document.querySelector('#realR').getBoundingClientRect().width);
    await page.click('#realIn'); const w1 = await page.evaluate(() => document.querySelector('#realR').getBoundingClientRect().width); assert.ok(w1 > w0 * 1.4, '拡大できない');
    await page.click('#realOut'); await page.click('#realHs'); assert.ok(await page.isHidden('#realRow .hs >> nth=0'));
    assert.match(await page.textContent('#s-real .credit'), /出典：ColBase/);
    await page.shot('17-real');
  });

  await step('屏風モード（WebGL・見る位置・折り方・絵の切り替え・傾き）', async () => {
    await open(page, base, 'byobu'); await page.waitForFunction(() => Byobu.mode === 'gl' || Byobu.mode === 'css', null, { timeout: 15000 });
    assert.strictEqual(await page.evaluate(() => Byobu.mode), 'gl', 'WebGL で表示されていない');
    await page.waitForTimeout(800); await page.shot('18-byobu');
    await page.click('#byViews [data-v=seat]'); await page.waitForTimeout(1200);
    assert.ok(await page.evaluate(() => Byobu.st.ty < 0.8 && Byobu.view === 'seat'));
    const z0 = await page.evaluate(() => Byobu.layout.panels[0].cz); await setRange(page, '#byFold', 55);
    const z1 = await page.evaluate(() => Byobu.layout.panels[0].cz); assert.ok(Math.abs(z1) > Math.abs(z0), '折り方が変わらない');
    assert.match(await page.textContent('#byCredit'), /ColBase/);
    await page.click('#bySrc'); await page.waitForFunction(() => Byobu.src === 'ink'); assert.match(await page.textContent('#byCredit'), /教材の創作/);
    await page.click('#bySrc'); await page.waitForFunction(() => Byobu.src === 'real');
    await page.click('#byTilt'); await page.waitForTimeout(100);
    const yaw = await page.evaluate(async () => { const f = (b, g) => window.dispatchEvent(Object.assign(new Event('deviceorientation'), { beta: b, gamma: g })); f(60, 0); f(60, 30); await new Promise(r => setTimeout(r, 50)); return Byobu.st.yaw; });
    assert.ok(Math.abs(yaw) > 0.3, '傾きで回りこめない ' + yaw);
    await page.click('#byTilt');
    const box = await page.locator('#byobuStage').boundingBox(); const y0 = await page.evaluate(() => Byobu.st.yaw);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 5 }); await page.mouse.up();
    assert.ok(await page.evaluate(y0 => Math.abs(Byobu.st.yaw - y0) > 0.3, y0), 'ドラッグで回りこめない');
    const { ctx: c3, page: p3 } = await newPage(browser, vp, name + '-css', { noSensors: true });
    await p3.goto(base + '?nogl=1#/byobu'); await p3.waitForFunction(() => Byobu.mode === 'css', null, { timeout: 15000 }); await p3.waitForTimeout(600);
    assert.strictEqual(await p3.locator('#byobuCam .pnl').count(), 12); assert.match(await p3.textContent('#byMode'), /軽量/);
    await p3.click('#byTilt'); await p3.waitForTimeout(200); assert.match(await p3.textContent('#byTiltMsg'), /許可されませんでした|使えません|読み取れません/);
    await p3.screenshot({ path: path.join(SHOTS, `${name}-19-byobu-css.png`) }); assert.deepStrictEqual(p3.errors, []); await c3.close();
  });

  await step('白の向こうに書く', async () => {
    await open(page, base, 'write'); await page.waitForTimeout(900);
    const p = await findWhite(page); assert.ok(p, '白い所が見つからない');
    await tapAt(page, p, touch); await page.waitForSelector('#writeForm:not([hidden])');
    await page.fill('#writeText', 'ばかり'); // 「ばかり」は通る … ただし次の投稿は連投制限
    await page.fill('#writeText', 'バーカ'); await page.click('#writeForm button[type=submit]');
    assert.match(await page.textContent('#writeMsg'), /使えません/);
    await page.fill('#writeText', '霧の向こうに続く松の道'); await page.shot('09-write-form');
    await page.click('#writeForm button[type=submit]'); await page.waitForTimeout(300);
    assert.ok(await page.isHidden('#writeForm'));
    assert.match(await page.textContent('#myPosts'), /霧の向こうに続く松の道/);
    assert.ok(await page.evaluate(() => writeForest.words.some(w => w.text === '霧の向こうに続く松の道')));
    await page.waitForTimeout(1500); await page.shot('10-write-words');
    await tapAt(page, await findWhite(page), touch); await page.fill('#writeText', 'もう一つ'); await page.click('#writeForm button[type=submit]');
    assert.match(await page.textContent('#writeMsg'), /少し待って/);
    await page.click('#writeCancel');
  });

  await step('投影モード', async () => {
    await open(page, base, 'proj'); await page.waitForTimeout(2500);
    assert.match(await page.textContent('#projInfo'), /1の言葉/);
    await page.click('#projHistBtn'); await page.waitForTimeout(200); await page.shot('11-proj');
    assert.ok(await page.locator('#projBrushHist .bar i').nth(9).evaluate(e => e.getBoundingClientRect().height > 20), '投影の分布が見えない');
  });

  await step('教員用（端末内）：非表示', async () => {
    await open(page, base, 'teacher'); await page.waitForTimeout(400);
    assert.match(await page.textContent('#tPosts'), /霧の向こうに/);
    await page.click('#tPosts button[data-op=hide]'); await page.waitForTimeout(300);
    assert.ok(await page.locator('#tPosts li.hid').count() === 1);
    const st = await page.evaluate(() => Share.state()); assert.strictEqual(st.posts.length, 0);
    await page.click('#tPosts button[data-op=unhide]'); await page.waitForTimeout(200);
    assert.strictEqual(await page.locator('#tLinks li').count(), 9);
    assert.match(await page.getAttribute('#tLinks li:nth-child(2) button', 'data-link'), /#\/brush$/);
    await page.shot('12-teacher');
  });

  await step('振り返りと出力・コピー', async () => {
    await open(page, base, 'reflect'); await page.click('#rfCheck a'); await page.waitForSelector('#s-check.on');
    for (let i = 0; i < 6; i++) await page.click(`button[data-q="${i}"][data-v="1"]`);
    await page.click('#checkDone'); await page.click('#checkNext a'); await page.waitForSelector('#s-reflect.on');
    await page.fill('#rfText', '白は、松が続いていると想像させる余地だった。');
    const out = await page.inputValue('#rfOut');
    for (const re of [/補完ラボ：三角形 見えた／隠れた所「幹が続いている」／ぼかし絵 3段階目でわかった／2コマのあいだ「コップが落ちた」/, /前 13点（バランス派） → 後 6点（余白たのしみ派）/, /濃さ 64/, /位置 92（荒い筆寄り）/, /・霧の向こうに続く松の道/, /想像させる余地/]) assert.match(out, re);
    assert.match(out, /書き出した日時：/); assert.match(out, /名前や番号を書き加えて/);
    await page.click('#rfCopy'); await page.waitForTimeout(200); assert.match(await page.textContent('#rfMsg'), /コピー/);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#rfSave')]);
    assert.match(dl.suggestedFilename(), /^空白の意味_振り返り_.*\.txt$/);
    const txt = fs.readFileSync(await dl.path(), 'utf8'); assert.match(txt, /霧の向こうに続く松の道/);
    await page.shot('13-reflect');
  });

  await step('授業モード（大きな文字）', async () => {
    await open(page, base, 'forest'); await page.click('#lessonBtn'); await page.waitForTimeout(500);
    assert.ok(await page.evaluate(() => document.body.classList.contains('lesson')));
    await page.shot('14-lesson-forest'); await page.click('#lessonBtn');
  });

  await step('授業設定（大きな文字・軽量の描画）', async () => {
    await open(page, base, 'home'); await page.click('#setBtn'); await page.waitForSelector('#setDlg[open]');
    await page.check('#setDlg [data-pref=lesson]'); assert.ok(await page.evaluate(() => document.body.classList.contains('lesson')));
    await page.shot('16-settings');
    await page.uncheck('#setDlg [data-pref=lesson]');
    await Promise.all([page.waitForEvent('load'), page.click('#qSel [data-q="0"]')]);
    assert.strictEqual(await page.evaluate(() => Q.level), 0);
    await page.click('#setBtn'); await Promise.all([page.waitForEvent('load'), page.click('#qSel [data-q="auto"]')]);
  });

  await step('文字を隠す（H キー・タップで戻る）', async () => {
    await open(page, base, 'forest'); await page.waitForTimeout(500);
    await page.click('#hideBtn2'); assert.ok(await page.isHidden('#walkF'));
    const box = await page.locator('#forestCv').boundingBox(); await page.mouse.click(box.x + 20, box.y + 20); await page.waitForTimeout(100);
    assert.ok(await page.isVisible('#walkF'));
    await page.keyboard.press('h'); assert.ok(await page.isHidden('#walkF')); await page.keyboard.press('h');
  });

  await step('うめたい度は 1〜4 キーでも答えられる', async () => {
    await open(page, base, 'check/pre');
    await page.evaluate(() => { checkAns = [0, 0, 0, 0, 0, 0]; });
    for (const k of '432143') await page.keyboard.press(k);
    assert.ok(!(await page.isDisabled('#checkDone')));
  });

  await step('画面の回転', async () => {
    await open(page, base, 'forest'); await page.waitForTimeout(400);
    await page.setViewportSize({ width: vp.height, height: vp.width }); await page.waitForTimeout(600);
    const [w, cw] = await page.evaluate(() => [forest.W, document.querySelector('#forestCv').getBoundingClientRect().width]); assert.ok(Math.abs(w - cw) < 2, `${w} ${cw}`);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1); assert.ok(sw, '横スクロールが出ている');
    await page.shot('15-rotated');
  });

  await step('localStorage が使えなくても動く', async () => {
    const { ctx: c2, page: p2 } = await newPage(browser, vp, name + '-nols');
    await p2.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
    await p2.goto(base + '#/forest'); await p2.waitForTimeout(600);
    await setRange(p2, '#mistRange', 30); await p2.click('#mistRec'); await p2.waitForTimeout(200);
    assert.ok(await p2.isVisible('#saveWarn'), '保存できない警告が出ていない');
    assert.deepStrictEqual(p2.errors, []); await c2.close();
  });

  assert.deepStrictEqual(page.errors, [], 'コンソールエラー');
  await ctx.close();
}

async function gasFlow(browser, base) {
  console.log('[GAS モード（モック）] スマホ 360×740');
  const gas = createGas({ pin: '2468' });
  gas.post({ action: 'post', class: '2A', client: 'otherstudent1', text: 'もう一つの山', x: 0.7, y: 0.3 });
  gas.advance(20);
  const calls = [];
  const { ctx, page } = await newPage(browser, { width: 360, height: 740 }, 'gas');
  await ctx.route(GAS_URL + '**', async route => {
    const req = route.request(); let body;
    if (req.method() === 'POST') body = gas.post(req.postData()); else body = gas.get(Object.fromEntries(new URL(req.url()).searchParams));
    calls.push(req.method() + ' ' + (req.method() === 'POST' ? JSON.parse(req.postData()).action : new URL(req.url()).searchParams.get('action')));
    gas.advance(1);
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  });
  await page.goto(base + '?class=2a&gas=' + encodeURIComponent(GAS_URL) + '#/home'); await page.waitForTimeout(300);
  await step('リンクから共有先とクラスを取り込む', async () => {
    assert.match(await page.textContent('#shareStatus'), /クラス 2A で共有中/);
    assert.ok(!page.url().includes('gas='), 'URL に gas= が残っている');
  });
  await step('他の生徒の言葉が霧に浮かぶ', async () => {
    await open(page, base, 'write'); await page.waitForTimeout(1200);
    assert.ok(await page.evaluate(() => writeForest.words.some(w => w.text === 'もう一つの山')));
  });
  await step('投稿が GAS に届く', async () => {
    const p = await findWhite(page); await page.touchscreen.tap(p.x, p.y);
    await page.fill('#writeText', '見えない村'); await page.click('#writeForm button[type=submit]'); await page.waitForTimeout(400);
    assert.ok(await page.isHidden('#writeForm'));
    assert.ok(gas.get({ action: 'state', class: '2A' }).posts.some(x => x.text === '見えない村'));
  });
  await step('投票とヒストグラム', async () => {
    gas.post({ action: 'vote', class: '2A', client: 'otherstudent1', kind: 'brush', value: 15 });
    await open(page, base, 'brush'); await page.waitForTimeout(300);
    await setRange(page, '#brushRange', 77); await page.click('#brushVote'); await page.waitForTimeout(600);
    const bars = await page.$$eval('#brushHist .bar b', bs => bs.map(b => b.textContent));
    assert.strictEqual(bars[1], '1'); assert.strictEqual(bars[7], '1');
    await page.shot('brush-hist');
  });
  await step('受付停止中は書けない', async () => {
    gas.post({ action: 'admin', class: '2A', pin: '2468', op: 'close' });
    await open(page, base, 'write'); await page.waitForTimeout(1000);
    assert.ok(await page.isVisible('#writeClosed'));
    gas.advance(30); const p = await findWhite(page); await page.touchscreen.tap(p.x, p.y);
    await page.fill('#writeText', '霧'); await page.click('#writeForm button[type=submit]'); await page.waitForTimeout(300);
    assert.match(await page.textContent('#writeMsg'), /受付を停止/); await page.click('#writeCancel');
  });
  await step('教員用：PIN・受付開始・非表示', async () => {
    await open(page, base, 'teacher'); await page.click('#tPing'); await page.waitForTimeout(300);
    assert.match(await page.textContent('#tGasMsg'), /つながりました/);
    assert.match(await page.inputValue('#tLink'), /class=2A&gas=https/);
    await page.fill('#tPin', '9999'); await page.click('#tLogin'); await page.waitForTimeout(300);
    assert.match(await page.textContent('#tMsg'), /PIN がちがいます/);
    await page.fill('#tPin', '2468'); await page.click('#tLogin'); await page.waitForTimeout(300);
    assert.strictEqual(await page.textContent('#tOpen'), '停止中');
    await page.click('#tOpenBtn'); await page.waitForTimeout(300); assert.strictEqual(await page.textContent('#tOpen'), '受付中');
    await page.locator('#tPosts li', { hasText: 'もう一つの山' }).locator('button').click(); await page.waitForTimeout(300);
    assert.ok(!gas.get({ action: 'state', class: '2A' }).posts.some(x => x.text === 'もう一つの山'));
    await page.shot('teacher');
  });
  await step('投影モードに分布と言葉', async () => {
    await open(page, base, 'proj'); await page.waitForTimeout(1500);
    assert.match(await page.textContent('#projInfo'), /クラス 2A・1の言葉/);
  });
  await step('ポーリングは画面を離れると止まる', async () => {
    await open(page, base, 'home'); await page.waitForTimeout(300); const n = calls.length; await page.waitForTimeout(2500);
    assert.strictEqual(calls.length, n);
  });
  assert.deepStrictEqual(page.errors, [], 'コンソールエラー');
  await ctx.close();
}

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/index.html`;
  const browser = await chromium.launch({ env: Object.assign({}, process.env, { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }) }); // 日本語のファイル名を保つため
  try {
    await localFlow(browser, base, { width: 360, height: 740 }, 'phone');
    await localFlow(browser, base, { width: 1366, height: 768 }, 'chromebook');
    await gasFlow(browser, base);
    console.log(`E2E: ${count} 件すべて成功。スクリーンショット: tests/screenshots/`);
  } catch (e) { console.error('失敗:', e); process.exitCode = 1; }
  finally { await browser.close(); srv.close(); }
})();
