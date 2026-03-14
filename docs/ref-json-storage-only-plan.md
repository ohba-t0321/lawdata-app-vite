# ref_json Storage-Only移行案

## 目的

- `public/ref_json` をリポジトリ本体から切り離して構成を軽くする
- 現在の `RefData[]` 互換を維持し、UI 側の変更を最小にする
- Supabase Database を使わず、Storage だけで配信する
- Supabase Free plan の制限（DB 500MB / Storage 1GB）の範囲で運用する

## 結論

第一段階では `ref_json` だけを外部 Storage に移し、アプリは URL だけ差し替える。
DB に正規化して API を作るより、現在の取得単位と整合していて移行コストが低い。

`ref_json` は現在すでに「表示中法令をキーにした参照注記データ」という完成した配信単位になっている。
このため、Storage/CDN 配信との相性がよい。

## 推奨構成

### 配信先

- バケット名: `law-assets`
- 公開プレフィックス: `ref_json/`
- 公開 URL 例: `https://<project-ref>.supabase.co/storage/v1/object/public/law-assets/ref_json`

### 保存対象

- `ref_json/<lawNum>.json`
- `ref_json/_meta.json`

### アプリ側

- `VITE_REFDATA_BASE_URL` が設定されていれば外部 Storage を参照
- 未設定なら従来どおり `public/ref_json` を参照

この方式なら開発時はローカル、公開時は Storage と使い分けできる。

## この案がよい理由

### 1. 取得単位が現行 UI と一致する

現在の UI は「表示中の法令番号」をキーに `ref_json/<lawId>.json` を取得している。
Storage に移してもこの単位をそのまま維持できる。

### 2. `ref` / `referred` の意味を崩さない

既存 JSON は `ref=参照元`, `referred=参照先(表示中法令側)` で UI と整合している。
DB 化の途中で列名の向きが逆転すると、保守時の事故が起きやすい。

### 3. 容量制約に収まりやすい

現状の `public/ref_json` は約 282MB / 4423 ファイルで、Storage 1GB の範囲に収まる。
まずはここだけ移して様子を見るのが安全。

## 実装方針

### フェーズ1: ref_json のみ外部化

やること:

- `public/ref_json` を Storage にアップロードする
- `VITE_REFDATA_BASE_URL` を本番環境に設定する
- フロントは外部 URL から `RefData[]` を取得する
- `_meta.json` は運用監視用として残す

やらないこと:

- Supabase Database への投入
- `RefData` のスキーマ変更
- UI の描画ロジック変更

### フェーズ2: 事前軽量化アセットを追加

法令 API の取得後にフロントで重くなっている処理は、Storage に軽量アセットを置くことでかなり減らせる。
ただし 1GB 制限があるので、重いものから順に全部置くのではなく、費用対効果で選ぶ。

優先度順:

1. `law_list.min.json`
2. `law_meta/<lawNum>.json`
3. 必要なら人気法令だけ `vnode`

## 事前軽量化の候補

### A. 法令一覧の軽量スナップショット

現状はブラウザが e-Gov API から法令一覧全件を取得している。
これをビルド時または定期バッチで `law_list.min.json` にして Storage に置く。

含める項目:

- `law_num`
- `law_id`
- `law_type`
- `law_title`
- `abbrev`
- `updated`
- `revision_marker`

効果:

- 初回ロード時の通信量削減
- ブラウザ側の JSON パース負荷削減
- 日次キャッシュ更新判定の単純化

### B. `law_meta/<lawNum>.json`

現在フロントで都度計算している軽量派生データを事前生成する。

入れる候補:

- `tocItems`
- `refLawTitle`
- `articleMap`

#### `tocItems`

`buildTocItems` を事前計算しておけば、条文表示開始時の準備が少し軽くなる。

#### `refLawTitle`

現在 `getRefLaw` で法令本文全体を走査し、別名・略称・同法/同令を計算している。
これは本文全走査なので、事前計算の効果が高い。

#### `articleMap`

現在参照先条文表示では、法令本文 JSON から都度 Article を再探索している。
`provision + article` で引ける索引を事前生成すれば、参照表示の待ち時間を減らせる。

### C. `vnode` の事前生成は原則見送り

`vnode` まで全法令分を置くと容量が読みにくく、1GB 制限を圧迫しやすい。
また React 表示都合に近い構造なので、保存フォーマットとして固定しすぎない方がよい。

方針:

- 全法令分は保存しない
- 必要なら人気法令だけウォーム対象にする
- 先に `law_list.min.json` と `law_meta` でどこまで軽くなるかを見る

## Supabase Database 系コードの扱い

現時点では一旦撤去対象にするのが妥当。

理由:

- `ref_json` の現行仕様をそのまま活かすなら DB 正規化の利益が小さい
- `ref` / `referred` と DB 列名の向きがずれると保守負債になる
- Free plan の DB 500MB を参照系キャッシュで消費したくない

撤去対象:

- `scripts/supabase/`
- `package.json` の `supabase:*` scripts
- `@supabase/supabase-js` と `pg` の DB 用依存
- README の DB ingest 手順
- `.env.example` の DB 用環境変数

撤去の順番:

1. Storage upload 手順を先に用意
2. README を Storage 前提に更新
3. 参照されていない DB ingest を削除
4. package scripts / 依存を整理

## 運用案

### 更新フロー

1. `scripts/ref_json/build_ref_json.py` で最新 `ref_json` を生成
2. 差分ファイルだけ Storage にアップロード
3. `_meta.json` を最後に更新
4. フロントは `VITE_REFDATA_BASE_URL` 配下を読む

### キャッシュ

- Storage 側は長めの `Cache-Control`
- `_meta.json` は短め
- 法令ファイルは immutable に近い扱い

`revision_marker` が変わる前提なので、本来は将来的に `path?rev=<marker>` か `prefix/<revision>/<law>.json` の形に寄せたい。
ただし第一段階では現状ファイル名のままでよい。

## 直近でやるべきこと

1. `VITE_REFDATA_BASE_URL` 対応を入れる
2. README を Storage 前提に書き換える
3. Storage upload 手順を追加する
4. `law_list.min.json` の生成案を固める
5. Supabase Database 系コードの削除に着手する
