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
