# Google 登入與雲端存檔設定

目前遊戲已整合 Firebase Authentication 與 Cloud Firestore。未提供 Firebase 設定時會自動退回本機 `localStorage`，不影響遊玩。

## Firebase Console

1. 建立 Firebase 專案並註冊 Web App。
2. Authentication → Sign-in method → 啟用 Google。
3. Authentication → Settings → Authorized domains 加入 `awsjin510.github.io`。
4. 建立 Cloud Firestore database。
5. 將專案根目錄的 `firestore.rules` 發布為 Firestore Security Rules。

## GitHub Pages

到 GitHub Repo → Settings → Secrets and variables → Actions → Variables，建立：

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`

值取自 Firebase Console → Project settings → Your apps → SDK setup and configuration。

重新執行 GitHub Pages workflow 後，登入按鈕就會出現。

## 同步規則

- 未登入：只使用本機存檔。
- 第一次登入且雲端無存檔：上傳本機存檔。
- 本機與雲端都有存檔：使用 `updatedAt` 較新的版本。
- 購買永久升級或戰鬥結算：先寫本機，再寫雲端。
- 雲端失敗：遊戲繼續運作，保留本機進度並顯示警告。

本功能只要求基本 Google 身分資訊，不會要求或讀取 Gmail 信件權限。
