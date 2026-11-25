// GAS の API をモック上で確かめる（node tests/gas.test.js）
'use strict';
const assert = require('assert');
const { createGas } = require('./gas-mock');
let n = 0;
function t(name, fn) { fn(); n++; console.log('  ok', name); }

const g = createGas({ pin: '2468' });
const A = 'abcdefgh1234', B = 'zyxwvuts9876';

t('ping', () => { const r = g.get({ action: 'ping' }); assert.ok(r.ok); assert.ok(r.version); });
t('不明な action', () => assert.strictEqual(g.get({ action: 'xxx' }).error, 'unknown'));
t('壊れた JSON', () => assert.strictEqual(g.post('{bad').error, 'badjson'));
t('クラスコードの検査', () => { assert.strictEqual(g.get({ action: 'state', class: '２年' }).error, 'class'); assert.strictEqual(g.get({ action: 'state' }).error, 'class'); });
t('空の state', () => { const r = g.get({ action: 'state', class: '2a' }); assert.ok(r.ok); assert.strictEqual(r.class, '2A'); assert.strictEqual(r.open, true); assert.deepStrictEqual(r.posts, []); assert.strictEqual(r.votes.brush.length, 10); });
t('投稿できる', () => { const r = g.post({ action: 'post', class: '2A', client: A, text: ' 霧の奥の  見えない松 ', x: 0.31234, y: 2 }); assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.post.text, '霧の奥の 見えない松'); assert.strictEqual(r.post.x, 0.312); assert.strictEqual(r.post.y, 1); });
t('state に出る（書き込みでキャッシュが消える）', () => { const r = g.get({ action: 'state', class: '2A' }); assert.strictEqual(r.posts.length, 1); assert.strictEqual(r.posts[0].text, '霧の奥の 見えない松'); });
t('連投制限', () => assert.strictEqual(g.post({ action: 'post', class: '2A', client: A, text: 'もう一つ', x: .5, y: .5 }).error, 'rate'));
t('別の端末は書ける', () => assert.ok(g.post({ action: 'post', class: '2A', client: B, text: '=SUM(A1)', x: .5, y: .5 }).ok));
t('数式に見える文字列もそのまま返る', () => { g.advance(6); assert.ok(g.get({ action: 'state', class: '2A' }).posts.some(p => p.text === '=SUM(A1)')); });
t('30字を超えると拒否', () => { g.advance(20); assert.strictEqual(g.post({ action: 'post', class: '2A', client: A, text: 'あ'.repeat(31), x: .5, y: .5 }).error, 'length'); });
t('空文字は拒否', () => assert.strictEqual(g.post({ action: 'post', class: '2A', client: A, text: '   ', x: .5, y: .5 }).error, 'length'));
t('NG 語（カタカナ・全角・伸ばし棒も）', () => { for (const w of ['バーカ', 'しね', 'ｷﾓい', 'う ざ い']) assert.strictEqual(g.post({ action: 'post', class: '2A', client: A, text: w, x: .5, y: .5 }).error, 'ng', w); });
t('NG 語に似た普通の言葉は通る', () => { for (const w of ['霧ばかり', 'かすみ', 'くずれた石垣']) { g.advance(20); const r = g.post({ action: 'post', class: '2A', client: 'okword' + w.length + 'abcd', text: w, x: .5, y: .5 }); assert.ok(r.ok, w + JSON.stringify(r)); } });
t('個人情報らしきものは拒否', () => { for (const w of ['090-1234-5678', 'a@b', 'https://x']) assert.strictEqual(g.post({ action: 'post', class: '2A', client: A, text: w, x: .5, y: .5 }).error, 'personal', w); });
t('1端末10件まで', () => { const C = 'limitclient01'; for (let i = 0; i < 10; i++) { g.advance(16); assert.ok(g.post({ action: 'post', class: '3B', client: C, text: '松' + i, x: .5, y: .5 }).ok); } g.advance(16); assert.strictEqual(g.post({ action: 'post', class: '3B', client: C, text: '松', x: .5, y: .5 }).error, 'limit'); });
t('クラスは分かれる', () => { g.advance(6); assert.strictEqual(g.get({ action: 'state', class: '3B' }).posts.length, 10); assert.ok(g.get({ action: 'state', class: '2A' }).posts.every(p => !/^松\d$/.test(p.text))); });
t('投票と上書き', () => {
  assert.ok(g.post({ action: 'vote', class: '2A', client: A, kind: 'brush', value: 85 }).ok);
  assert.ok(g.post({ action: 'vote', class: '2A', client: B, kind: 'brush', value: 12 }).ok);
  g.advance(3); assert.ok(g.post({ action: 'vote', class: '2A', client: A, kind: 'brush', value: 100 }).ok);
  assert.ok(g.post({ action: 'vote', class: '2A', client: A, kind: 'mist', value: 70 }).ok);
  const r = g.get({ action: 'state', class: '2A' });
  assert.deepStrictEqual(r.votes.brush, [0, 1, 0, 0, 0, 0, 0, 0, 0, 1]); assert.strictEqual(r.n.brush, 2); assert.strictEqual(r.votes.mist[7], 1);
});
t('ぼかし絵の投票', () => { g.advance(3); assert.ok(g.post({ action: 'vote', class: '2A', client: B, kind: 'blur', value: 50 }).ok); assert.strictEqual(g.get({ action: 'state', class: '2A' }).votes.blur[5], 1); });
t('投票の検査', () => { g.advance(3); assert.strictEqual(g.post({ action: 'vote', class: '2A', client: A, kind: 'xx', value: 1 }).error, 'kind'); assert.strictEqual(g.post({ action: 'vote', class: '2A', client: A, kind: 'brush', value: 101 }).error, 'value'); });
t('PIN がちがう', () => assert.strictEqual(g.post({ action: 'admin', class: '2A', pin: '0000', op: 'list' }).error, 'pin'));
t('一覧・非表示・再表示', () => {
  const l = g.post({ action: 'admin', class: '2A', pin: '2468', op: 'list' }); assert.ok(l.ok); const id = l.posts[0].id;
  const h = g.post({ action: 'admin', class: '2A', pin: '2468', op: 'hide', id }); assert.ok(h.posts.find(p => p.id === id).hidden);
  assert.ok(!g.get({ action: 'state', class: '2A' }).posts.some(p => p.id === id));
  g.post({ action: 'admin', class: '2A', pin: '2468', op: 'unhide', id });
  assert.ok(g.get({ action: 'state', class: '2A' }).posts.some(p => p.id === id));
});
t('受付の停止と開始', () => {
  assert.strictEqual(g.post({ action: 'admin', class: '2A', pin: '2468', op: 'close' }).open, false);
  g.advance(20); assert.strictEqual(g.post({ action: 'post', class: '2A', client: 'closedclient1', text: '霧', x: .5, y: .5 }).error, 'closed');
  assert.strictEqual(g.get({ action: 'state', class: '2A' }).open, false);
  assert.strictEqual(g.post({ action: 'admin', class: '2A', pin: '2468', op: 'open' }).open, true);
  assert.ok(g.post({ action: 'post', class: '2A', client: 'closedclient1', text: '霧', x: .5, y: .5 }).ok);
});
t('全消去と投票リセットは他クラスに影響しない', () => {
  g.post({ action: 'admin', class: '2A', pin: '2468', op: 'clear' }); g.post({ action: 'admin', class: '2A', pin: '2468', op: 'clearVotes' });
  const r = g.get({ action: 'state', class: '2A' }); assert.strictEqual(r.posts.length, 0); assert.strictEqual(r.n.brush, 0);
  assert.strictEqual(g.get({ action: 'state', class: '3B' }).posts.length, 10);
});
t('PIN の総当たりはロック', () => { for (let i = 0; i < 9; i++) g.post({ action: 'admin', class: '2A', pin: 'x', op: 'list' }); assert.strictEqual(g.post({ action: 'admin', class: '2A', pin: '2468', op: 'list' }).error, 'locked'); g.advance(601); assert.ok(g.post({ action: 'admin', class: '2A', pin: '2468', op: 'list' }).ok); });
t('PIN 未設定', () => { const g2 = createGas({ pin: null }); delete g2.props.TEACHER_PIN; assert.strictEqual(g2.post({ action: 'admin', class: '2A', pin: '', op: 'list' }).error, 'nopin'); });
t('setup が動く', () => { g.sandbox.setup(); assert.ok(g.sheets.has('classes')); });
/* ---- 学校のドメイン内だけに公開する場合：GAS が教材の画面を配信する ---- */
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');
t('ping に版が出る', () => assert.strictEqual(g.get({ action: 'ping' }).version, '1.4.0'));
t('外部への通信の権限を求めない（UrlFetchApp を使わない。学校の管理設定で setup が止まらないように）', () => {
  assert.ok(!/UrlFetchApp/.test(SRC), 'UrlFetchApp が残っている（外部通信の権限を求めてしまう）');
  for (const svc of ['GmailApp', 'DriveApp', 'MailApp', 'CalendarApp', 'DocumentApp', 'openById', 'openByUrl']) assert.ok(!SRC.includes(svc), svc + ' を使っている（余計な権限を求める）');
});
t('action なしの GET は、教材を読み込む小さなページを返す', () => {
  const g2 = createGas({ pin: '1' });
  const o = g2.page({ 'class': '2A', scene: 'brush' });
  assert.ok(o.html.includes('window.KUUHAKU_EMBEDDED=true'), '埋め込みの印がない');
  assert.ok(o.html.includes('"https://sakadosoutan-boop.github.io/kuuhaku/"'), '教材の置き場所が入っていない');
  assert.ok(o.html.includes('https://script.google.com/a/macros/saitama.example/s/DEPLOY/exec'), '自分の URL が入っていない');
  assert.ok(o.html.includes('"class":"2A"') && o.html.includes('"scene":"brush"'));
  assert.ok(/fetch\(B\+"index\.html"/.test(o.html), 'ブラウザで教材を取り寄せていない');
  assert.ok(o.html.includes('document.write(h)'), '取り寄せた教材を書き込んでいない');
  assert.ok(o.html.length < 6000, '読み込み役のページが大きすぎる ' + o.html.length);
  assert.strictEqual(o.title, '松林図をあるく'); assert.deepStrictEqual(o.meta[0][0], 'viewport'); assert.strictEqual(o.mode, 'ALLOWALL');
  assert.deepStrictEqual(g2.net.log, [], 'サーバー側で外部へ取りに行っている');
});
t('Apps Script に貼った HTML ファイル「Index」があれば、それをそのまま配信する', () => {
  const g2 = createGas({ pin: '1' }); g2.files.Index = '<!doctype html><html><head><title>t</title></head><body>' + 'y'.repeat(2000) + '</body></html>';
  const o = g2.page({}); assert.ok(o.html.includes('yyyy') && /<head>\s*<script>window\.KUUHAKU_EMBEDDED/.test(o.html)); assert.ok(!o.html.includes('document.write(h)'));
});
t('APP_URL をスクリプト プロパティで変えられる', () => {
  const g2 = createGas({ pin: '1' }); g2.props.APP_URL = 'https://example.github.io/my-kuuhaku'; const o = g2.page({});
  assert.ok(o.html.includes('"https://example.github.io/my-kuuhaku/"'));
});
t('URL のパラメータに <script> を混ぜても、画面に注入されない', () => {
  const g2 = createGas({ pin: '1' }); const o = g2.page({ 'class': '2A"</script><script>alert(1)</script>', scene: '\u2028x' });
  assert.ok(!o.html.includes('</script><script>alert(1)'), '注入された'); assert.ok(o.html.includes('\\u003c/script')); assert.ok(!o.html.includes('\u2028'));
});
t('api()：google.script.run の入口が、これまでの API と同じ結果を返す', () => {
  const g2 = createGas({ pin: '2468' });
  assert.strictEqual(JSON.parse(g2.api('{"action":"ping"}')).version, '1.4.0');
  assert.strictEqual(JSON.parse(g2.api('{bad')).error, 'badjson');
  const r = JSON.parse(g2.api(JSON.stringify({ action: 'post', 'class': '2A', client: 'apiclient001', text: '霧の奥', x: .4, y: .5 }))); assert.ok(r.ok);
  assert.strictEqual(JSON.parse(g2.api(JSON.stringify({ action: 'state', 'class': '2A' }))).posts[0].text, '霧の奥');
  assert.strictEqual(JSON.parse(g2.api(JSON.stringify({ action: 'admin', 'class': '2A', pin: 'x', op: 'list' }))).error, 'pin');
});
t('action 付きの GET は、これまでどおり JSON（公開範囲が「全員」の方式）', () => { const r = g.get({ action: 'ping' }); assert.ok(r.ok); });
t('setup と check：紐づいたスプレッドシートで動き、版を返す', () => { const g2 = createGas({ pin: '1' }); assert.strictEqual(g2.sandbox.setup(), 'OK 1.4.0'); assert.strictEqual(g2.sandbox.check(), 'OK'); });
/* ---- 生徒の記録：学校のアカウントで見分けて、続きから再開できる ---- */
t('記録：ログインしていなければ signed:false（保存もしない）', () => {
  const g2 = createGas({ pin: '1' });
  assert.deepStrictEqual(JSON.parse(g2.api('{"action":"me"}')), { ok: true, signed: false });
  assert.strictEqual(JSON.parse(g2.api(JSON.stringify({ action: 'save', data: { pre: [1, 2, 3, 4, 1, 2] } }))).error, 'signin');
});
t('記録：保存して、別の端末（同じアカウント）から読み出せる', () => {
  const g2 = createGas({ pin: '1' }), A = 'st001@saitama.example';
  const m0 = JSON.parse(g2.apiAs(A, '{"action":"me"}')); assert.ok(m0.signed); assert.strictEqual(m0.progress, null); assert.strictEqual(m0.updated, 0);
  const sv = JSON.parse(g2.apiAs(A, JSON.stringify({ action: 'save', 'class': '2a', data: { pre: [1, 2, 3, 4, 1, 2], brushVote: 77, myPosts: [{ text: '霧の奥', x: .3, y: .4, t: 1 }], lab: { kz: '見えた' }, reflection: '白は無ではない', secret: 'x' } })));
  assert.ok(sv.ok && sv.updated > 0);
  const m1 = JSON.parse(g2.apiAs(A, '{"action":"me"}'));
  assert.deepStrictEqual(m1.progress.pre, [1, 2, 3, 4, 1, 2]); assert.strictEqual(m1.progress.brushVote, 77); assert.strictEqual(m1.progress.myPosts[0].text, '霧の奥');
  assert.strictEqual(m1.progress.secret, undefined, '決まった項目以外は保存しない'); assert.strictEqual(m1.updated, sv.updated); assert.strictEqual(m1.who, m0.who);
});
t('記録：上書き保存は1行のまま。別のアカウントとは混ざらない', () => {
  const g2 = createGas({ pin: '1' }), A = 'st001@saitama.example', B = 'st002@saitama.example';
  g2.apiAs(A, JSON.stringify({ action: 'save', data: { brushVote: 10 } })); g2.advance(2);
  g2.apiAs(A, JSON.stringify({ action: 'save', data: { brushVote: 90 } })); g2.advance(2);
  g2.apiAs(B, JSON.stringify({ action: 'save', data: { brushVote: 50 } }));
  assert.strictEqual(JSON.parse(g2.apiAs(A, '{"action":"me"}')).progress.brushVote, 90);
  assert.strictEqual(JSON.parse(g2.apiAs(B, '{"action":"me"}')).progress.brushVote, 50);
  assert.strictEqual(g2.sheets.get('progress').data.length, 3, '見出し＋2人分');
  assert.strictEqual(JSON.parse(g2.apiAs('st003@saitama.example', '{"action":"me"}')).progress, null);
});
t('記録：シートにメールアドレスを書かない（元に戻せない符号だけ）', () => {
  const g2 = createGas({ pin: '1' }), A = 'Taro.Saitama@saitama.example';
  g2.apiAs(A, JSON.stringify({ action: 'save', 'class': '2A', data: { pre: [1, 1, 1, 1, 1, 1] } }));
  const all = JSON.stringify([...g2.sheets.values()].map(s => s.data)).toLowerCase();
  assert.ok(!all.includes('saitama.example') && !all.includes('taro'), 'メールアドレスがシートに残っている');
  const key = g2.sheets.get('progress').data[1][0]; assert.match(key, /^U[A-Za-z0-9_-]{32}$/);
  assert.strictEqual(JSON.parse(g2.apiAs(A.toLowerCase(), '{"action":"me"}')).who, key, '大文字・小文字で別人にしない');
  assert.ok(g2.props.USER_SALT && g2.props.USER_SALT.length > 20, 'USER_SALT が作られていない');
});
t('記録：同じアカウントでも、USER_SALT が違えば別の符号（推測されにくい）', () => {
  const a = createGas({ pin: '1' }), b = createGas({ pin: '1' }), U = 'st001@saitama.example';
  assert.notStrictEqual(JSON.parse(a.apiAs(U, '{"action":"me"}')).who, JSON.parse(b.apiAs(U, '{"action":"me"}')).who);
});
t('記録：大きすぎる・形が違う・連続の保存は断る', () => {
  const g2 = createGas({ pin: '1' }), A = 'st001@saitama.example';
  assert.strictEqual(JSON.parse(g2.apiAs(A, JSON.stringify({ action: 'save', data: { reflection: 'あ'.repeat(31000) } }))).error, 'toolarge');
  assert.strictEqual(JSON.parse(g2.apiAs(A, JSON.stringify({ action: 'save', data: [1, 2] }))).error, 'data');
  assert.ok(JSON.parse(g2.apiAs(A, JSON.stringify({ action: 'save', data: { brushVote: 1 } }))).ok);
  assert.strictEqual(JSON.parse(g2.apiAs(A, JSON.stringify({ action: 'save', data: { brushVote: 2 } }))).error, 'rate');
  g2.advance(2); assert.ok(JSON.parse(g2.apiAs(A, JSON.stringify({ action: 'save', data: { brushVote: 3 } }))).ok);
});
t('記録：古い版をもとにした保存は断る（ほかの端末の新しい記録を消さない）', () => {
  const g2 = createGas({ pin: '1' }), A = 'st001@saitama.example';
  const s1 = JSON.parse(g2.apiAs(A, JSON.stringify({ action: 'save', base: 0, data: { brushVote: 1 } }))); assert.ok(s1.ok); g2.advance(2);
  const s2 = JSON.parse(g2.apiAs(A, JSON.stringify({ action: 'save', base: s1.updated, data: { brushVote: 2 } }))); assert.ok(s2.ok); g2.advance(2);
  assert.strictEqual(JSON.parse(g2.apiAs(A, JSON.stringify({ action: 'save', base: s1.updated, data: { brushVote: 9 } }))).error, 'conflict');
  assert.strictEqual(JSON.parse(g2.apiAs(A, '{"action":"me"}')).progress.brushVote, 2);
});
t('記録：公開範囲「全員」の fetch（doGet/doPost）からは、記録を読み書きできない', () => {
  assert.strictEqual(g.get({ action: 'me' }).error, 'embedonly'); assert.strictEqual(g.post({ action: 'save', data: {} }).error, 'embedonly');
});
/* ---- 補完ラボの結果を、クラスで共有する（三角形の投票・予想） ---- */
t('三角形：kz の投票が、10・50・90 のどれかで集計される', () => {
  const g2 = createGas({ pin: '1' });
  for (const [c, v] of [['kzclient0001', 90], ['kzclient0002', 90], ['kzclient0003', 50], ['kzclient0004', 10]]) assert.ok(g2.post({ action: 'vote', 'class': '2A', client: c, kind: 'kz', value: v }).ok);
  const r = g2.get({ action: 'state', 'class': '2A' }); assert.strictEqual(r.votes.kz[9], 2); assert.strictEqual(r.votes.kz[5], 1); assert.strictEqual(r.votes.kz[1], 1); assert.strictEqual(r.n.kz, 4);
});
t('予想：投稿でき、state に お題ごとに出る', () => {
  const g2 = createGas({ pin: '1' });
  const r = g2.post({ action: 'answer', 'class': '2A', client: 'ansclient001', topic: 'half', text: ' 青い空と 雲 ' }); assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.answer.text, '青い空と 雲'); assert.match(r.answer.id, /^A/);
  g2.post({ action: 'answer', 'class': '2A', client: 'ansclient002', topic: 'hide', text: '幹が続いている' });
  const s = g2.get({ action: 'state', 'class': '2A' }); assert.deepStrictEqual(s.answers.half.map(a => a.text), ['青い空と 雲']); assert.deepStrictEqual(s.answers.hide.map(a => a.text), ['幹が続いている']); assert.deepStrictEqual(s.answers.manga, []);
});
t('予想：同じ人・同じお題は上書き（1人1つ）。別のお題・別の人は別', () => {
  const g2 = createGas({ pin: '1' }), C = 'ansclient001';
  g2.post({ action: 'answer', 'class': '2A', client: C, topic: 'manga', text: '落ちた' }); g2.advance(3);
  const r = g2.post({ action: 'answer', 'class': '2A', client: C, topic: 'manga', text: 'ガシャーン' }); assert.ok(r.ok);
  g2.post({ action: 'answer', 'class': '2A', client: 'ansclient002', topic: 'manga', text: 'コップが割れた' });
  const s = g2.get({ action: 'state', 'class': '2A' }); assert.deepStrictEqual(s.answers.manga.map(a => a.text).sort(), ['ガシャーン', 'コップが割れた']);
  assert.strictEqual(g2.sheets.get('answers').data.length, 3, '見出し＋2人分');
});
t('予想：30字・NG語・個人情報・お題の検査、連打の制限、受付停止', () => {
  const g2 = createGas({ pin: '2468' }), C = 'ansclient001';
  assert.strictEqual(g2.post({ action: 'answer', 'class': '2A', client: C, topic: 'half', text: 'あ'.repeat(31) }).error, 'length');
  assert.strictEqual(g2.post({ action: 'answer', 'class': '2A', client: C, topic: 'half', text: 'バーカ' }).error, 'ng');
  assert.strictEqual(g2.post({ action: 'answer', 'class': '2A', client: C, topic: 'half', text: 'a@b.jp' }).error, 'personal');
  assert.strictEqual(g2.post({ action: 'answer', 'class': '2A', client: C, topic: 'xxx', text: '雲' }).error, 'topic');
  assert.ok(g2.post({ action: 'answer', 'class': '2A', client: C, topic: 'half', text: '雲' }).ok);
  assert.strictEqual(g2.post({ action: 'answer', 'class': '2A', client: C, topic: 'half', text: '空' }).error, 'rate');
  g2.post({ action: 'admin', 'class': '2A', pin: '2468', op: 'close' }); g2.advance(5);
  assert.strictEqual(g2.post({ action: 'answer', 'class': '2A', client: 'ansclient009', topic: 'half', text: '雲' }).error, 'closed');
});
t('予想：先生が非表示にでき、書き直しても再表示されない。全消去で消える。他のクラスには影響しない', () => {
  const g2 = createGas({ pin: '2468' }), C = 'ansclient001';
  g2.post({ action: 'answer', 'class': '2A', client: C, topic: 'half', text: '雲' }); g2.post({ action: 'answer', 'class': '2B', client: C, topic: 'half', text: '山' });
  const l = g2.post({ action: 'admin', 'class': '2A', pin: '2468', op: 'list' }); assert.strictEqual(l.answers.length, 1); assert.strictEqual(l.answers[0].topic, 'half'); const id = l.answers[0].id;
  g2.post({ action: 'admin', 'class': '2A', pin: '2468', op: 'hide', id }); assert.deepStrictEqual(g2.get({ action: 'state', 'class': '2A' }).answers.half, []);
  g2.advance(5); g2.post({ action: 'answer', 'class': '2A', client: C, topic: 'half', text: '空' }); assert.deepStrictEqual(g2.get({ action: 'state', 'class': '2A' }).answers.half, [], '書き直しで再表示された');
  g2.post({ action: 'admin', 'class': '2A', pin: '2468', op: 'unhide', id }); assert.deepStrictEqual(g2.get({ action: 'state', 'class': '2A' }).answers.half.map(a => a.text), ['空']);
  g2.post({ action: 'admin', 'class': '2A', pin: '2468', op: 'clear' }); assert.deepStrictEqual(g2.get({ action: 'state', 'class': '2A' }).answers.half, []);
  assert.deepStrictEqual(g2.get({ action: 'state', 'class': '2B' }).answers.half.map(a => a.text), ['山']);
});
t('予想：シートに数式として解釈される文字列を、そのまま文字として保存する', () => {
  const g2 = createGas({ pin: '1' }); g2.post({ action: 'answer', 'class': '2A', client: 'ansclient001', topic: 'half', text: '=1+1' });
  assert.strictEqual(g2.get({ action: 'state', 'class': '2A' }).answers.half[0].text, '=1+1');
});
/* ---- 今あるデータを壊さない（版 1.3.1 までの形式の行を先に入れて、新機能を通す） ---- */
t('互換：旧形式の posts・votes・classes・progress は、中身も集計も変わらない', () => {
  const g2 = createGas({ pin: '2468' }), S = g2.sandbox;
  S.sheet_('posts').appendRow(['P1', '2A', '霧の向こうの港', 0.3, 0.4, 'oldclient0001', 1700000000000, false]);
  S.sheet_('posts').appendRow(['P2', '2A', '隠された言葉', 0.5, 0.5, 'oldclient0002', 1700000001000, true]);
  S.sheet_('votes').appendRow(['2A', 'oldclient0001', 'brush', 77, 1700000000000]); S.sheet_('votes').appendRow(['2A', 'oldclient0002', 'mist', 33, 1700000000000]); S.sheet_('votes').appendRow(['2A', 'oldclient0001', 'blur', 50, 1700000000000]);
  S.sheet_('classes').appendRow(['2A', true, 1700000000000]);
  S.sheet_('progress').appendRow(['Uoldkey000000000000000000000000000', '2A', JSON.stringify({ brushVote: 77, lab: { kz: '見えた' } }), 1700000000000]);
  const snap = () => JSON.stringify(['posts', 'votes', 'classes', 'progress'].map(n => g2.sheets.get(n).data));
  const before = snap();
  const s = g2.get({ action: 'state', 'class': '2A' });                                   // answers シートが無い状態でも動く
  assert.deepStrictEqual(s.posts.map(p => p.text), ['霧の向こうの港']); assert.strictEqual(s.votes.brush[7], 1); assert.strictEqual(s.votes.mist[3], 1); assert.strictEqual(s.votes.blur[5], 1);
  assert.deepStrictEqual(s.answers, { hide: [], manga: [], half: [] }); assert.strictEqual(s.votes.kz.reduce((a, b) => a + b, 0), 0);
  assert.strictEqual(snap(), before, 'state で既存のシートが変わった');
  assert.ok(g2.sheets.has('answers'), '新しいシート answers が作られていない');
  g2.post({ action: 'answer', 'class': '2A', client: 'newclient0001', topic: 'half', text: '雲' }); g2.post({ action: 'vote', 'class': '2A', client: 'newclient0001', kind: 'kz', value: 90 });
  const after = JSON.parse(snap()), was = JSON.parse(before);
  assert.deepStrictEqual(after[0], was[0], 'posts が変わった'); assert.deepStrictEqual(after[2], was[2], 'classes が変わった'); assert.deepStrictEqual(after[3], was[3], 'progress が変わった');
  assert.deepStrictEqual(after[1].slice(0, was[1].length), was[1], 'votes の既存の行が変わった');     // 新しい行（kz）が足されるだけ
  const me = JSON.parse(g2.apiAs('someone@saitama.example', '{"action":"me"}')); assert.ok(me.signed);
  const adm = g2.post({ action: 'admin', 'class': '2A', pin: '2468', op: 'list' }); assert.strictEqual(adm.posts.length, 2); assert.strictEqual(adm.answers.length, 1);
});
t('互換：以前の教材（answers を知らない）が受け取る state は、これまでの項目をすべて含む', () => {
  const g2 = createGas({ pin: '1' }); g2.post({ action: 'post', 'class': '2A', client: 'oldclient0001', text: '言葉', x: .5, y: .5 });
  const s = g2.get({ action: 'state', 'class': '2A' });
  for (const k of ['ok', 'class', 'open', 'posts', 'votes', 'n', 'time']) assert.ok(k in s, k + ' が無い'); for (const k of ['brush', 'mist', 'blur']) assert.strictEqual(s.votes[k].length, 10);
});
console.log(`GAS API: ${n} 件すべて成功`);
