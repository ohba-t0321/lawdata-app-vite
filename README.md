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

## 外部 Storage の利用

`ref_json` はローカルの `public/ref_json` を正本として参照し、必要に応じて外部 Storage / CDN をフォールバック先として使えます。
`VITE_REFDATA_BASE_URL` を設定していても、アプリはまずローカルの `public/ref_json` を見に行き、見つからない場合のみ外部 URL を参照します。

```bash
VITE_REFDATA_BASE_URL=https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/law-assets/ref_json
```

Storage-only の移行方針と、Supabase Database 系コードの整理方針は
[docs/ref-json-storage-only-plan.md](/home/ohbat/Documents/VSCode/app/lawdata-app-vite/docs/ref-json-storage-only-plan.md)
にまとめています。

## 会員向けAIチャットの設定

AIチャットは既存の法令閲覧とは独立しており、Supabase Auth にログインしたユーザーだけが使えます。

必要なフロント環境変数:

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_REFDATA_BASE_URL=https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/law-assets/ref_json
VITE_LAW_AGENT_ENABLED=true
```

Supabase 側では以下を別途設定してください。

- `scripts/supabase/migrations/202603260001_add_ai_chat_auth_tables.sql` を適用
- `supabase/functions/law-chat-answer` と `supabase/functions/law-agent-answer` をデプロイ
- Edge Function secrets に `OPENAI_API_KEY` と `OPENAI_MODEL` を設定
- Auth の redirect URL に配信先サブパス `/lawdata-app-vite/` を含む URL を登録

回答生成時は Edge Function が質問から最大3件の主題キーワードを抽出し、e-Gov 法令API v2 の
`/keyword` を検索します。検索で得た条文と、画面に表示中の条文・参照条文をまとめてモデルへ渡すため、
画面外の関連法令も根拠に含められます。検索件数と本文長には上限を設け、プロンプトサイズと応答時間を抑えています。

### 法令巡回エージェント

`VITE_LAW_AGENT_ENABLED=true` の場合は、表示中の条文またはe-Govキーワード検索を起点に、
Supabaseの `law_references` を参照先・被参照元の両方向へ最大2段巡回します。
最終回答で引用する条文はe-Gov法令APIから現行本文を再取得し、調査進捗、採用した経路、
取得失敗や調査上限を `agent_runs` / `agent_run_steps` に保存します。

導入手順:

1. `npm run supabase:migrate -- --migration scripts/supabase/migrations/202608060001_add_law_agent_tables.sql` でDB変更を適用
2. `npm run supabase:sync-ref-json` で参照グラフを同期
3. `law-agent-answer` をデプロイし、`OPENAI_API_KEY`、`OPENAI_MODEL`、必要なら `LAW_AGENT_MAX_RUNS_PER_10_MIN` を設定

機能を一時的に無効化すると、既存の一括回答方式へ戻ります。

### SMTP 未設定時の暫定ログイン運用

SMTP をまだ用意していない間は、管理者が Supabase の `service_role` で認証リンクを生成し、Slack や Teams など別経路で本人に共有できます。

必要な環境変数:

```bash
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
```

実行例:

```bash
set -a
source .env
set +a

npm run supabase:generate-auth-link -- --email member@example.com --redirect-to http://localhost:5173/lawdata-app-vite/
```

- 既存ユーザー向けログインリンクは `--type magiclink` を使います
- 新規招待リンクを手動配布したい場合は `--type invite` を使います
- 返ってきた URL を本人へ手動共有してください
- `SUPABASE_SERVICE_ROLE_KEY` はブラウザやクライアントコードへ出さないでください

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
