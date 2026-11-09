# 松林図をあるく（kuuhaku）— CLAUDE.md

原研哉『空白の意味』（教科書 p.145〜151）の授業で使う、長谷川等伯「松林図屏風」を体感するブラウザ教材。

## 最重要ルール

- 本体は `index.html` 一枚。ビルドなし・外部ライブラリなし（屏風モードの three.js だけは版を固定して `vendor/` に置く予定）。共有以外はオフラインで動くこと。
- スマホ縦（360px）が基準。Chromebook 横長と投影にも対応。タッチ操作が基本で、ホバー前提の操作は作らない。
- 東京国立博物館の画像は使わない。松・霧・霊峰は `drawPine` などの手続きで描く「教材の創作」で、画面にもそう書く。
- 教科書の本文は引用しない。ページ・行と要旨だけを置く。
- 個人情報は集めない。端末識別子は乱数の英数字。投稿の規則（30字・NG語・個人情報・連投）は `index.html` の `checkText` と `gas/Code.gs` の `checkText_` で同じに保つ。
- 記録は localStorage（`kuuhaku.v1`）。読めなくても動き、保存できないときは警告を出す。

## 検証

| コマンド | 内容 |
| --- | --- |
| `node tests/gas.test.js` | `gas/Code.gs` を Node 上のモックで動かす API テスト |
| `node tests/e2e.js` | Playwright でスマホ 360×740・Chromebook 1366×768 の煙テストとスクリーンショット（端末内／GAS モック） |

Playwright はインストール済みの Chromium を使う（`playwright install` はしない）。変更後は両方を通す。

## 公開

- 既定のブランチへの push で `.github/workflows/pages.yml` が GitHub Pages に公開する。
- URL: https://sakadosoutan-boop.github.io/kuuhaku/

## コミット規約

`feat:` / `fix:` / `docs:` / `chore:` ＋日本語要約。README・手引きも日本語。

## 文書

- `docs/設計.md` — 画面遷移・データ形式・GAS の API
- `docs/授業での使い方.md` — 教員用の手引き
- 姉妹教材：漢文道場（sakadosoutan-boop/kanbun）、鴻門の会（sakadosoutan-boop/-koumonnokai-）、寝殿造り3D探訪（sakadosoutan-boop/-3D-）
