# 開票地圖（總部用）

資料直接讀黨部的 Google 試算表，不需要人工輸入。

```
黨部的 Google 試算表（只讀）
        │  Netlify 中繼站每幾秒讀一次（/api/data）
        ▼
總部的開票看板（https://你的網站.netlify.app/）

GitHub ──push──▶ Netlify 自動部署（只有改程式、地圖時才需要）
```

## 檔案

| 路徑 | 用途 |
|---|---|
| `site/index.html` | 開票看板 |
| `site/mapview.js` | 地圖元件（拖拉、縮放、上色、自動飛過去） |
| `site/map/villages.json` | 澎湖縣村里邊界（TopoJSON） |
| `netlify/functions/data.mjs` | 中繼站：讀黨部的表、整理成看板要的資料。要顯示的選舉、標題、候選人顏色在檔案最上面的 `CONFIG` |

## 黨部的表需要符合

- 第 1 列有「區域」「編號」「村里」，以及選舉名稱（例如「縣長」）
- 第 2 列是號次、第 3 列是候選人姓名，放在選舉名稱底下
- 第 4 列起一列一所投開票所；**某一所的候選人欄位全部填好才算開出**（填到一半會顯示「填寫中」）
- 分享設定是「知道連結的人都能檢視」

開票所清單、編號、村里、候選人姓名都是開票當下從黨部的表讀的，黨部改了，看板就跟著改。

## 部署

1. **GitHub**：把這個資料夾推到一個 repo。裡面沒有黨部表的連結，公開也不會外流；建議還是設成私人。
2. **Netlify**：Add new site → Import from Git → 選這個 repo（設定會自動讀 `netlify.toml`）。
3. **環境變數**（Site configuration → Environment variables）：
   - `PARTY_SHEET_ID`：黨部表網址 `https://docs.google.com/spreadsheets/d/這一串/edit` 中間那一串
   - `PARTY_SHEET_GID`（選填）：如果票數不在第一個分頁，填網址 `#gid=` 後面的數字
4. **重新部署**一次（Deploys → Trigger deploy）。
5. **檢查**：打開 `https://你的網站/api/data`，看到 `{"ok":true,...}` 和一長串開票所就成功了。
   看到 `{"ok":false,"error":"..."}` 的話，照錯誤訊息處理（通常是分享設定或 ID 貼錯）。

## 開票當天

- 總部電腦打開 `https://你的網站/`，看板每 10 秒更新。
- 新開出的開票所，畫面會自動飛過去並顯示票數；有人在操作地圖時不會搶畫面。可用「🎯 自動跟隨」開關。
- 看板網址不需要分享出去。
