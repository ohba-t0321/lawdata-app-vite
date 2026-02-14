# 法令検索アプリ（lawdata-app-vite）

e-Gov 法令 API を利用して、法令一覧の検索・条文表示・参照先条文の確認をブラウザ上で行える React + Vite アプリです。

## 主な機能

- **法令名検索**
  - 「含む / で始まる / 完全一致」の条件で法令タイトルを検索
  - 検索キーワードを URL クエリ（`?keyword=`）に同期
- **2ペイン表示**
  - 左右のフレームに法令本文を表示
  - 右ペインの表示時は分割バーを移動して比較しやすく表示
- **条文ジャンプ**
  - 算用数字または「第○条の○」形式の入力で該当条文へスクロール
- **参照条文の追跡**
  - 条文中の参照リンクから関連条文を取得・表示
- **表示設定**
  - フレーム単位のクリア
  - カッコ書き（注記）表示の切替
- **パフォーマンス配慮**
  - Web Worker で法令一覧・法令本文・参照データ取得を分離
  - IndexedDB に法令一覧を日次キャッシュ

## 技術スタック

- React 19
- TypeScript
- Vite 7
- React Router
- TanStack Table
- Web Worker
- IndexedDB

## セットアップ

```bash
npm install
```

## 開発

```bash
npm run dev
```

デフォルトでは Vite の開発サーバーが起動します（通常 `http://localhost:5173`）。

## ビルド

```bash
npm run build
```

## プレビュー

```bash
npm run preview
```

## Lint

```bash
npm run lint
```

## Supabase ingest (upsert)

This project includes a batch script to precompute law payloads and upsert them into Supabase.

1. Apply migration in Supabase:

```bash
node scripts/supabase/apply-migration.mjs
```

2. Set environment variables (PowerShell example):

```powershell
$env:SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
$env:SUPABASE_ASSET_BUCKET="law-assets" # optional
$env:LAWDATA_REF_DIR="public/ref_json"   # optional
```

3. Install dependencies (if needed):

```bash
npm install
```

4. Dry run:

```bash
node scripts/supabase/upsert-law-data.mjs --dry-run --limit 5
```

5. Execute diff-only upsert:

```bash
node scripts/supabase/upsert-law-data.mjs
```

6. Force full rebuild:

```bash
node scripts/supabase/upsert-law-data.mjs --all
```

7. Execute only specific law numbers:

```bash
node scripts/supabase/upsert-law-data.mjs --law-num "令和七年政令第三号,令和七年法律第七十五号"
```

What the script does:

- Upserts `public.laws` from e-Gov law list.
- Detects changed laws by `revision_marker` (unless `--all`).
- Fetches each changed law body (`/law_data/:lawNum`).
- Precomputes and uploads JSON assets to Storage:
  - `raw.json`
  - `toc.json`
  - `vnode.json`
  - `article-map.json`
  - `ref-data.json`
  - `ref-law-title.json`
- Upserts `public.law_versions` and `public.law_assets`.
- Refreshes `public.law_references` for each changed law.
- Records run status in `public.ingest_runs`.

## データ取得元

本アプリは以下の e-Gov 法令 API を利用しています。

- 法令一覧: `https://laws.e-gov.go.jp/api/2/laws`
- 法令本文: `https://laws.e-gov.go.jp/api/2/law_data/:lawId`

> API の仕様変更やネットワーク状況により、取得結果が変わる場合があります。

## ディレクトリ概要

```text
src/
  Header/            ヘッダー UI
  Sidebar/           検索・ジャンプ・表示設定 UI
  LawDataOutput/     法令本文・参照表示 UI
  hooks/             Worker 呼び出しフック
  workers/           API 取得処理（Web Worker）
  indexedDB.ts       キャッシュ管理
```

## 注意事項

- 初回読み込み時は法令一覧の取得に時間がかかる場合があります。
- データ取得エラー時でも UI が止まらないように設計されていますが、再読み込みで復旧するケースがあります。
