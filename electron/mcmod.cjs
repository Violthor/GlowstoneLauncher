// MC百科（mcmod.cn）中文译名实时查询。
// MC百科没有公开 JSON API，这里请求其服务端渲染的搜索页 HTML，解析第一条「class/<id>.html」
// 结果，取出中文主名与英文名（斜体）。仅做只读查询，带内存缓存与超时；失败由调用方回退内置表。
const https = require('https');

function fetchHtml(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchHtml(new URL(res.headers.location, url).toString(), timeoutMs));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; if (data.length > 600000) req.destroy(); });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('mcmod timeout')));
  });
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '');
}

// 从搜索页 HTML 解析第一条 class 结果：返回 {zh,en,url}
function parseFirst(html) {
  // 直接定位第一个「class/<数字>.html」（category 链接 class/category/.. 不会匹配）
  const re = /mcmod\.cn\/class\/(\d+)\.html/i;
  const hit = html.match(re);
  if (!hit) return null;
  const id = hit[1];
  const at = hit.index;
  // 定位包含该链接的 <a>…</a>
  const aStart = html.lastIndexOf('<a', at);
  const aEnd = html.indexOf('</a>', at);
  if (aStart < 0 || aEnd < 0) return null;
  const anchor = html.slice(aStart, aEnd);
  const inner = anchor.slice(anchor.indexOf('>') + 1);

  // 英文名：优先取最后一个半角括号内容；否则取内容为 ASCII 的 <em>
  let en = '';
  const paren = inner.match(/\(([^()]*[A-Za-z][^()]*)\)\s*$/);
  if (paren) en = decodeEntities(paren[1]).trim();
  if (!/[A-Za-z]/.test(en)) {
    const ems = [...inner.matchAll(/<em[^>]*>([\s\S]*?)<\/em>/gi)].map((x) => decodeEntities(x[1]).trim());
    en = ems.find((x) => /^[\x00-\x7F\s]+$/.test(x) && x) || en || '';
  }

  // 中文名：去掉括号/方括号内容与 em（英文），剩余即中文
  let zhRaw = inner
    .replace(/\([^()]*\)/g, ' ')
    .replace(/（[^（）]*）/g, ' ')
    .replace(/\[[^\[\]]*\]/g, ' ')
    .replace(/<em[\s\S]*?<\/em>/gi, ' ');
  const zh = decodeEntities(zhRaw).replace(/[()（）\[\]]/g, ' ').replace(/\s+/g, ' ').trim();

  return { zh, en, url: `https://www.mcmod.cn/class/${id}.html` };
}

function initMcmod({ ipcMain }) {
  const cache = new Map();
  ipcMain.handle('mcmod-lookup', async (_e, query) => {
    const key = String(query || '').trim().toLowerCase();
    if (!key) return { success: false };
    if (cache.has(key)) return { success: true, ...cache.get(key), cached: true };
    try {
      const url = `https://search.mcmod.cn/s?key=${encodeURIComponent(key)}`;
      const html = await fetchHtml(url);
      const r = parseFirst(html);
      if (!r) return { success: false, miss: true };
      cache.set(key, r);
      return { success: true, ...r };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

module.exports = { initMcmod, parseFirst, fetchHtml };
