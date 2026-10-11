# Issue #57 / #58 実装計画：案A（Linear / Raycast 風）の本番反映

- 対象ブランチ: `feature/issue-57-58-ui-ux-modern-dnd`
- 採用デザイン: 案A（`docs/design-proposals.md`、`client/public/design-preview.html` の「案A」）
- 想定する実装者: Coder（Gemini Flash）。各 Step に「判断の残り度」を付けた。**「高」の Step で 2 回続けて完了条件を満たせない場合は、Claude（opus）の実装担当に切り替える。** レビューは Claude（opus）が行う。
- 作成日: 2026-10-11

この計画書では「適宜」「必要に応じて」といった判断の余地を残さない。分岐はすべて計画側で決めてある。書かれていないことをしたくなったら、実装せずに Planner に質問すること。

---

## 0. 前提

### 0-1. ブランチの現状
ブランチには、#57/#58 の途中実装が **ステージ済み・未コミット** で載っている（20 ファイル、+1,148 行）。主なものは次のとおり。

| 区分 | ファイル |
|---|---|
| 新規 | `composables/useTheme.js`、`composables/useToast.js`、`utils/theme.js`、`components/ToastHost.vue`、`components/SkeletonCard.vue`、`client/test/theme.test.js`、`client/test/toast.test.js` |
| 変更 | `style.css`（テーマ変数化）、`App.vue`（テーマボタン、ToastHost）、`PartsList.vue`（`alert` をトーストに置き換え、PATCH 化、数量の楽観的更新）ほか |

この上に案Aを積む。**Step 0 で、現状をチェックポイントとしてコミットする**（ユーザーの承認を得てから実行する）。

### 0-2. ステージ済みコードの既知の欠陥（この計画で必ず直す）

| # | 場所 | 欠陥 | 直す Step |
|---|---|---|---|
| K1 | `PartsList.vue` の `adjustQuantity`（L540〜570） | ① 画面を離れる（unmount する）と、400ms 待ちの変更が送信されずに消える。② 同じ部品への PATCH が並行して走り、到着順によっては古い値で上書きされる。③ 失敗時に戻す先が「最初にタップする前の値」で、サーバーが確定した値ではない。④ `quickUpdatePart` の catch で `fetchParts()` を呼ぶため、保留中の楽観値がすべて上書きされる | Step 7 |
| K2 | `ToastHost.vue` | 外側の `aria-live="polite" aria-atomic="true"` と、各トーストの `role="alert"` が競合している。種類に関係なくすべて alert として読み上げられる | Step 8 |
| K3 | `SkeletonCard.vue` | list 型が `<tr>` を返すのに、`PartsList.vue` L909 では `<table>` の外に置かれている（不正な DOM になる） | Step 6 |
| K4 | 9 ファイル | `var(--text-main)` が未定義（`PartForm` L407/L542、`MiniQrScanner` L134、`DataManagement` L240、`QrGenerator` L251、`PartsList` L1437/L1477、`MasterDataManagement` L440、`AiSuggestionReviewModal` L362）。**未定義の変数はこれだけ**（確認済み） | Step 2 |
| K5 | 約 30 行 | `color: white` / `#fff` / `#ffffff` の直書き。ライトテーマで背景が白になると文字が見えない | Step 2 |
| K6 | `client/index.html` | `lang="en"` のまま。theme-color が旧パレット。CSS が読み込まれる前の背景色が指定されていないので、ダークテーマでも一瞬白く光る | Step 1 |
| K7 | `useTheme.js` | `localStorage.setItem` を try/catch で包んでいない（Safari のプライベートブラウズ等で例外になる）。別タブでの変更（`storage` イベント）に追従しない | Step 2 |
| K8 | `toast.test.js` | Step 8 で上限を 5 件から 3 件に、エラーの表示時間を 4500ms から 5000ms に変えるため、このテストが落ちる | Step 8 で同時に更新する |

### 0-3. 実データとデザインの食い違い（決着済み）

| 項目 | 事実 | 決定 |
|---|---|---|
| 「最小在庫」 | `parts` に `min_quantity` 列はない。現在は `quantity < 5` を在庫少と判定する決め打ちになっている | 閾値 5 を定数 `LOW_STOCK_THRESHOLD = 5` にする（client の `constants.js` と server）。在庫バーの幅は `min(100, qty / 20 × 100)%`。カードに「最小 N」は**表示しない**。部品ごとの最小在庫は別 Issue にする |
| サイドバーの件数 | 全パーツ、使用済み、保管庫、AI 候補、カテゴリ別の件数を返す API がない | `GET /api/parts/stats` を新設する（Step 3） |
| カテゴリの色 | カテゴリはユーザーが DB に登録するもので、数も名前も決まっていない | ドットの色は `--cat-{category_id % 8}`。未分類は `--text-3` |
| ⌘K のコマンドパレット | デザインには描いたが、機能としては未定義 | 今回は「検索欄にフォーカスを移す」だけにする。パレット本体は別 Issue |
| 絵文字アイコン | 現在の UI は絵文字を多用している | シェル（サイドバー、上部バー、タブバー）、フィルタバー、カード、トーストは SVG アイコン（`AppIcon.vue`）にする。モーダル内部の絵文字は今回は残す |

---

## 1. 設計判断の一覧

| # | 論点 | 決定 |
|---|---|---|
| D1 | モバイルのナビ | **下部タブバー**。ドロワーは作らない。タブは「パーツ / 使用済み / QR / 保管庫 / その他」の 5 つ。「その他」はボトムシートで開く |
| D2 | ブレークポイント | `≤768px` をモバイルとする（サイドバーを隠し、タブバーを出す）。`769〜1024px` はサイドバーの幅を 200px、`≥1025px` は 240px |
| D3 | フィルタ状態の持ち方 | モジュール単位のシングルトン composable `usePartsFilters` に移す。`PartsList` は監視する側にする。`partsListKey++` による再マウントは**廃止**する |
| D4 | AI 判定候補モーダル | `App.vue` に移す（状態 `showAiReview`）。`PartsList` からは `emit('open-ai-review')` で開く |
| D5 | 数量の同期 | モジュールシングルトン `useQuantitySync`。400ms のデバウンス、部品ごとの直列送信、失敗時はサーバー確定値に戻す。送信のきっかけは unmount、`visibilitychange`、`pagehide`（Step 7） |
| D6 | 検索 | 入力から 250ms のデバウンスでサーバーに問い合わせる。IME の変換中は発火しない（`v-model` を使い続ける） |
| D7 | 表示モードの保存 | `viewMode`（grid/list）と `gridSize`（S/M/L）を localStorage に保存する（キーは `epm_view_mode`、`epm_grid_size`。try/catch で包む） |
| D8 | フォント | `@fontsource-variable/geist@5.3.0`、`@fontsource-variable/geist-mono@5.3.0`、`@fontsource/noto-sans-jp@5.3.0` を **バージョン完全固定（`^` なし）** で入れる。5.3.1 は本日公開なので使わない |
| D9 | PWA | Noto Sans JP の woff2 ファイル群は事前キャッシュから外し、実行時に CacheFirst でキャッシュする。Geist の 2 本は事前キャッシュする |
| D10 | ガラス効果 | `.glass-panel` のクラス名は残し、定義だけを「ぼかしなしのサーフェス」に変える。すべての `backdrop-filter` を削除する |
| D11 | セーフエリア | viewport に `viewport-fit=cover` を追加し、タブバー、FAB、トーストで `env(safe-area-inset-bottom)` を使う |
| D12 | トースト | 常に存在するライブリージョンを 2 つ置く（`role="status"` と `role="alert"`）。同時表示は最大 3 件。表示時間は success 2500ms、info 3000ms、warning 4000ms、error 5000ms |
| D13 | ショートカット | `/` と `⌘K` / `Ctrl+K` で検索欄にフォーカス、`n` で新規追加。**`e.isComposing` が true のとき、および input / textarea / select / contenteditable にフォーカスがあるときは無視する**。モーダルが開いているときも無視する |

---

## 2. コンポーネント構成

```
App.vue（シェル。状態: currentView, モーダル表示, showAiReview）
├─ layout/AppSidebar.vue        … デスクトップ・タブレットのみ
├─ layout/AppTopBar.vue         … パンくず・検索・表示切替・カメラ・＋パーツ追加
├─ <main>
│   ├─ PartsList.vue（currentView='parts'）
│   │   ├─ parts/FilterBar.vue
│   │   ├─ parts/PartCard.vue × N       … グリッド表示
│   │   ├─ parts/PartRow.vue × N        … リスト表示（<tr>）
│   │   ├─ parts/QuantityStepper.vue    … PartCard と PartRow の両方で使う
│   │   └─ parts/PartCardSkeleton.vue   … SkeletonCard.vue を置き換える
│   ├─ UsedPartsView.vue（'used-parts'）
│   └─ LocationGridView.vue（'locations'）
├─ layout/MobileTabBar.vue      … モバイルのみ
├─ layout/MobileMoreSheet.vue   … 「その他」のボトムシート
├─ layout/CameraFab.vue         … モバイルのパーツ画面のみ
├─ AiSuggestionReviewModal.vue（App へ移動。D4）
├─ PartForm / DataManagement / MasterDataManagement / QrGenerator（既存）
└─ ToastHost.vue

composables/: useTheme（修正）、useToast（修正）、usePartsFilters（新規）、usePartsStats（新規）、useQuantitySync（新規）、useShortcuts（新規）
utils/: theme.js（修正）、quantityQueue.js（新規・純粋関数）
components/ui/AppIcon.vue（新規）
```

`#/qr`（QrScanner）は今回もシェルの外に置く。適用するのは配色のトークンだけにする。

### 画面構成（デスクトップ）

```
┌──────────────┬───────────────────────────────────────────────────────────┐
│ AppSidebar   │ AppTopBar: パーツ / 全パーツ  [🔍 検索…  /]  [▦|☰] [📷] [+ パーツ追加 N] │
│ ・ブランド    ├───────────────────────────────────────────────────────────┤
│ ・⌘K 検索    │ FilterBar: [+ フィルタ] [カテゴリ=IC ×] [保管場所=BOX-03 ×]   8 件 [⇅ 登録順] [S M L] [✦ AI判定] │
│ ・全パーツ 342│                                                             │
│ ・使用済み 58 │ PartCard グリッド（auto-fill, minmax(236px,1fr), gap 12px）       │
│ ・保管庫 40  │                                                             │
│ ・AI判定候補 6│                                                             │
│ ・QR入出庫   │                                                             │
│ ─カテゴリ─   │                                                             │
│ ・■ すべて   │                                                             │
│ ・■ ICs  48 │                                                             │
│ ─設定─      │                                                             │
│ ・QR印刷     │                                                             │
│ ・マスタ管理  │                                                             │
│ ・データ管理  │                                                             │
│ [☀|☾|🖥]    │                                                             │
└──────────────┴───────────────────────────────────────────────────────────┘
```

### 画面構成（モバイル、≤768px）

```
┌──────────────────────────┐
│ 全パーツ 342          [QR] │  ← AppTopBar（モバイル版）
│ [🔍 名前・型番・保管場所     ] │
│ (すべて)(ICs)(抵抗)(…) →    │  ← FilterBar（横スクロールのチップ）
├──────────────────────────┤
│ [写] NE555P        [−12+] │  ← モバイルは常に PartRow 相当の行表示
│      タイマーIC              │
│      ●在庫あり · BOX-03      │
│ …                        │
│                    [📷] │  ← CameraFab
├──────────────────────────┤
│ パーツ 使用済み QR 保管庫 その他 │  ← MobileTabBar（高さ 64px + セーフエリア）
└──────────────────────────┘
```

---

## 3. Step ごとの実装仕様

すべての Step に共通する完了条件は次の 3 つ。

- リポジトリのルートで `npm test` が通る（server と client の両方）
- `cd client && npm run build` が通る
- 変更したファイルに、仕様にない機能を足していない

### Step 0：チェックポイントのコミット（判断の残り度：低）
- **ユーザーの承認を得てから** 実行する。
- `git commit -m "wip(#57/#58): テーマ・トースト・スケルトンの土台（案A反映前のチェックポイント）"` を実行する（ステージ済みの内容だけを含める）。
- `client/public/design-preview.html`、`docs/design-proposals.md`、`docs/issue-57-58-plan-a.md` は別のコミットにする。`scratch/` はコミットしない。

### Step 1：フォント・トークン・index.html・PWA（判断の残り度：低）

**1-1. パッケージ**
```
cd client
npm install --save-exact @fontsource-variable/geist@5.3.0 @fontsource-variable/geist-mono@5.3.0 @fontsource/noto-sans-jp@5.3.0
```
インストールした後、`node_modules/@fontsource-variable/geist/index.css` と `node_modules/@fontsource-variable/geist-mono/index.css` を開き、`font-family:` の値を**実際に読んで**、`--font-sans` と `--font-mono` に書く（推測で書かない）。

**1-2. `client/src/main.js`** の先頭（`import './style.css'` より前）に追加する。
```js
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/500.css';
import '@fontsource/noto-sans-jp/700.css';
```

**1-3. `client/src/style.css` を全面的に書き直す。** 構成は次の順にする。

1. `:root`（テーマに依存しないトークン）
   - `--font-sans: "<Geist の family>", "Noto Sans JP", system-ui, -apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", Meiryo, sans-serif`
   - `--font-mono: "<Geist Mono の family>", ui-monospace, "SF Mono", Menlo, Consolas, monospace`
   - 文字サイズ：`--fs-11: 11px`、`--fs-12: 12px`、`--fs-13: 13px`、`--fs-14: 14px`、`--fs-16: 16px`、`--fs-20: 20px`
   - 余白：`--space-1: 4px` 〜 `--space-8: 32px`（4px 刻み）
   - 角丸：`--radius-sm: 6px`、`--radius-md: 8px`、`--radius-lg: 10px`、`--radius-xl: 12px`
   - 時間：`--dur-fast: 80ms`、`--dur: 150ms`、`--ease: cubic-bezier(0.2, 0, 0, 1)`
   - レイアウト：`--sidebar-w: 240px`、`--topbar-h: 52px`、`--tabbar-h: 64px`
2. `:root, :root[data-theme="dark"]` と `:root[data-theme="light"]` の色トークン（下の表のとおり）
3. **旧名のエイリアス**（未着手のコンポーネントが壊れないようにするため。Step 10 で削除する）
   ```css
   :root {
     --bg-primary: var(--bg); --bg-secondary: var(--surface); --bg-card: var(--surface); --bg-card-solid: var(--surface);
     --bg-input: var(--surface); --bg-hover: var(--surface-hover); --bg-dropdown: var(--surface); --modal-bg: var(--surface);
     --text-primary: var(--text); --text-secondary: var(--text-2); --text-muted: var(--text-3);
     --accent-color: var(--accent); --accent-hover: var(--accent-hover); --accent-gradient: var(--accent);
     --border-color: var(--border); --border-focus: var(--accent);
     --success: var(--ok); --warning: var(--warn); --danger: var(--ng); --info: var(--accent);
     --shadow-card: var(--shadow-sm); --shadow-hover: var(--shadow-md); --shadow-modal: var(--shadow-lg);
     --glass-blur: none; --overlay-bg: var(--overlay);
     --transition-fast: var(--dur-fast) var(--ease); --transition-normal: var(--dur) var(--ease); --transition-bounce: var(--dur) var(--ease);
     --font-family: var(--font-sans);
   }
   ```
4. ベース：`html { background: var(--bg); color-scheme: dark }`（ライトのときは `light`）。`body { font-family: var(--font-sans); font-size: var(--fs-13); line-height: 1.5; background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased }`。`@media (max-width: 768px) { body { font-size: var(--fs-14) } input, select, textarea { font-size: 16px } }`
5. `button { outline: none }` は**削除**する。代わりに `:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px }` を置く。
6. 共通クラス：`.glass-panel`（D10：`background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: none;`。`backdrop-filter` は書かない）、`.btn`、`.btn-primary`、`.btn-secondary`、`.btn-ghost`、`.btn-danger`、`.btn-sm`（高さ 28px）、`.btn-md`（高さ 32px）、`.btn-icon`（32×32）。`:active { transform: scale(0.97) }`、`transition: background-color var(--dur), border-color var(--dur), color var(--dur), transform var(--dur-fast)`（**`transition: all` は禁止**）。モバイルでは `.btn` 系の `min-height` を 44px にする。
7. `.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums }`
8. `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: 0ms !important; animation-duration: 0ms !important } }`

**色トークン（案A。プレビューと同じ値）**

| トークン | ライト | ダーク |
|---|---|---|
| `--bg` | `#fbfbfc` | `#0e0f12` |
| `--bg-sidebar` | `#f6f7f9` | `#0b0c0f` |
| `--surface` | `#ffffff` | `#15171c` |
| `--surface-2` | `#f1f2f5` | `#1c1f25` |
| `--surface-hover` | `#e9ebf0` | `#1c1f25` |
| `--border` | `#e4e6eb` | `#262a31` |
| `--border-strong` | `#c9ced8` | `#3a3f4a` |
| `--text` | `#111318` | `#e8eaed` |
| `--text-2` | `#4b5262` | `#a8aebb` |
| `--text-3` | `#646b7a` | `#8a909c` |
| `--accent` | `#4f46e5` | `#8b93ff` |
| `--accent-hover` | `#4338ca` | `#a5abff` |
| `--on-accent` | `#ffffff` | `#0e0f12` |
| `--accent-soft` | `#e0e7ff` | `rgba(139,147,255,0.16)` |
| `--accent-text` | `#3730a3` | `#b4b9ff` |
| `--focus-ring` | `#4f46e5` | `#8b93ff` |
| `--ok` / `--ok-bg` / `--ok-fg` / `--on-ok` | `#15803d` / `#dcfce7` / `#166534` / `#ffffff` | `#4ade80` / `rgba(74,222,128,0.12)` / `#86efac` / `#052e16` |
| `--warn` / `--warn-bg` / `--warn-fg` / `--on-warn` | `#b45309` / `#fef3c7` / `#92400e` / `#ffffff` | `#fbbf24` / `rgba(251,191,36,0.12)` / `#fcd34d` / `#451a03` |
| `--ng` / `--ng-bg` / `--ng-fg` / `--on-ng` | `#b91c1c` / `#fee2e2` / `#991b1b` / `#ffffff` | `#f87171` / `rgba(248,113,113,0.14)` / `#fca5a5` / `#1a0606` |
| `--overlay` | `rgba(17,19,24,0.4)` | `rgba(0,0,0,0.6)` |
| `--shadow-sm` | `0 1px 2px rgba(17,19,24,0.05)` | `0 1px 2px rgba(0,0,0,0.4)` |
| `--shadow-md` | `0 4px 16px rgba(17,19,24,0.08)` | `0 4px 16px rgba(0,0,0,0.4)` |
| `--shadow-lg` | `0 16px 48px rgba(17,19,24,0.16)` | `0 16px 48px rgba(0,0,0,0.6)` |
| `--skeleton` / `--skeleton-hi` | `#eceef2` / `#f6f7f9` | `#1c1f25` / `#252932` |
| `--cat-0`〜`--cat-7` | `#4f46e5` `#0891b2` `#d97706` `#059669` `#db2777` `#7c3aed` `#dc2626` `#64748b` | `#8b93ff` `#22d3ee` `#f59e0b` `#34d399` `#f472b6` `#a78bfa` `#f87171` `#a3a3a3` |

**1-4. `client/index.html`**
- `lang="ja"` にする。
- viewport を `width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover` にする（D11）。
- `<meta name="theme-color" content="#0e0f12">`
- インラインスクリプトの theme-color をライト `#fbfbfc`、ダーク `#0e0f12` にする。判定の規則は変えない（キーは `epm_theme`）。
- インラインスクリプトの**直後**に `<style>html{background:#0e0f12}html[data-theme="light"]{background:#fbfbfc}</style>` を置く（K6 の白フラッシュ対策）。

**1-5. `client/vite.config.js` の workbox**
```js
workbox: {
  globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
  globIgnores: ['**/noto-sans-jp-*.woff2', '**/design-preview.html'],
  runtimeCaching: [{
    urlPattern: ({ url }) => /\/assets\/noto-sans-jp-.*\.woff2$/.test(url.pathname),
    handler: 'CacheFirst',
    options: { cacheName: 'epm-fonts-jp', expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 365 } }
  }]
}
```
`npm run build` の後、`dist/assets` にある Noto のファイル名が `noto-sans-jp-` で始まっていることを確認する。違う名前なら、パターンを実際の名前に合わせる。

**完了条件**
- ダークの見た目が案A（`design-preview.html` の案A）の配色になっている。
- `dist/sw.js` の precache の一覧に Noto の woff2 が含まれていない。

### Step 2：トークンの整合性テストと、白文字・未定義変数の解消（判断の残り度：低）

**2-1. 新規 `client/test/themeTokens.test.js`**（node:test を使い、依存は追加しない）
- **テスト 1**：`client/src` 以下の `.vue`、`.css`、`.js` に出てくる `var(--名前` をすべて集め、その名前が `style.css` で `--名前:` として定義されていることを確認する。
- **テスト 2**：`client/src/App.vue` と `client/src/components/**/*.vue` の `<style>` ブロックで、`#[0-9a-fA-F]{3,8}\b`、`rgba?\(`、`\bwhite\b`、`\bblack\b` を含む行が 0 件であることを確認する。例外は、同じ行に `/* theme-exempt: <理由> */` があるものだけ。
- **テスト 3**：`client/index.html` の文字列に `#0e0f12` と `#fbfbfc` が含まれ、`utils/theme.js` の `THEME_COLORS` と一致することを確認する（2-3 で `THEME_COLORS` を追加する）。

**2-2. 置き換え（K4・K5）**
- `var(--text-main)` を `var(--text)` に置き換える（9 か所）。
- 塗りつぶしの上の白文字は、背景に合わせて次のように置き換える。
  - アクセント色の上 → `var(--on-accent)`
  - success の上 → `var(--on-ok)`
  - warning の上 → `var(--on-warn)`
  - danger の上 → `var(--on-ng)`
- 背景が `--surface` 系の場所にある白文字は `var(--text)` にする。
- 写真やカメラ映像の上に重ねる文字・枠（QR スキャン枠、`MiniQrScanner`、`QrScanner` のオーバーレイ）は**例外**とし、`/* theme-exempt: カメラ映像上のため常に白 */` と書く。
- `QrGenerator.vue` で jsPDF に渡す色は、`<style>` ではなく JS の中にあるので対象外。
- テスト 2 で検出された残りの生の色も、すべてトークンに置き換える。置き換え先に迷ったら、`--surface` / `--surface-2` / `--border` / `--text` / `--text-2` / `--text-3` / `--accent` / `--ok` / `--warn` / `--ng` / `--overlay` / `--shadow-*` の中から最も近い役割のものを選ぶ。

**2-3. `utils/theme.js` と `useTheme.js`（K7）**
- `utils/theme.js` に `export const THEME_COLORS = { light: '#fbfbfc', dark: '#0e0f12' };` を追加する。
- `useTheme.js` は次のように直す。
  - `applyToDocument` が `THEME_COLORS` を使うようにする。
  - `localStorage.setItem` を try/catch で包む。
  - `window.addEventListener('storage', e => { if (e.key === THEME_STORAGE_KEY) { currentTheme.value = normalizeTheme(e.newValue); applyToDocument(resolveEffectiveTheme(currentTheme.value)); } })` を、**モジュールの読み込み時に 1 回だけ** 登録する。
  - `matchMedia` の監視も、モジュールの読み込み時に 1 回だけ登録する。`onMounted` / `onUnmounted` での登録と解除はやめる。
  - テーマを切り替える瞬間だけ `<html>` に `theme-transition` クラスを 200ms 付ける（`prefers-reduced-motion: reduce` のときは付けない）。`style.css` に `html.theme-transition * { transition: background-color 150ms, color 150ms, border-color 150ms !important }` を追加する。
- `cycleTheme` は残す（既存のテストで使っているため）。UI からは使わない。

**完了条件**
- `themeTokens.test.js` の 3 つのテストが通る。
- ライトテーマで全画面を開いたとき、白地に白文字の箇所がない。

### Step 3：`GET /api/parts/stats`（判断の残り度：低）

**3-1. `server/routes/parts.js`**：`router.get('/:id', …)`（現在の L103）**より前**に追加する。
```js
const LOW_STOCK_THRESHOLD = 5;
// GET /api/parts/stats - サイドバー用の件数
router.get('/stats', async (req, res) => {
  try {
    const db = getDb();
    const row = await db.get(`
      SELECT
        SUM(CASE WHEN deleted_at IS NULL AND used_at IS NULL THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN deleted_at IS NULL AND used_at IS NOT NULL THEN 1 ELSE 0 END) AS used,
        SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS trash,
        SUM(CASE WHEN deleted_at IS NULL AND used_at IS NULL AND quantity = 0 THEN 1 ELSE 0 END) AS out_of_stock,
        SUM(CASE WHEN deleted_at IS NULL AND used_at IS NULL AND quantity > 0 AND quantity < ? THEN 1 ELSE 0 END) AS low_stock
      FROM parts`, [LOW_STOCK_THRESHOLD]);
    const categories = await db.all(`
      SELECT c.id, c.name, COUNT(p.id) AS count
      FROM categories c
      LEFT JOIN parts p ON p.category_id = c.id AND p.deleted_at IS NULL AND p.used_at IS NULL
      GROUP BY c.id ORDER BY c.display_order, c.id`);
    const uncategorized = await db.get(`SELECT COUNT(*) AS count FROM parts WHERE category_id IS NULL AND deleted_at IS NULL AND used_at IS NULL`);
    const locations = await db.get('SELECT COUNT(*) AS count FROM locations');
    const ai = await db.get(`SELECT COUNT(*) AS count FROM ai_name_suggestions s JOIN parts p ON s.part_id = p.id WHERE s.status = 'pending' AND p.deleted_at IS NULL`);
    res.json({
      active: row.active || 0, used: row.used || 0, trash: row.trash || 0,
      lowStock: row.low_stock || 0, outOfStock: row.out_of_stock || 0,
      locations: locations.count, aiPending: ai.count,
      categories, uncategorized: uncategorized.count,
      lowStockThreshold: LOW_STOCK_THRESHOLD
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**3-2. 新規 `server/test/partsStats.test.js`**（`partsPatch.test.js` と同じ構成で書く）
- 通常の部品 3 件（数量 0、3、10）、使用済み 1 件、ゴミ箱 1 件、カテゴリ 2 つ（うち 1 つは部品 0 件）、pending の AI 候補 1 件を用意する。
- 期待値は `active 3, used 1, trash 1, outOfStock 1, lowStock 1, aiPending 1`。部品 0 件のカテゴリも `count: 0` で返ること。
- `GET /api/parts/stats` が 200 を返し、**`/:id` として解釈されて 404 にならない**こと（ルートの順序の確認）。

**3-3. `client/src/constants.js`** に `export const LOW_STOCK_THRESHOLD = 5;` を追加する。

### Step 4：共有の composable とアイコン（判断の残り度：低）

**4-1. 新規 `composables/usePartsFilters.js`**（モジュールシングルトン）
```js
import { ref, watch } from 'vue';
const read = (k, d, allowed) => { try { const v = localStorage.getItem(k); return allowed.includes(v) ? v : d; } catch { return d; } };
const query = ref('');            // 検索欄の入力値（そのまま）
const debouncedQuery = ref('');   // 250ms 後に反映される値。fetch に使う
const categoryId = ref('');       // '' = すべて、'none' = 未分類（サーバーは未対応のため、'none' はクライアント側で絞り込む）
const locationId = ref('');
const tagId = ref('');
const sort = ref('id');           // id | name | part_number | category | location | quantity
const order = ref('desc');
const viewMode = ref(read('epm_view_mode', 'grid', ['grid', 'list']));
const gridSize = ref(read('epm_grid_size', 'medium', ['small', 'medium', 'large']));
let t = null;
watch(query, v => { clearTimeout(t); t = setTimeout(() => { debouncedQuery.value = v; }, 250); });
watch(viewMode, v => { try { localStorage.setItem('epm_view_mode', v); } catch {} });
watch(gridSize, v => { try { localStorage.setItem('epm_grid_size', v); } catch {} });
export function usePartsFilters() {
  const clearAll = () => { categoryId.value = ''; locationId.value = ''; tagId.value = ''; query.value = ''; };
  return { query, debouncedQuery, categoryId, locationId, tagId, sort, order, viewMode, gridSize, clearAll };
}
```
- `'none'`（未分類）はサーバーの `category_id` パラメータでは扱えない。クライアントで `parts.filter(p => !p.category_id)` として絞り込む（`PartsList` の `displayedParts` で処理する）。

**4-2. 新規 `composables/usePartsStats.js`**（モジュールシングルトン）
- `stats = ref(null)`、`refresh()` は 1 秒のデバウンス付きで `GET /parts/stats` を呼ぶ。`refreshNow()` はデバウンスなしで呼ぶ。失敗したら `console.error` を出すだけにする（トーストは出さない）。
- `refresh()` を呼ぶ場所：部品の作成・更新・削除・復元・一括操作・数量の確定・AI の採用が成功した後。`App.vue` の `onMounted` では `refreshNow()` を呼ぶ。

**4-3. 新規 `components/ui/AppIcon.vue`**
- props は `name`（必須）と `size`（既定 16）。`<svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` の中に、name に応じたパスを描く。
- name とパスは `client/public/design-preview.html` の `ICON` オブジェクトから**そのまま移植する**：`search`、`plus`、`minus`、`x`、`camera`、`qr`、`grid`、`list`、`check`、`box`、`spark`、`gear`、`sun`、`moon`、`pin`、`sort`、`chip`。加えて `monitor`（`<rect x="3" y="4" width="18" height="12" rx="1"/><path d="M8 20h8M12 16v4"/>`）、`more`（`<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>`）、`printer`（`<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z"/>`）、`database`（`<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>`）、`sliders`（`<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>`）、`alert`（`<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h0"/>`）、`info`（`<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h0"/>`）を追加する。
- 未知の name の場合は何も描かない（例外にしない）。

**4-4. 新規 `composables/useShortcuts.js`**
- `useShortcuts({ onSearch, onNew, isBlocked })` を作る。`onMounted` で `keydown` を登録し、`onUnmounted` で解除する。
- 次のどれかに当てはまる場合は何もしない（D13）。
  - `e.isComposing` が true、または `e.keyCode === 229`
  - `e.target` が input / textarea / select / `[contenteditable]`
  - `isBlocked()` が true（モーダルが開いている）
  - `e.altKey` が押されている
- `/` または（`(e.metaKey || e.ctrlKey) && e.key === 'k'`）のとき：`preventDefault` してから `onSearch()` を呼ぶ。
- `n`（修飾キーなし）のとき：`onNew()` を呼ぶ。

### Step 5：シェル（App とレイアウト）（判断の残り度：中）

**5-1. `App.vue` のテンプレート構造**
```html
<QrScanner v-if="currentPage === 'qr'" />
<div v-else class="app-shell">
  <AppSidebar class="only-desktop" :current-view="currentView" @navigate="switchView" @open-ai-review="showAiReview = true"
              @open-qr-print="showQrGenerator = true" @open-master="openMasterModal()" @open-data="showDataModal = true" />
  <div class="app-main">
    <AppTopBar ref="topBarRef" :current-view="currentView" :uploading="uploadingCameraFile"
               @add="openAddModal" @camera="handleCameraClick" />
    <main class="app-content"> … 既存の 3 ビュー（PartsList / UsedPartsView / LocationGridView） … </main>
  </div>
  <MobileTabBar class="only-mobile" :current-view="currentView" @navigate="switchView" @more="showMoreSheet = true" />
  <CameraFab v-if="currentView === 'parts'" class="only-mobile" :uploading="uploadingCameraFile" @click="handleCameraClick" />
  <MobileMoreSheet v-if="showMoreSheet" @close="showMoreSheet = false" @open-ai-review="…" @open-qr-print="…" @open-master="…" @open-data="…" />
  <input type="file" ref="cameraInput" accept="image/*" capture="environment" class="hidden-input" :disabled="uploadingCameraFile" @change="onCameraFileChange" />
  <AiSuggestionReviewModal v-if="showAiReview" @close="onAiReviewClosed" @updated="onAiReviewUpdated" />
  … 既存のモーダル群 …
</div>
<ToastHost />
```
- 既存の `<header class="main-header">` とドロップダウン（`showDropdown`、`closeDropdown`）は**削除**する。
- `PartsList` から `:key="partsListKey"` と `:initialLocationId` を外す。`handleLocationSelect(id)` の中身は `filters.locationId.value = id; switchView('parts');` にする（D3）。
- `handleSaved` は `partsListRef.value?.fetchParts?.(); stats.refresh();` にする。
- `onAiReviewClosed`：`showAiReview = false` にして、`partsListRef.value?.fetchParts?.()` と `stats.refresh()` を呼ぶ。`onAiReviewUpdated`：`stats.refresh()` だけを呼ぶ。
- `useShortcuts({ onSearch: () => { switchView('parts'); nextTick(() => topBarRef.value?.focusSearch()); }, onNew: openAddModal, isBlocked: () => showModal.value || showDataModal.value || showMasterModal.value || showQrGenerator.value || showAiReview.value || showMoreSheet.value })`
- CSS（`App.vue` の scoped ではなく `style.css` に置く）：
  ```css
  .app-shell { display: grid; grid-template-columns: var(--sidebar-w) minmax(0, 1fr); min-height: 100dvh; background: var(--bg); }
  .app-main { min-width: 0; display: flex; flex-direction: column; }
  .app-content { flex: 1; min-width: 0; }
  .only-mobile { display: none !important; }
  @media (max-width: 1024px) { :root { --sidebar-w: 200px; } }
  @media (max-width: 768px) {
    .app-shell { grid-template-columns: minmax(0, 1fr); padding-bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom)); }
    .only-desktop { display: none !important; }
    .only-mobile { display: flex !important; }
  }
  ```

**5-2. 新規 `layout/AppSidebar.vue`**
- 構造は `design-preview.html` の案A の `.side` と同じ。上から順に次を並べる。
  - ブランドロゴ（`AppIcon chip`）と「電子パーツ管理」
  - 「コマンド・検索 ⌘K」ボタン（押すと `emit('navigate','parts')` してから検索欄にフォーカス。App が `useShortcuts` の `onSearch` と同じ処理を行うので、`emit('search')` として App 側で処理する）
  - ナビ：全パーツ（`stats.active`）、使用済み（`stats.used`）、保管庫ビュー（`stats.locations`）、AI 判定候補（`stats.aiPending`。0 件のときは数字を表示しない）、QR 入出庫（`<a href="#/qr">`）
  - 「カテゴリ」見出しと、カテゴリのボタン：「すべて」（`stats.active`）、各カテゴリ（`stats.categories[i].count`）、「未分類」（`stats.uncategorized`。0 件なら非表示）。押すと `filters.categoryId.value = id`（「すべて」は `''`、「未分類」は `'none'`）にして `emit('navigate','parts')`。選択中のものは `aria-pressed="true"` にし、背景を `--surface-hover` にする。ドットの色は `var(--cat-${id % 8})`。
  - 「設定」見出しと、QR 印刷・マスタ管理・データ管理の 3 つのボタン
  - 下端にテーマの 3 択（ライト / ダーク / 自動）。`role="group" aria-label="テーマ"`、各ボタンに `aria-pressed` と `aria-label` を付け、`useTheme().setTheme(...)` を呼ぶ。
- 現在のビューのリンクには `aria-current="page"` を付ける。
- `position: sticky; top: 0; height: 100dvh; overflow-y: auto; background: var(--bg-sidebar); border-right: 1px solid var(--border);`
- 件数は `font-family: var(--font-mono); font-size: var(--fs-11); color: var(--text-3)`。`stats` が null の間は件数を空にする（「0」とは表示しない）。

**5-3. 新規 `layout/AppTopBar.vue`**
- **デスクトップ**：高さ `var(--topbar-h)`、下線 1px。次を並べる。
  - パンくず：「パーツ / {ビュー名}」。ビュー名は 全パーツ / 使用済み / 保管庫ビュー。
  - 検索欄：`currentView === 'parts'` のときだけ表示する。`v-model="filters.query"`、placeholder は「名前・型番・保管場所で絞り込み」。右端に `/` のキー表示。`<label>` で包み、`<span class="sr-only">部品を検索</span>` を入れる。`type="search"`。
  - 右側（パーツビューのみ）：表示切替（グリッド / リスト。`aria-pressed` 付き）、カメラボタン（`aria-label="画像から追加"`）、「＋ パーツ追加」（`btn-primary`。右端に `N` のキー表示）。
- **モバイル**：1 段目は「{ビュー名}」（20px、600）と件数（パーツビューのときの一覧件数）、右端に QR ボタン（`<a href="#/qr" aria-label="QR入出庫">`、44×44）。2 段目は検索欄（高さ 40px、文字 16px）。「＋ パーツ追加」ボタンはモバイルでは表示しない（FAB と「その他」シートで代わりにする）。
- `defineExpose({ focusSearch })` で検索欄の input にフォーカスする関数を公開する。

**5-4. 新規 `layout/MobileTabBar.vue`**
- `<nav aria-label="メインナビゲーション">` を `position: fixed; left: 0; right: 0; bottom: 0; height: calc(var(--tabbar-h) + env(safe-area-inset-bottom)); padding-bottom: env(safe-area-inset-bottom);` で配置し、`z-index: 50`、上線 1px、背景 `var(--bg-sidebar)` にする。
- 5 つの項目（各 `flex: 1`、高さ 64px）。アイコンは 20px、ラベルは 11px。
  - パーツ（`grid`）
  - 使用済み（`check`）
  - QR（`qr`。`<a href="#/qr">`）
  - 保管庫（`box`）
  - その他（`more`）
- 現在のビューは `aria-current="page"` を付け、色を `var(--accent-text)` にする。

**5-5. 新規 `layout/CameraFab.vue`**
- `position: fixed; right: 16px; bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 16px); width: 56px; height: 56px; border-radius: 16px; background: var(--accent); color: var(--on-accent); box-shadow: var(--shadow-md); z-index: 51`
- 中身は `AppIcon camera`（22）。`aria-label` は、アップロード中なら「登録中」、それ以外は「カメラでパーツ追加」。アップロード中は `disabled` にし、アイコンを回転アニメーションのスピナーにする（reduced-motion のときは止める）。

**5-6. 新規 `layout/MobileMoreSheet.vue`**
- 画面下から出るシートにする。背景幕は `var(--overlay)` で、押すと閉じる。Esc でも閉じる。シート本体は `border-radius: 16px 16px 0 0`、`padding-bottom: env(safe-area-inset-bottom)`。
- 項目（各 48px、アイコン付き）：AI 判定候補（件数付き）、QR 印刷、マスタ管理、データ管理、＋ パーツを追加（`emit('add')`）。
- 最下部にテーマの 3 択（5-2 と同じ部品にする。共通部品 `layout/ThemeSwitch.vue` として切り出し、サイドバーとシートの両方で使う）。
- 開いたときは最初の項目にフォーカスを移す。閉じたら、「その他」タブにフォーカスを戻す。

### Step 6：パーツ一覧の作り直し（判断の残り度：中）

**6-1. `PartsList.vue` 側の変更**
- 内部の `searchQuery`、`selectedCategory`、`selectedLocation`、`selectedTag`、`sortField`、`sortOrder`、`viewMode`、`gridSize` を削除し、`usePartsFilters()` の ref を使う。`fetchParts` の params には、`search: debouncedQuery`、`category_id: categoryId`（`'none'` のときは送らない）、`location_id`、`tag_id`、`sort`、`order`、`status` を渡す。
- 監視する対象は `[debouncedQuery, categoryId, locationId, tagId, showTrash, sort, order]`。`props.initialLocationId` は削除する。
- 既存の「コントロールパネル」（検索欄、3 つの select、並び替え、S/M/L、表示切替、AI ボタン類）のテンプレートは**削除**し、`<FilterBar>` に置き換える。
- 一括選択時の操作バー（既存）はそのまま使い、スタイルだけ変える。`position: sticky; bottom: 16px`（モバイルでは `bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 8px)`）にし、背景 `--surface`、枠線 `--border-strong`、影 `--shadow-lg` にする。
- AI 判定候補の確認ボタンは `emit('open-ai-review')` に変える（D4）。PartsList の中の `<AiSuggestionReviewModal>` は削除する。AI 一括判定モーダル（`showAiBatchModal`）は PartsList に残す。その中の「判定候補を確認する」ボタンは、`showAiBatchModal = false` にしてから `emit('open-ai-review')` を呼ぶ。
- 保存・削除・一括操作が成功した後は `usePartsStats().refresh()` を呼ぶ。
- **グリッド表示**：`<div class="parts-grid" :class="filters.gridSize">` の中に `<PartCard v-for … :part="p" :selected :visible="visibleParts.has(p.id)" @edit @toggle-select @quick-update>` を並べる。列幅は small: `minmax(184px,1fr)`、medium: `minmax(236px,1fr)`、large: `minmax(300px,1fr)`。gap は 12px、padding は `16px 20px 32px`。
- **リスト表示**：`<table class="parts-table">` の中で、`<thead>` に列の見出し、`<tbody>` に `<PartRow v-for>` を置く。読み込み中は `<tbody>` に `<PartCardSkeleton type="row" :count="8" />` を置く（K3 の解消）。
- **モバイル（≤768px）**：`viewMode` に関係なくリスト表示にする。ただし `<table>` は使わず、`PartRow` を `mode="stack"` で `<div>` として描画する（`useMediaQuery` 相当の判定は、`window.matchMedia('(max-width: 768px)')` を ref にして監視する）。
- グリッドの読み込み中は `<PartCardSkeleton type="card" :count="12" />` を、グリッドと同じ `<div class="parts-grid">` の中に置く。
- 「読み込み中...」の文字は削除する。
- 0 件のときは空状態を表示する。中央に `AppIcon search`（32）と、「条件に一致するパーツはありません」の文、「絞り込みを解除」ボタン（`filters.clearAll()` を呼ぶ）。

**6-2. 新規 `parts/FilterBar.vue`**
- デスクトップは 1 行（折り返し可）、padding `10px 20px`、下線 1px。左から順に次を並べる。
  1. 「＋ フィルタ」ボタン（点線の枠）。押すとポップオーバーが開き、保管場所の select とタグの select が出る。選ぶと `filters.locationId` / `filters.tagId` に反映される。
  2. 有効な条件のトークン：`カテゴリ = {名前} ×`、`保管場所 = {名前} ×`、`タグ = {名前} ×`、`ゴミ箱を表示中 ×`。× を押すとその条件を外す。× ボタンには `aria-label="{条件}の絞り込みを解除"` を付ける。
  3. 右寄せで件数（`{n} 件`、`--text-3`）。
  4. 並び替えのボタン（`AppIcon sort` と現在の並び名）。押すとメニューが開く。メニューは 登録順 / 名前順 / 型番順 / カテゴリ順 / 保管場所順 / 個数順 と、区切り線の後の 昇順 / 降順。`role="menu"` と `role="menuitemradio"` を使う。
  5. グリッド表示のときだけ S / M / L の切替（`aria-pressed`）。
  6. 「ゴミ箱」トグル（`aria-pressed`。既存の `showTrash` に対応）。
  7. 「✦ AI判定」ボタン（既存の AI 一括判定の開始。AI が無効のときは非表示）。
- モバイルでは 1〜6 を隠し、**カテゴリのチップを横スクロールで並べる**（すべて、各カテゴリ、未分類。`aria-pressed` 付き、高さ 32px）。並び替えとゴミ箱は、チップの右端の「⋯」ボタンで開くメニューに入れる。
- カテゴリと保管場所とタグの一覧は、PartsList が既に持っているマスタの配列を props で渡す（再取得しない）。

**6-3. 新規 `parts/PartCard.vue`**
- props：`part`、`selected`（Boolean）、`visible`（Boolean。遅延読み込み用）、`selectionMode`（Boolean。1 件以上選択中なら true）
- emits：`edit`、`toggle-select`、`quick-update(changes)`
- 構造（`design-preview.html` の案A の `.card` と同じ）：
  ```
  <article class="card" :class="{ selected }" :data-part-id="part.id">
    <div class="photo">  … 4:3。visible かつ image_path ありなら <img loading="lazy" decoding="async" :alt="part.name">、それ以外は AppIcon chip(40)
       <label class="select"> <input type="checkbox" :checked="selected" @change="emit('toggle-select')" :aria-label="`${part.name} を選択`"> </label>  … ホバー時か selectionMode のときだけ見える
       <span class="status" :class="`s-${status}`"><i></i>{{ statusLabel }}</span>
    </div>
    <div class="body">
      <button class="title" type="button" @click="emit('edit')">  … カード全体の主操作。ボタンにする
        <span v-if="part.part_number" class="pn mono">{{ hl(part.part_number) }}</span>
        <span class="nm">{{ hl(part.name) }}</span>
      </button>
      <div class="meta"> ドット + カテゴリ名（なければ「未分類」） · 保管場所（なければ「場所未設定」） <span class="qr mono">{{ part.qr_code }}</span></div>
      <div v-if="tags.length" class="tags"> 先頭 2 件 + 「+n」 </div>
      <div class="bar" role="img" :aria-label="`在庫レベル ${pct}%`"><div :style="{ width: pct + '%' }" :class="`b-${status}`"></div></div>
      <div class="foot"><span class="mono loc-qr">…（使わない場合は空）</span><QuantityStepper :part="part" /></div>
    </div>
  </article>
  ```
  - 型番がない場合は、`.nm` を `.pn` の位置に、13px・太さ 500 で表示する。
  - 検索語のハイライトは既存の `utils/highlight.js` の `splitByQuery` を使う（`v-html` は使わない）。
- `status` の判定：`qty === 0` なら `ng`、`qty < LOW_STOCK_THRESHOLD` なら `warn`、それ以外は `ok`。数量は `useQuantitySync().displayOf(part)` を使う（Step 7）。`statusLabel` はそれぞれ 在庫切れ / 残りわずか / 在庫あり。`pct = Math.min(100, Math.round(qty / (LOW_STOCK_THRESHOLD * 4) * 100))`。
- 既存の「名前のクリック編集」と「タグのクリック削除」は**カードからは外す**（操作が混み合うため）。名前とタグの編集は、カードをクリックして開く PartForm で行う。数量の直接入力はステッパーの数字をクリックして行う（6-4）。
- スタイル：枠線 1px `--border`、角丸 `--radius-lg`、背景 `--surface`。ホバー時は `border-color: var(--border-strong); box-shadow: var(--shadow-md)`（transition は `border-color` と `box-shadow` だけ。**`transform` は使わない**）。選択中は `outline: 2px solid var(--accent); outline-offset: -1px`。
- 寸法と文字：`.pn` は mono 13px・500、`.nm` は 12px `--text-2`（1 行で省略）、`.meta` は 11px `--text-3`、バーの高さは 3px、`.status` は高さ 20px・11px。

**6-4. 新規 `parts/QuantityStepper.vue`**
- props：`part`、`size`（`'sm'` | `'md'`。既定は `'sm'`。モバイルの行では `'md'`）
- 構造：`<div class="step" role="group" :aria-label="`${part.part_number || part.name} の数量`">`、その中に `−` ボタン（`aria-label="1 減らす"`、数量が 0 なら `disabled`）、数字、`+` ボタン（`aria-label="1 増やす"`）。
- 数字は `<button type="button" class="val mono" :aria-label="`数量 ${qty}。クリックで直接入力`">` にする。押すと、その場で `<input type="number" min="0" inputmode="numeric">` に切り替わる。Enter か blur で確定し、Esc で取り消す。確定すると `qtySync.set(part, value)` を呼ぶ。IME の変換中の Enter は無視する（既存の `onEnter` と同じく `e.isComposing` を確認）。
- ボタンの大きさは、sm が 28×26px、md が 36×44px。
- `−` / `+` は `qtySync.step(part, -1 / +1)` を呼ぶ。

**6-5. 新規 `parts/PartRow.vue`**
- props：`part`、`selected`、`visible`、`mode`（`'table'` | `'stack'`）
- table モードの列：チェックボックス、サムネイル 40×40、型番と名前（2 段）、カテゴリ（ドット付き）、保管場所、在庫（状態の点、文字、ステッパー）、操作（編集ボタン `AppIcon gear` ではなく「編集」の文字ボタン）。
- stack モードは `design-preview.html` の案A のモバイル行と同じにする：サムネイル 52px、型番、名前、状態の点 · 保管場所、ステッパー（md）。行をタップすると edit（ステッパーとチェックボックスのタップは伝播させない。`@click.stop`）。

**6-6. `components/SkeletonCard.vue` を削除し、新規 `parts/PartCardSkeleton.vue` を作る**
- props：`type`（`'card'` | `'row'` | `'stack'`）、`count`
- `card`：PartCard と同じ寸法の箱（4:3 の写真枠、2 本の線（60% と 85%）、meta の線（40%）、3px のバー、右下にステッパーの大きさの箱）
- `row`：`<tr>` を返す（**必ず `<tbody>` の中で使う**）
- `stack`：`<div>` の行
- シマー効果は疑似要素 `::after` の `transform: translateX(-100%)` から `translateX(100%)` へのアニメーションで作る（1.2 秒、無限）。色は `--skeleton` と `--skeleton-hi`。`background-position` のアニメーションは使わない。reduced-motion のときは止める。
- 全体に `aria-hidden="true"` を付ける。親の一覧のコンテナには `aria-busy="true"` を付ける（読み込み中のみ）。

### Step 7：数量の同期（判断の残り度：**高**。Flash で 2 回失敗したら opus に切り替える）

**7-1. 新規 `client/src/utils/quantityQueue.js`（純粋関数のみ。Vue にも DOM にも依存しない）**
```js
// 部品 1 件分の状態: { confirmed, display, inFlight, dirty }
export function createEntry(confirmed) { return { confirmed, display: confirmed, inFlight: false, dirty: false }; }
export function applyStep(entry, delta) { return { ...entry, display: Math.max(0, entry.display + delta), dirty: true }; }
export function applySet(entry, value) { return { ...entry, display: Math.max(0, Math.floor(Number(value) || 0)), dirty: true }; }
// 送信を始めてよいか。始めるなら { entry: inFlight=true/dirty=false にしたもの, send: 送る値 } を返し、だめなら null を返す
export function beginFlush(entry) {
  if (entry.inFlight || !entry.dirty) return null;
  if (entry.display === entry.confirmed) return { entry: { ...entry, dirty: false }, send: null };
  return { entry: { ...entry, inFlight: true, dirty: false }, send: entry.display };
}
export function onSuccess(entry, serverValue) { return { ...entry, inFlight: false, confirmed: serverValue }; }  // display は変えない（送信中に増えた分を保つ）
export function onFailure(entry) { return { ...entry, inFlight: false, dirty: false, display: entry.confirmed }; }
export function isSettled(entry) { return !entry.inFlight && !entry.dirty && entry.display === entry.confirmed; }
```

**7-2. 新規 `client/src/composables/useQuantitySync.js`（モジュールシングルトン）**
```js
import { reactive } from 'vue';
import api from '../api';
import { useToast } from './useToast';
import * as Q from '../utils/quantityQueue';
const DEBOUNCE_MS = 400;
const entries = reactive(new Map());   // partId -> entry
const timers = new Map();              // partId -> timeoutId
const listeners = new Set();           // 確定値が変わったときの通知先（PartsList が replacePart を登録する）

function ensure(part) { if (!entries.has(part.id)) entries.set(part.id, Q.createEntry(Number(part.quantity) || 0)); return entries.get(part.id); }
function schedule(id) { clearTimeout(timers.get(id)); timers.set(id, setTimeout(() => { timers.delete(id); flush(id); }, DEBOUNCE_MS)); }

async function flush(id) {
  const cur = entries.get(id); if (!cur) return;
  const r = Q.beginFlush(cur); if (!r) return;
  entries.set(id, r.entry);
  if (r.send === null) { cleanup(id); return; }
  try {
    const res = await api.patch(`/parts/${id}`, { quantity: r.send });
    const serverValue = Number(res.data?.quantity ?? r.send);
    entries.set(id, Q.onSuccess(entries.get(id), serverValue));
    listeners.forEach(fn => fn(res.data));
    if (entries.get(id).dirty) { flush(id); } else { cleanup(id); }   // 送信中に押された分を続けて送る
  } catch (err) {
    entries.set(id, Q.onFailure(entries.get(id)));
    useToast().error(err.response?.data?.error || '数量の更新に失敗しました。元の値に戻しました');
    cleanup(id);
  }
}
function cleanup(id) { const e = entries.get(id); if (e && Q.isSettled(e) && !timers.has(id)) entries.delete(id); }
function flushAll() { for (const id of Array.from(timers.keys())) { clearTimeout(timers.get(id)); timers.delete(id); flush(id); } }
function hasPending() { for (const e of entries.values()) if (!Q.isSettled(e)) return true; return timers.size > 0; }

export function useQuantitySync() {
  return {
    step(part, delta) { const e = ensure(part); entries.set(part.id, Q.applyStep(e, delta)); schedule(part.id); },
    set(part, value)  { const e = ensure(part); entries.set(part.id, Q.applySet(e, value)); schedule(part.id); },
    displayOf(part)   { const e = entries.get(part.id); return e ? e.display : (Number(part.quantity) || 0); },
    overlay(list)     { return list.map(p => { const e = entries.get(p.id); return e ? { ...p, quantity: e.display } : p; }); },
    flushAll, hasPending,
    onConfirmed(fn)   { listeners.add(fn); return () => listeners.delete(fn); }
  };
}
```
- **ページを離れるときの送信**（モジュールの読み込み時に 1 回だけ登録する）
  - `document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); })`：スマホでアプリを切り替えたときの主な防御。
  - `window.addEventListener('pagehide', sendBeaconAll)`：`sendBeaconAll` は、タイマーが残っている部品と `dirty` の部品について、`fetch(`${import.meta.env.VITE_API_BASE_URL || '/api'}/parts/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity: display }), keepalive: true })` を送る（結果は待たない）。**AWS では API が別オリジンで PATCH にプリフライトが入るため、この送信は保証されない**。保証は visibilitychange とアンマウント時の送信が担う。
  - `window.addEventListener('beforeunload', e => { if (hasPending()) { e.preventDefault(); e.returnValue = ''; } })`：PC でのリロードやタブを閉じる操作の前に、ブラウザ標準の確認を出す。

**7-3. `PartsList.vue` での接続**
- 既存の `adjustQuantity`、`qtyDebounceTimers`、`originalQuantities`、`startQtyEdit`、`saveQtyEdit` と、数量のクイック編集のテンプレートを**削除**する。
- `fetchParts` の結果は `parts.value = qtySync.overlay(response.data)` とする（K1 の ④ を解消）。
- `onMounted` で `const off = qtySync.onConfirmed(replacePart)` を登録し、`onBeforeUnmount` で `qtySync.flushAll(); off();` を実行する。`replacePart(updated)` は、`parts.value` の該当行を `{ ...old, ...updated, quantity: qtySync.displayOf(updated) }` に置き換え、`usePartsStats().refresh()` を呼ぶ。
- `quickUpdatePart` の catch では `fetchParts()` を**呼ばない**（エラーのトーストだけを出す）。成功時の差し替えは `replacePart(res.data)` を使う。
- `UsedPartsView.vue` に数量の操作はないので変更しない。

**7-4. 新規 `client/test/quantityQueue.test.js`**

| ID | 内容 |
|---|---|
| Q-1 | `createEntry(10)` に `applyStep(+1)` を 5 回適用すると `display` は 15。`beginFlush` の `send` は 15 で、`inFlight` は true |
| Q-2 | inFlight 中に `applyStep(+1)` を適用すると `display` は 16、`dirty` は true。`beginFlush` は null を返す。`onSuccess(15)` の後、`confirmed` は 15、`display` は 16、`dirty` は true。もう一度 `beginFlush` すると `send` は 16 |
| Q-3 | `confirmed` 10、`display` 13 で送信中に `onFailure` すると、`display` は 10、`dirty` は false、`inFlight` は false |
| Q-4 | `createEntry(0)` に `applyStep(-1)` を適用しても `display` は 0 |
| Q-5 | `applySet(e, '7.9')` で `display` は 7。`applySet(e, -3)` で 0。`applySet(e, 'abc')` で 0 |
| Q-6 | `+1` の後に `-1` を適用して `display` が `confirmed` と同じになった場合、`beginFlush` の `send` は null（送信しない） |
| Q-7 | `isSettled` は、`inFlight=false`、`dirty=false`、`display===confirmed` のときだけ true |

### Step 8：トースト（判断の残り度：低）

**8-1. `useToast.js`**
- 既定の表示時間を success 2500、info 3000、warning 4000、error 5000 ms にする。同時表示の上限は **3 件** にする（D12）。
- ホバー中やフォーカス中は自動で消えないようにする：`pause(id)` と `resume(id)` を追加する。残り時間を保持し、resume で残り時間だけ再びタイマーをかける。

**8-2. `ToastHost.vue`**
```html
<div class="toast-host">
  <div class="toast-region" role="status" aria-live="polite">
    <TransitionGroup name="toast"> <ToastItem v-for="t in politeToasts" :key="t.id" :toast="t" /> </TransitionGroup>
  </div>
  <div class="toast-region" role="alert" aria-live="assertive">
    <TransitionGroup name="toast"> <ToastItem v-for="t in alertToasts" :key="t.id" :toast="t" /> </TransitionGroup>
  </div>
</div>
```
- `politeToasts` は success と info、`alertToasts` は warning と error。
- 2 つのリージョンは**常に DOM に置いておく**（`v-if` で出し入れしない）。外側の `aria-live` と `aria-atomic`、各トーストの `role` は**付けない**（K2 の解消）。
- トーストの部品（同じファイル内の `<template>` で作ってもよい）は次のとおり。
  - 左に `AppIcon`（success は `check`、info は `info`、warning と error は `alert`）、色は `--ok` / `--accent` / `--warn` / `--ng`
  - 本文は 13px `--text`
  - 右に閉じるボタン（`AppIcon x`、`aria-label="通知を閉じる"`）
  - 背景は `--surface`、枠線 1px `--border`、左端に 3px の種類色の線は**付けない**（枠線だけにする）、角丸 `--radius-lg`、影 `--shadow-lg`、`max-width: 380px`
  - `@mouseenter` と `@focusin` で pause、`@mouseleave` と `@focusout` で resume する。
- 位置：PC は `right: 20px; bottom: 20px`。モバイルは `left: 12px; right: 12px; bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 12px)` で、横幅いっぱいにする。
- アニメーション：表示は `opacity` と `translateY(8px)` から 0 への 160ms、消えるときは 120ms の opacity。reduced-motion のときは 0ms。

**8-3. `client/test/toast.test.js` を更新する**（K8）
- error の既定時間を 5000、上限を 3 件にした内容に合わせる（7 件追加すると 5、6、7 が残る）。
- `pause` と `resume` のテストを追加する（node:test の `mock.timers` を使う）。

### Step 9：その他の画面の追随（判断の残り度：中）

| ファイル | 変更内容 |
|---|---|
| `UsedPartsView.vue` | 見出しの行と検索欄を案A の部品（`.search` スタイル）に合わせる。一覧は `PartRow` の table / stack と同じ見た目の CSS にする（コンポーネントの共有はしない。ステッパーは不要） |
| `LocationGridView.vue` | 保管場所のカードを PartCard と同じ枠線、角丸、ホバーの見た目にする。`backdrop-filter` を削除する（L299） |
| `PartForm.vue` / `BulkEditModal.vue` / `MasterDataManagement.vue` / `DataManagement.vue` / `QrGenerator.vue` / `AiSuggestionReviewModal.vue` | モーダルを共通化する：背景幕 `var(--overlay)`、本体は `--surface`・枠線 1px・角丸 `--radius-xl`・影 `--shadow-lg`、見出し 16px/600、フッターのボタンは右寄せで `btn-secondary` と `btn-primary`。入力欄は高さ 32px（モバイルは 44px）、枠線 `--border`、フォーカス時は `border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft)` |
| `QrScanner.vue` | 色のトークンだけを適用する（L878 の `backdrop-filter` を削除）。レイアウトは変えない |
| `TagInput.vue` / `MiniQrScanner.vue` | Step 2 の置き換えだけ |

### Step 10：仕上げ（判断の残り度：低）
- `style.css` の旧名エイリアスを削除し、全ファイルの旧名の使用を新しい名前に置き換える。対応は Step 1 の 1-3 の表の逆。
- `themeTokens.test.js` に**テスト 4** を追加する：旧名（`--bg-primary`、`--text-primary`、`--accent-color`、`--border-color` など、エイリアスの全名）が `client/src` に出てこないこと。
- `client/public/design-preview.html` を削除する。`vite.config.js` の `globIgnores` からも `**/design-preview.html` を外す。
- `docs/FRONTEND.md` に、トークンの一覧（Step 1 の表）、レイアウトの構成（2 章の図）、`useQuantitySync` の仕組み、トーストの使い方、ショートカットを追記する。
- README の「Design」の記述を案A の説明に更新する。

---

## 4. 受入テスト（Given-When-Then）

実機の構成は、PC（Chrome / Safari / Firefox、1440px と 1024px）、iPhone（Safari とホーム画面に追加した PWA）、Android（Chrome）とする。

### 4-1. テーマ
| ID | シナリオ |
|---|---|
| T-1 | **Given** `epm_theme` が未保存で、OS をダークにしている **When** アプリを開く **Then** 最初の描画から `#0e0f12` の背景で表示され、白く光るフレームがない（Chrome の Performance パネルのスクリーンショットで確認）。サイドバーのテーマ切替は「自動」が選ばれている |
| T-2 | **Given** T-1 の状態 **When** サイドバーで「ライト」を選ぶ **Then** 約 0.15 秒でライトに切り替わり、Android Chrome ではアドレスバーの色が `#fbfbfc` になる **When** ブラウザを閉じて開き直す **Then** 最初の描画からライトで表示される |
| T-3 | **Given** テーマが「自動」 **When** アプリを開いたまま OS の外観をダークからライトに切り替える **Then** 再読み込みしなくても表示が追従する。テーマが「ダーク」に固定されているときは追従しない |
| T-4 | **Given** 2 つのタブで開いている **When** 片方でダークを選ぶ **Then** もう片方もダークになる |
| T-5 | **Given** ライトテーマ **When** 全パーツ（グリッド S/M/L、リスト）、使用済み、保管庫、パーツフォーム、一括編集、マスタ管理、データ管理、QR 印刷、AI 判定候補、QR 入出庫を順に開く **Then** 白地に白文字、背景と同化した枠線、読めないバッジがない。`<select>` の選択肢もライトの配色で表示される |
| T-6 | **Given** OS の「視差効果を減らす」が有効 **When** テーマの切替、トーストの表示、スケルトンの表示が起きる **Then** アニメーションせず即座に切り替わる |

### 4-2. レイアウトとナビゲーション
| ID | シナリオ |
|---|---|
| L-1 | **Given** PC 1440px **When** アプリを開く **Then** 左にサイドバー（240px）、右に上部バー、フィルタバー、カードのグリッドが表示され、サイドバーの件数（全パーツ、使用済み、保管庫、AI 判定候補）が DB の値と一致する |
| L-2 | **Given** サイドバーのカテゴリ「ICs」が 48 件と表示されている **When** それを押す **Then** フィルタバーに「カテゴリ = ICs ×」が出て、一覧の件数表示が「48 件」になる。× を押すと解除され、サイドバーの「すべて」が選択状態になる |
| L-3 | **Given** 保管庫ビューを開いている **When** 保管場所「BOX-03」を選ぶ **Then** 全パーツが「保管場所 = BOX-03」で絞り込まれて表示され、ネットワークタブに `/api/categories`、`/api/locations`、`/api/tags` の再取得が発生しない（`PartsList` が再マウントされていない） |
| L-4 | **Given** 1024px **Then** サイドバーは 200px になり、上部バーのボタンが折り返さずに 1 行に収まっている |
| L-5 | **Given** iPhone（390px）で、ホーム画面に追加した PWA を開いている **Then** サイドバーは表示されず、下部に 5 つのタブがあり、ホームインジケータと重ならない。横スクロールが発生しない。パーツ画面の右下にカメラの FAB があり、一覧の最後の行のステッパーと重ならない（最下部までスクロールして確認） |
| L-6 | **Given** スマホ **When** 「その他」を押す **Then** 下からシートが開き、AI 判定候補（件数付き）、QR 印刷、マスタ管理、データ管理、パーツを追加、テーマの 3 択が表示される。背景を押すか Esc で閉じ、フォーカスが「その他」タブに戻る |
| L-7 | **Given** スマホのパーツ画面 **When** カテゴリのチップを横にスワイプして「抵抗」を押す **Then** 抵抗だけに絞り込まれ、そのチップが選択状態になる |
| L-8 | **Given** PC でパーツ画面を開いている **When** `/` を押す **Then** 検索欄にフォーカスが移る。`n` を押すと新規追加のフォームが開く。⌘K（Windows では Ctrl+K）でも検索欄にフォーカスが移る |
| L-9 | **Given** 検索欄にフォーカスがあり、日本語の入力モードになっている **When** 「なんばー」と入力して変換中に Enter を押す **Then** 新規追加のフォームは開かず、変換が確定するだけになる。パーツフォームの入力欄で `n` を打っても、別のフォームが開かない |
| L-10 | **Given** キーボードだけで操作している **When** Tab を押してサイドバー、上部バー、フィルタバー、カードを順に移動する **Then** フォーカスがある要素にアクセント色の 2px の枠が表示される。マウスでクリックしたときは枠が表示されない |

### 4-3. カードと検索
| ID | シナリオ |
|---|---|
| C-1 | **Given** 型番 `NE555P`、名前「タイマーIC」、カテゴリ ICs、保管場所 BOX-03、QR `QR-0012`、数量 12 の部品がある **Then** カードの 1 行目に `NE555P`（等幅）、2 行目に「タイマーIC」、meta 行にカテゴリの色のドット、「ICs · BOX-03」、右端に `QR-0012` が表示され、写真の右上に「在庫あり」のバッジが出る |
| C-2 | **Given** 型番がない部品がある **Then** 1 行目に名前が表示され、空の行は表示されない |
| C-3 | **Given** 数量 3 の部品と数量 0 の部品がある **Then** それぞれ「残りわずか」（黄）と「在庫切れ」（赤）のバッジが出て、在庫バーの色も同じになる。サイドバーの集計（`lowStock` と `outOfStock`）と件数が一致する |
| C-4 | **When** 検索欄に「555」と入力する **Then** 入力をやめてから約 0.25 秒後に一覧が絞り込まれ、型番の「555」の部分がハイライトされる。1 文字入力するごとに `GET /api/parts` が発生しない（連続入力中はリクエストが 1 回にまとまる） |
| C-5 | **Given** 該当なしになる検索語を入力した **Then** 「条件に一致するパーツはありません」と「絞り込みを解除」のボタンが表示され、押すと全件に戻る |
| C-6 | **Given** 初回表示（キャッシュなし、ネットワークを Slow 3G に絞る） **Then** 「読み込み中...」の文字ではなく、カードと同じ形のスケルトンが 12 個表示され、データが届いたときにレイアウトがずれない。リスト表示では、表の見出しの下にスケルトンの行が表示される（DOM 上で `<tbody>` の中にある） |
| C-7 | **Given** グリッドを M サイズにして、リスト表示に切り替えた **When** 再読み込みする **Then** リスト表示のまま開く。グリッドに戻すと M サイズになっている |

### 4-4. 数量ステッパー（実機のライフサイクル）
| ID | シナリオ |
|---|---|
| Q-A1 | **Given** 数量 10 の部品 **When** `+` を素早く 5 回押す **Then** 表示はすぐに 15 になり、最後に押してから約 0.4 秒後に `PATCH /api/parts/:id {"quantity":15}` が **1 回だけ** 送られる。再読み込みしても 15 |
| Q-A2 | **Given** DevTools で応答を 3 秒遅らせている **When** `+` を押し、0.5 秒後（送信中）にもう 2 回押す **Then** 最初の PATCH（11）が完了した後に、2 回目の PATCH（13）が送られる。PATCH が同時に 2 本走ることはなく、最終的な DB の値は 13 |
| Q-A3 | **Given** 数量 10 **When** `+` を押し、0.4 秒以内にサイドバーの「使用済み」を押す **Then** 画面が切り替わる前後で `PATCH {"quantity":11}` が送られている **When** 「全パーツ」に戻る **Then** 11 と表示されている |
| Q-A4 | **Given** iPhone で数量 10 **When** `+` を押し、すぐにホームに戻る（アプリを切り替える） **Then** 1 分後にアプリに戻ると 11 で、別の端末から見ても 11 になっている |
| Q-A5 | **Given** PC で数量 10 **When** `+` を押してすぐに F5 を押す **Then** ブラウザ標準の「変更が保存されない可能性があります」の確認が出る。「キャンセル」を押すと 0.4 秒後に保存される |
| Q-A6 | **Given** DevTools でオフラインにしている **When** 数量 10 で `+` を 3 回押す **Then** 13 と表示された後、約 0.4 秒で 10 に戻り、エラーのトーストが表示される。スクリーンリーダー（VoiceOver）で、トーストがすぐに読み上げられる |
| Q-A7 | **Given** 数量 0 **Then** `−` は無効で、押しても何も起きない |
| Q-A8 | **When** ステッパーの数字を押し、「25」と入力して Enter を押す **Then** 25 になり、PATCH が 1 回送られる。Esc を押した場合は元の値に戻り、PATCH は送られない |
| Q-A9 | **Given** `+` を押した直後（0.4 秒以内）に、別の部品を保存して一覧の再取得が起きた **Then** 押した部品の数量は、楽観的に増やした値のまま表示され、元の値に一瞬戻ることがない |
| Q-A10 | **Given** QR コード `QR-0012`、型番、説明、タグを持つ部品 **When** 数量のステッパー操作、数量の直接入力、一括編集でのカテゴリ変更を順に行う **Then** QR コード、型番、説明、タグがすべて残っている（#61 から持ち越していた、QR コードが消えるバグの回帰テスト） |

### 4-5. トースト
| ID | シナリオ |
|---|---|
| N-1 | **When** 3 件を選んで一括編集でカテゴリを変える **Then** PC では右下、スマホでは下部タブの上に「一括変更を適用しました」が 2.5 秒表示され、その間も一覧を操作できる。DOM 上では、`role="status"` のリージョンの中に入っている |
| N-2 | **When** 保存の失敗を短い間に 5 回起こす **Then** 表示されるのは最大 3 件で、古いものから消える。エラーは `role="alert"` のリージョンの中に入っている |
| N-3 | **When** トーストにマウスを乗せたまま 6 秒待つ **Then** 消えない。マウスを外すと、残りの時間が経ってから消える |
| N-4 | **When** トーストの × を押す **Then** すぐに消える。× には「通知を閉じる」の読み上げラベルがある |

### 4-6. 回帰と性能
| ID | シナリオ |
|---|---|
| R-1 | **When** `npm test`（ルート）と `cd client && npm run build` を実行する **Then** どちらも成功する。`themeTokens.test.js` のテスト 1〜4 も通る |
| R-2 | **When** `grep -rn "backdrop-filter" client/src` を実行する **Then** 0 件 |
| R-3 | **When** 本番ビルドを `npm run preview` で起動し、モバイル設定の Lighthouse をダークとライトの両方で実行する **Then** Performance と Best Practices が 90 以上、Accessibility が main の値以上 |
| R-4 | **Given** オフラインで PWA を起動した **Then** Geist の欧文と数字は正しい書体で表示される。和文は、一度表示したことのある文字は Noto Sans JP で、初めての文字はシステムの和文フォントで表示され、どちらも文字化けしない |
| R-5 | **Given** 部品 300 件以上の DB **When** グリッド M を最下部までスクロールする（Chrome、CPU 4 倍スロットリング） **Then** カードのホバーで画面がカクつかない（Performance パネルで 50ms を超える長いフレームが、改善前の半分以下） |
| R-6 | **Given** 既存の操作 **When** 一括の削除・復元・ゴミ箱、AI 一括判定、AI 候補の採用、カメラでの追加、QR 入出庫、データのエクスポートとインポートを行う **Then** すべて以前と同じ結果になる |

---

## 5. Step の依存関係と担当

| Step | 依存 | 判断の残り度 | 担当 |
|---|---|---|---|
| 0 | — | 低 | ユーザーの承認後に Coder |
| 1 | 0 | 低 | Coder（Flash） |
| 2 | 1 | 低 | Coder（Flash） |
| 3 | 0（1, 2 と並行してよい） | 低 | Coder（Flash） |
| 4 | 1 | 低 | Coder（Flash） |
| 5 | 3, 4 | 中 | Coder（Flash） |
| 6 | 5 | 中 | Coder（Flash） |
| 7 | 6 | **高** | Coder（Flash）。2 回失敗したら Claude（opus） |
| 8 | 4 | 低 | Coder（Flash）。5〜7 と並行してよい |
| 9 | 2, 6 | 中 | Coder（Flash） |
| 10 | 1〜9 | 低 | Coder（Flash） |
| レビュー | 10 | — | Claude（opus）。観点：K1〜K8 の解消、Step 7 の競合とアンマウント時の送信、PATCH 化で消える項目、IME とショートカット、トークンの漏れ、セーフエリア |
| 受入 | レビュー | — | ユーザー（4 章のシナリオ）。AWS へのデプロイと PR は `strict-pr-rules` に従う |

Step ごとにコミットし、メッセージは `feat(ui): Step N <概要> (#57 #58)` とする。

---

## 6. 範囲外（別 Issue にする）
- 部品ごとの最小在庫数（`min_quantity` 列）
- ⌘K のコマンドパレット本体
- モーダル内の絵文字アイコンの SVG 化
- `confirm()` を独自の確認ダイアログに置き換えること
- 一覧の仮想スクロール（#58 P10）とサムネイル画像の生成（#58 P5）
- ドラッグ＆ドロップ（ブランチ名の `dnd`）

## 7. 未決事項
1. **Step 0 のコミット**：ステージ済みの内容を、チェックポイントとしてコミットしてよいですか。
2. **カード上の名前・タグのクリック編集をやめること**（6-3）：案A のカードを整理するため、名前とタグの編集は PartForm に集約します。今の操作を残したい場合は言ってください。
3. **モバイルでは常にリスト表示にすること**（6-1）：390px の幅では、案A のプレビューと同じ行の表示にします。スマホでもグリッドを選べるようにしたい場合は言ってください。
