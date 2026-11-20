// 讀取中繼站：看板 → /api/data → 黨部的 Google 試算表（只讀）
//
// 黨部的表格式（第一個分頁）：
//   第 1 列：區域 | 票所 | 編號 | 監票員 | 村里 | 項目 | 縣長 | (空) ... | 馬公市長 | ...
//   第 2 列：各候選人號次
//   第 3 列：各候選人姓名
//   第 4 列起：一列一所投開票所，候選人欄位填票數
//
// Netlify 環境變數：
//   PARTY_SHEET_ID   黨部試算表網址中 /d/ 和 /edit 之間那一串（必填，不寫在程式裡以免連結外流）
//   PARTY_SHEET_GID  分頁代號，網址 #gid= 後面的數字（選填，預設第一個分頁 0）
//   PARTY_CSV_URL    （選填）直接指定 CSV 網址，測試用
//
// Netlify 的 CDN 會把結果快取幾秒，總部幾台電腦同時看也只會讀黨部的表一次。

const CONFIG = {
  race: '縣長',                       // 要顯示的選舉，對應黨部表第 1 列的標題
  title: '2026 澎湖縣長開票',
  subtitle: '資料來源：黨部開票表',
  county: '澎湖縣',
  towns: [],                          // 空＝全縣
  refresh: 10,                        // 看板幾秒更新一次
  electors: 92310,                    // 選舉人數（用來算投票率）；不知道就設成 0
  partyByNo: { '3': '無黨籍', '4': '民進黨', '5': '國民黨' },
  featured: '4',                      // 放大顯示、排第一的候選人號次（吳淑瑾）；不需要就設成 ''
  cacheSeconds: 5,                    // 中繼站快取秒數
  // 依號次指定顏色；姓名從黨部的表第 3 列讀
  colorsByNo: {
    '1': '#8a9097',   // 許智富　灰
    '2': '#8a9097',   // 周倪安　灰
    '3': '#7e3fc4',   // 葉竹林　紫
    '4': '#1f9d55',   // 吳淑瑾　綠
    '5': '#1f5fd1',   // 陳振中　藍
    '6': '#8a9097',   // 陳盡川　灰
  },
  colors: ['#8a9097', '#8a9097', '#7e3fc4', '#1f9d55', '#1f5fd1', '#8a9097', '#7a6a58', '#b58900'],   // 沒有指定號次時依序使用
};

export default async () => {
  const url = process.env.PARTY_CSV_URL ||
    (process.env.PARTY_SHEET_ID
      ? `https://docs.google.com/spreadsheets/d/${process.env.PARTY_SHEET_ID}/export?format=csv&gid=${process.env.PARTY_SHEET_GID || '0'}`
      : null);
  if (!url) return fail(500, '尚未在 Netlify 設定 PARTY_SHEET_ID 環境變數');

  let text;
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'cache-control': 'no-cache' } });
    text = await r.text();
    if (!r.ok) return fail(502, `讀不到黨部的試算表（HTTP ${r.status}），請確認連結仍是「知道連結的人都能檢視」`);
    if (/^\s*<(!doctype|html)/i.test(text)) return fail(502, '黨部的試算表需要登入才能看，中繼站讀不到。請確認分享設定是「知道連結的人都能檢視」');
  } catch (e) {
    return fail(502, '連不上 Google 試算表，請稍後再試');
  }

  let data;
  try { data = parseSheet(text, CONFIG); }
  catch (e) { return fail(502, e.message); }

  return new Response(JSON.stringify({ ok: true, ...data }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=0, must-revalidate',
      'netlify-cdn-cache-control': `public, durable, s-maxage=${CONFIG.cacheSeconds}, stale-while-revalidate=10`,
    },
  });
};

/* ---------------- 解析黨部的表 ---------------- */

export function parseSheet(text, cfg) {
  const rows = parseCSV(text);
  const clean = s => String(s ?? '').replace(/[\s　]+/g, '');
  const hi = rows.findIndex(r => r.some(c => clean(c) === '區域'));
  if (hi < 0) throw new Error('黨部的表格式變了：找不到「區域」標題列');
  const H = rows[hi].map(clean);
  const col = (...names) => { for (const n of names) { const i = H.indexOf(n); if (i >= 0) return i; } return -1; };
  const cTown = col('區域'), cNo = col('編號', '票所'), cVill = col('村里');
  if (cNo < 0 || cVill < 0) throw new Error('黨部的表格式變了：找不到「編號」或「村里」欄');

  const start = H.indexOf(clean(cfg.race));
  if (start < 0) throw new Error(`黨部的表裡找不到「${cfg.race}」這一欄`);
  let end = start + 1;
  while (end < H.length && H[end] === '') end++;

  const numRow = rows[hi + 1] || [], nameRow = rows[hi + 2] || [];
  const candidates = [], candCols = [];
  let invalidCol = -1;
  for (let i = start; i < end; i++) {
    const name = String(nameRow[i] ?? '').trim(), no = String(numRow[i] ?? '').trim();
    if (!name && !no) continue;
    if (/廢票|無效/.test(name)) { invalidCol = i; continue; }
    const cno = no || String(candidates.length + 1);
    candidates.push({ no: cno, name: name || `${cno}號`, party: (cfg.partyByNo && cfg.partyByNo[cno]) || '', color: (cfg.colorsByNo && cfg.colorsByNo[cno]) || cfg.colors[candidates.length % cfg.colors.length] });
    candCols.push(i);
  }
  if (!candidates.length) throw new Error(`「${cfg.race}」底下沒有候選人`);

  const toNum = v => { const s = String(v ?? '').replace(/[,，\s]/g, ''); return /^\d+$/.test(s) ? Number(s) : null; };
  const stations = [], reports = {}, partial = [];
  let lastTown = '', lastVill = '';
  for (let r = hi + 3; r < rows.length; r++) {
    const row = rows[r];
    const id = String(row[cNo] ?? '').trim();
    const town = String(row[cTown] ?? '').trim() || lastTown;     // 合併儲存格只有第一列有值
    const vill = String(row[cVill] ?? '').trim() || lastVill;
    if (town) lastTown = town;
    if (vill) lastVill = vill;
    if (!id || !vill || !/\d/.test(id)) continue;
    stations.push({ id, town, villages: [vill] });

    const vals = candCols.map(i => toNum(row[i]));
    const filled = vals.filter(v => v !== null).length;
    if (filled === vals.length) {
      const votes = {};
      candidates.forEach((c, k) => votes[c.no] = vals[k]);
      reports[id] = { time: '', reporter: '', invalid: invalidCol >= 0 ? (toNum(row[invalidCol]) || 0) : 0, votes };
    } else if (filled > 0) partial.push(id);
  }

  // 名稱：村里去掉「里／村」，同一里有好幾所就加 1、2、3
  const count = {}, seen = {};
  stations.forEach(s => { const k = s.town + s.villages[0]; count[k] = (count[k] || 0) + 1; });
  stations.forEach(s => {
    const k = s.town + s.villages[0], short = s.villages[0].replace(/[里村]$/, '');
    seen[k] = (seen[k] || 0) + 1;
    s.name = count[k] > 1 ? short + seen[k] : short;
  });

  return {
    config: { title: cfg.title, subtitle: cfg.subtitle, county: cfg.county, towns: cfg.towns, refresh: cfg.refresh, hasInvalid: invalidCol >= 0, featured: cfg.featured || '', electors: cfg.electors || 0 },
    candidates, stations, reports, partial,
    serverTime: new Date().toISOString(),
  };
}

function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function fail(status, error) {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export const config = { path: '/api/data' };
