# cloudflare-maintenance-worker

[English](README.md)

重い migration や DB 作業のあいだ、利用者からのアクセスに `503` とメンテナンスページを返す Cloudflare Worker と、メンテナンスの開始と終了を切り替えるスクリプトです。

Worker は普段リクエストを受けません。対象ホストの Workers Route をこの Worker に付けるとメンテナンスに入り、外すと抜けます。付け外しは `maintenance-worker on` と `off` が Cloudflare API で行います。`wrangler.jsonc` にルートを書かないのは、書くと `wrangler deploy` のたびにルートが付き、デプロイしただけでサイトが止まるためです。デプロイとメンテナンスの開始は、意図して別の操作にしています。

## 振る舞い

- 通常のリクエストには、メンテナンスページを `503` で返します。`Retry-After`（既定は 3600 秒）と `Cache-Control: no-store` を付け、Cloudflare にもブラウザにもページを残させません。
- API クライアントへの JSON のエラーや、Inertia.js の画面遷移への `409` のように、リクエストによって応答を変えたいときは、関数を差し込めます。「[独自の応答](#独自の応答)」を読んでください。
- 作業者は、合言葉か許可 IP で通れます。任意の URL に `?maintenance_bypass=<合言葉>` を付けて開くと、パラメーターを外した同じ URL へリダイレクトし、12 時間有効の Cookie を発行します。リダイレクトするのは、合言葉がアドレスバーに残らないようにするためです。

パラメーター名の `maintenance_bypass` は秘密ではありません。名前を知られても、合言葉が無ければ誰も通れません。合言葉は定数時間で比べ、Cookie には合言葉から導いたハッシュだけを入れ、合言葉そのものは入れません。Cookie の値は合言葉から導いていて、サーバー側に有効期限の一覧を持たないので、合言葉を変えればそれまでに発行した Cookie はすべて無効になります。合言葉が未設定なら、合言葉でも Cookie でも誰も通しません（fail-closed）。

同じルートのパターンを別の Worker がすでに持っていると、`on` は何も変更せずに止まります。対象ホストに別の Worker のもっと狭いルート（たとえば `app.example.com/api/*`）があると、そのパスはメンテナンス中も止まらないので、`on` と `status` が警告を出します。

呼び出しログは `wrangler.jsonc` で切っています。リクエスト URL を残すので、作業者が合言葉を使うと平文で入ってしまうためです。有効に戻さないでください。

## セットアップ

おすすめの持ち方は、自分のリポジトリには設定だけを置き、コードは依存として取り込む形です。Node 22 以降と pnpm が要ります。npm でも動きますが、npm は `--dry-run` などのオプションを自分で受け取ってしまうので、environment 名の前に `--` を入れます（`npm run deploy -- develop --dry-run`）。

ディレクトリを作り、次の 4 つのファイルを置きます。

`package.json`:

```json
{
  "name": "my-maintenance",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev --env develop",
    "deploy": "maintenance-worker deploy",
    "on": "maintenance-worker on",
    "off": "maintenance-worker off",
    "status": "maintenance-worker status"
  },
  "devDependencies": {
    "cloudflare-maintenance-worker": "github:second-fiddle-jp/cloudflare-maintenance-worker#v0.1.0",
    "wrangler": "4.123.0"
  }
}
```

`src/index.js` は Worker を再エクスポートするだけです（一部のリクエストに独自の応答を返すときは「[独自の応答](#独自の応答)」）。

```js
export { default } from 'cloudflare-maintenance-worker'
```

`wrangler.jsonc` と `maintenance.config.json` は、このリポジトリの直下にあるサンプルをコピーし、名前とホストを書き換えます。中身は「[設定](#設定)」で説明します。

インストールして、wrangler にログインします。

```bash
pnpm install
pnpm exec wrangler login
```

wrangler は自分の `devDependencies` でバージョンを固定してください。スクリプトはインストールされた wrangler を使います。

このリポジトリを clone して、サンプルをそのまま書き換えて使うこともできます。clone した側の `package.json` にも同じスクリプトがあるので、以下のコマンドはどちらでも同じです。

## 設定

サイト固有の値は、`wrangler.jsonc` の vars と `maintenance.config.json` の 2 か所に置きます。コードにはサイト固有の値がありません。

### Worker の vars と secret

vars は `wrangler.jsonc` の `env.<environment>.vars` に書きます。wrangler は top-level の `vars` を environment に継承しないので、同じ値でも environment ごとに全部書きます。値は文字列で書きます。数値や真偽値で書いても文字列として扱うので、`"RETRY_AFTER": 120` も `"120"` と同じく有効です。

| 名前 | 意味 | 未設定のとき |
|---|---|---|
| `RETRY_AFTER` | `Retry-After` に入れる秒数 | `3600` |
| `BYPASS_COOKIE` | バイパス Cookie の名前。Cookie の Domain を共有する environment どうしでは別の名前にする | `maintenance_bypass` |
| `COOKIE_DOMAIN` | バイパス Cookie の `Domain`。`.example.com` のように書くと、1 つの Cookie がサブドメインをまたいで効く | `Domain` を付けず、合言葉を開いたホストだけで効く |
| `BRAND` | ページに出すブランド名。タイトルの末尾にも ` \| <BRAND>` として付く | ブランドを出さない |
| `PAGE_LANG` | ページの `lang` 属性 | `en` |
| `PAGE_TITLE` | ページのタイトル | `Under maintenance` |
| `PAGE_HEADING` | ページの見出し | `We are currently down for maintenance` |
| `PAGE_MESSAGE` | 見出しの下の本文。改行は `<br>` になる | お詫びと、時間をおいてアクセスし直すよう促す 2 行の英文 |
| `BYPASS_SECRET`（secret） | 合言葉 | 合言葉でも Cookie でも通さない |
| `ALLOW_IPS`（secret） | メンテナンス中も通す IP（カンマ区切り） | IP では通さない |

既定の文言は英語です。日本語のページにするなら、`PAGE_LANG` を `ja` にし、`PAGE_TITLE`・`PAGE_HEADING`・`PAGE_MESSAGE` を environment ごとに書いてください。ページに差し込む値は HTML エスケープするので、vars に `<` を書いてもタグにはなりません。文言より大きく見た目を変えたいときは、clone して `src/page.js` の HTML と CSS を編集します。HTML を別ファイルにしていないのは、`.html` を Worker のモジュールとして読み込むと `node --test` から import できなくなるためです。

### 独自の応答

メンテナンス中の応答をリクエストによって変えたいときは、`src/index.js` で `createWorker` に関数を渡します。関数は `(request, env, { headers })` を受け取ります。`Response` を返すとそれが応答になり、`undefined` を返すと次の関数へ、最後はメンテナンスページへ進みます。関数は配列の順に呼びます。`headers` には、メンテナンスページと同じ `Cache-Control` と `Retry-After` が入っています。Cookie や許可 IP で通る作業者のリクエストは、関数に届きません。

次の例は、Inertia.js の画面遷移にページ全体を読み込み直させるものと、API のホストに JSON-RPC のエラーを返すものです。

```js
import { createWorker } from 'cloudflare-maintenance-worker'

// Inertia の XHR に 503 の HTML を返すとモーダルの中にページが出るので、409 でページ全体を読み込み直させる
const inertia = (request) =>
  request.headers.has('X-Inertia')
    ? new Response(null, { status: 409, headers: { 'X-Inertia-Location': request.url, 'Cache-Control': 'no-store' } })
    : undefined

// ページを読めない API クライアントには、JSON-RPC のエラーを返す
const jsonRpc = (request, env, { headers }) =>
  new URL(request.url).hostname === 'api.example.com'
    ? Response.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Service under maintenance' }, id: null }, { status: 503, headers })
    : undefined

export default createWorker({ respond: [inertia, jsonRpc] })
```

### maintenance.config.json

ルートを付け外しするスクリプトが読む設定で、ゾーンと、environment ごとに付けるルートのパターンを書きます。

```json
{
  "zone": "example.com",
  "environments": {
    "develop": { "patterns": ["dev.example.com/*"] },
    "production": { "patterns": ["example.com/*", "www.example.com/*"] }
  }
}
```

パターンは上から順に付けます。`*.example.com/*` のようなワイルドカードにせず、ホストごとに書いてください。ワイルドカードにすると、公開ストレージのバケットのように止めるつもりの無いホストまで止まります。

environment の名前は、`wrangler.jsonc` の `env` と同じ組にそろえます。各 environment の Worker 名は `wrangler.jsonc` の `name` に environment 名を付けた `<name>-<env>`（env で `name` を上書きしていればその名前）で、スクリプトも同じ規則で導きます。`maintenance.config.json` にだけある environment や、`patterns` が無い environment は、その environment を操作しようとしたときだけ理由を示して止まります。`wrangler.jsonc` にだけある environment は警告を出すだけです。メンテナンスの最中に無関係な environment の設定を誤っても、`off` と `status` を使えるようにするためです。

スクリプトは `wrangler.jsonc` を wrangler を使わずに読みます。行コメント、ブロックコメント、末尾カンマのどれも書けます。

## デプロイと secret の登録

Worker のデプロイは、`deploy` スクリプトに environment 名を付けて行います。素の `wrangler deploy` は top-level の `name` で vars を持たない Worker を作ってしまうので、`deploy` は environment 名が無いときや空のときは止まります。`pnpm deploy` は pnpm の組み込みコマンドなので、必ず `pnpm run deploy` と書きます。`--dry-run` など `wrangler deploy` のオプションは、environment 名のあとに続けます（`pnpm run deploy develop --dry-run`。npm なら `npm run deploy -- develop --dry-run`）。

```bash
pnpm run deploy develop
pnpm run deploy production
```

デプロイしてもルートは付かないので、サイトは通常どおり動き続けます。

合言葉と許可 IP は、最初のデプロイのあとに Worker の secret として登録します。Worker が無い状態だと、`wrangler secret put` は Worker を作ってよいかを対話で尋ねてきます。

```bash
pnpm exec wrangler secret put BYPASS_SECRET --env production
pnpm exec wrangler secret put ALLOW_IPS --env production
```

合言葉は environment ごとに別の値にし、`openssl rand -hex 32` で作ります。16 進数だけなので URL エンコードが要りません。メンテナンスのたびに合言葉を変えてください。前回配った Cookie は、そうすることで無効になります。

## ルートを付け外しする API トークン

ルートの付け外しは Cloudflare API を直接呼ぶので、専用の API トークンを作ります。権限は Zone → Workers Routes: Edit と Zone → Zone: Read の 2 つで、対象は自分のゾーンだけにします。トークンは `CLOUDFLARE_API_TOKEN` 環境変数で渡します。コマンドラインに直接書くとシェルの履歴に残るので、次のように読み込みます。

```bash
read -s CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN
```

wrangler も `CLOUDFLARE_API_TOKEN` があればそれを使い、`wrangler login` のログインより優先します。このトークンには Account の権限が無いので、export したまま `deploy` や `wrangler secret put` を実行すると「Failed to automatically retrieve account IDs」で止まります。wrangler のコマンドは、環境変数を外して実行してください。

```bash
env -u CLOUDFLARE_API_TOKEN pnpm run deploy production
```

## メンテナンスに入る・抜ける

まず、その environment に Worker がデプロイ済みであること、今回の合言葉に差し替えたこと、いまが通常稼働であることを確かめます。`status` が「メンテナンスのルートは無い」と返せば通常稼働です。

```bash
pnpm run status production
```

メンテナンスに入ります。ここから利用者には `503` が返ります。

```bash
pnpm run on production
```

別の Worker が同じパターンを持っていれば、`on` は何も変更せずに止まります。途中で失敗したときは、ルートを数え直して、1 本も付いていないのか、一部だけ付いたのか、全部付いたのかを伝えます。一部だけ付いたときは `status` で確かめ、必要なら `off` を実行してください。Worker がまだデプロイされていなければ、ルートは 1 本も付かず、先にデプロイするよう案内が出ます。

作業者は `https://<ホスト>/?maintenance_bypass=<合言葉>` を開いて Cookie を受け取るか、`ALLOW_IPS` に登録した IP から作業します。IPv6 はアドレスが変わりやすいので、IPv4 で登録するか Cookie を使うほうが確実です。

Worker が止めるのは外からの HTTP だけです。サーバー内のキューワーカー、cron、スケジューラーは動き続けるので、作業に応じて自分で止めてください。

作業が終わったら、メンテナンスを抜けて確かめます。

```bash
pnpm run off production
pnpm run status production
```

`status` が再び「メンテナンスのルートは無い」と返すことを確かめ、Cookie を持たないブラウザ（シークレットウィンドウなど）でも開けることを確認します。

Webhook の送信元や外形監視にも、メンテナンス中は `503` が返ります。多くの送信元は再送しますが、メンテナンスが長くなるときは再送の上限を確かめておいてください。

## ローカルで確かめる

`wrangler.jsonc` と同じディレクトリの `.dev.vars` に secret を書き、Worker を起動します。

```
BYPASS_SECRET=<合言葉>
ALLOW_IPS=<許可する IP>
```

```bash
pnpm run dev
curl -i http://localhost:8787/
```

`dev` は `develop` environment の vars で動きます。独自の応答を確かめるときは、`-H 'X-Inertia: true'` や `Host` ヘッダーを付けるなど、その条件に合うリクエストを送ります。

## テスト

```bash
node --test
```

テストは Node の標準 API だけを使うので、インストールは要りません。

## ライセンス

[MIT](LICENSE)
