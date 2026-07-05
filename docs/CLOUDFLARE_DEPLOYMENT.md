# Cloudflare Worker + D1 部署

## 首次部署

```powershell
npx wrangler login
npx wrangler deploy
npx wrangler d1 migrations apply tower-defense --remote
```

Wrangler 會依 `wrangler.jsonc` 佈建 `tower-defense` D1 binding。部署後把實際的 D1 `database_id` 寫回 `wrangler.jsonc`，讓 CI 與本機環境固定使用同一個資料庫。

接著將 `wrangler.jsonc` 的 `FIREBASE_PROJECT_ID` 改成 Firebase Project ID，再次部署。這個值不是私密金鑰，但必須與 Firebase ID Token 的 audience/issuer 完全相符。

## GitHub Actions

設定 Repo Secrets：

- `CLOUDFLARE_API_TOKEN`：至少需要 Workers Scripts Edit、D1 Edit。
- `CLOUDFLARE_ACCOUNT_ID`

並確認 Repo Variable `FIREBASE_PROJECT_ID` 已設定；同一個值會供前端建置與 Worker token 驗證使用。

完成首次 D1 佈建並提交真正的 `database_id` 後，可手動執行 `Deploy Cloudflare Worker` workflow。Workflow 會先檢查型別與測試，再部署並套用遠端 migrations。

## API

- `GET /health`：健康檢查
- `GET /v1/save`：讀取自己的存檔，需 Firebase Bearer token
- `PUT /v1/save`：條件式寫入存檔，需 token 與 revision
- `POST /v1/run/start`：建立一次性排行榜場次
- `POST /v1/run-result`：提交並消耗一次性場次，需 token
- `GET /v1/leaderboard`：目前賽季前 100 名

允許來源由 `ALLOWED_ORIGINS` 控制。正式切換自訂網域時，必須同步更新此設定。
