/*
 * 游戏数据面板 —— Service Worker
 *
 * 数据源（全部国内直连）：
 *   1. 小黑盒     api.xiaoheihe.cn/game/web/get_game_detail/
 *        → 小黑盒评分、评分人数、五星分布、中文类型标签
 *   2. Steam 官方 api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers
 *        → 实时在线人数
 *   3. Steam 商店 store.steampowered.com/app/{id}/?l=schinese&cc=cn
 *        → 全语言好评率（解析「所有评测」行的 "N 篇中的 P%"）
 *   4. IsThereAnyDeal  api.isthereanydeal.com
 *        → 国区史低价格（CNY）
 *          两步：lookup 拿 uuid → historylow 查史低
 *
 * API Key 存 chrome.storage.local('gdp:settings').itadKey，由弹窗配置。
 * 结果写 chrome.storage.local，由 content-bridge.js 中转给渲染脚本。
 */

const CACHE_TTL = 10 * 60 * 1000;
const LOOKUP_TTL = 7 * 24 * 60 * 60 * 1000;   // appid→uuid 映射基本不变，缓存 7 天
const KEY_PREFIX = 'gdp:';
const SETTINGS_KEY = 'gdp:settings';

// ---------- 设置 ----------

async function getSettings() {
  try {
    const got = await chrome.storage.local.get(SETTINGS_KEY);
    return got[SETTINGS_KEY] || {};
  } catch (_) {
    return {};
  }
}

async function saveSettings(obj) {
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY]: obj });
    return true;
  } catch (_) {
    return false;
  }
}

// ---------- HTTP ----------

async function fetchText(url, timeout, asJson, method, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout || 12000);
  try {
    const opt = {
      signal: ctl.signal,
      method: method || 'GET',
      headers: {
        'Accept': asJson
          ? 'application/json, text/plain, */*'
          : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      credentials: 'include',
    };
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    const r = await fetch(url, opt);
    if (!r.ok) return { error: 'HTTP ' + r.status };
    const text = await r.text();
    if (!asJson) return { data: text };
    try {
      return { data: JSON.parse(text) };
    } catch (_) {
      return { error: 'not json' };
    }
  } catch (e) {
    return { error: String(e && e.message ? e.message : e) };
  } finally {
    clearTimeout(timer);
  }
}

const getJson = (u, t) => fetchText(u, t, true, 'GET');

// ---------- 1. 小黑盒 ----------

async function fetchXhh(appid) {
  const url = 'https://api.xiaoheihe.cn/game/web/get_game_detail/?appid=' + encodeURIComponent(appid);
  const { data, error } = await getJson(url);
  if (error) return { error: 'xhh: ' + error };
  if (!data || data.status !== 'ok' || !data.result) return { error: 'xhh: bad payload' };

  const r = data.result;
  const out = {
    name: r.name || null,
    score: r.score || null,
    genres: Array.isArray(r.genres) && r.genres.length ? r.genres : null,
  };

  const cs = r.comment_stats;
  if (cs && typeof cs === 'object') {
    out.scoreComment = Number(cs.score_comment) || 0;
    out.stars = [cs.star_5, cs.star_4, cs.star_3, cs.star_2, cs.star_1].map(v => Number(v) || 0);
  }
  return { data: out };
}

// ---------- 2. 实时在线 ----------

async function fetchOnline(appid) {
  const url = 'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=' +
    encodeURIComponent(appid) + '&origin=https%3A%2F%2Fstore.steampowered.com';
  const { data, error } = await getJson(url);
  if (error) return { error: 'steam: ' + error };
  const resp = data && data.response;
  if (!resp || resp.result !== 1) return { error: 'steam: no result' };
  return { data: Number(resp.player_count) || 0 };
}

// ---------- 3. 全语言好评率 ----------

function parseReviewsFromStorePage(html) {
  if (!html || typeof html !== 'string') return null;

  // 目标格式（可能夹大量空白/换行）：
  //   <span class="game_review_summary positive">特别好评</span>
  //                       (70,203 篇中的 93%)
  // 中文也可能被转义为 \uXXXX，两种都兼容
  const patterns = [
    /([\d,]+)\s*篇中的\s*(\d+)%/s,
    /([\d,]+)[\s\S]{0,200}?\\u7bc7\\u4e2d\\u7684[\s\S]{0,20}?(\d+)%/,
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      const total = Number(m[1].replace(/,/g, '')) || 0;
      const percent = Number(m[2]) || 0;
      if (total > 0 && percent >= 0 && percent <= 100) {
        return { total, percent, positive: Math.round(total * percent / 100) };
      }
    }
  }
  return null;
}

async function fetchReviews(appid) {
  const url = 'https://store.steampowered.com/app/' + encodeURIComponent(appid) + '/?l=schinese&cc=cn';
  const { data, error } = await fetchText(url, 20000, false);
  if (error) return { error: 'review: ' + error };

  const parsed = parseReviewsFromStorePage(data);
  if (!parsed) return { data: null };

  const descM = data.match(/game_review_summary\s+(?:positive|mixed|negative)[^>]*>([^<]{2,20})</) ||
                data.match(/(好评如潮|特别好评|多半好评|褒贬不一|多半差评|特别差评|差评如潮)/);
  if (descM) parsed.desc = descM[1].trim();

  return { data: parsed };
}

// ---------- 4. ITAD 国区史低 ----------

/** appid → ITAD uuid，带长缓存 */
async function lookupItadId(appid, key) {
  const cacheKey = KEY_PREFIX + 'itad-id:' + appid;

  try {
    const got = await chrome.storage.local.get(cacheKey);
    const rec = got[cacheKey];
    if (rec && rec.id && Date.now() - rec.at < LOOKUP_TTL) return rec.id;
  } catch (_) { /* ignore */ }

  const url = 'https://api.isthereanydeal.com/games/lookup/v1?appid=' +
    encodeURIComponent(appid) + '&key=' + encodeURIComponent(key);
  const { data, error } = await getJson(url);
  if (error) return { error: 'itad-lookup: ' + error };
  if (!data || !data.found || !data.game || !data.game.id) {
    return { error: 'itad-lookup: not found' };
  }

  const id = data.game.id;
  try {
    await chrome.storage.local.set({ [cacheKey]: { at: Date.now(), id } });
  } catch (_) { /* ignore */ }

  return id;
}

/**
 * 国区史低。必须 POST，GET 会 405。
 * 返回 { cny, cut, currency, shop, timestamp }
 */
async function fetchLowestItad(appid, key) {
  if (!key) return { error: 'itad: no api key' };

  const idOrErr = await lookupItadId(appid, key);
  if (typeof idOrErr !== 'string') return { error: idOrErr.error || 'itad: lookup failed' };
  const uuid = idOrErr;

  const url = 'https://api.isthereanydeal.com/games/historylow/v1?key=' +
    encodeURIComponent(key) + '&country=CN';
  const { data, error } = await fetchText(url, 15000, true, 'POST', [uuid]);
  if (error) return { error: 'itad-low: ' + error };
  if (!Array.isArray(data) || !data.length) return { data: null };

  const row = data.find(r => r && r.id === uuid) || data[0];
  const low = row && row.low;
  if (!low || !low.price) return { data: null };

  const price = low.price;
  const regular = low.regular || {};

  return {
    data: {
      // amountInt 单位是分
      cny: typeof price.amountInt === 'number' ? price.amountInt / 100 : Number(price.amount),
      regular: typeof regular.amountInt === 'number' ? regular.amountInt / 100 : Number(regular.amount),
      currency: price.currency || 'CNY',
      cut: Number(low.cut) || 0,
      shop: low.shop ? low.shop.name : null,
      at: low.timestamp || null,
    },
  };
}

// ---------- 聚合 ----------

async function build(appid) {
  const settings = await getSettings();
  const itadKey = settings.itadKey || '';

  const payload = { appid: String(appid), fetched: Date.now(), ok: false, errors: [] };

  const [xhh, online, reviews, lowest] = await Promise.all([
    fetchXhh(appid),
    fetchOnline(appid),
    fetchReviews(appid),
    fetchLowestItad(appid, itadKey),
  ]);

  if (xhh.data) { Object.assign(payload, xhh.data); payload.ok = true; }
  else if (xhh.error) payload.errors.push(xhh.error);

  if (typeof online.data === 'number') { payload.online = online.data; payload.ok = true; }
  else if (online.error) payload.errors.push(online.error);

  if (reviews.data) payload.reviews = reviews.data;
  else if (reviews.error) payload.errors.push(reviews.error);

  if (lowest.data) payload.lowest = lowest.data;
  else if (lowest.error) payload.errors.push(lowest.error);

  return payload;
}

async function getGameInfo(appid, force) {
  const key = KEY_PREFIX + appid;

  if (!force) {
    try {
      const got = await chrome.storage.local.get(key);
      const rec = got[key];
      if (rec && rec.at && Date.now() - rec.at < CACHE_TTL) {
        return Object.assign({}, rec.data, { cached: true });
      }
    } catch (_) { /* ignore */ }
  }

  const data = await build(appid);
  try {
    await chrome.storage.local.set({ [key]: { at: Date.now(), data } });
    await chrome.storage.local.set({ [KEY_PREFIX + 'result:' + appid]: { at: Date.now(), data } });
  } catch (_) { /* ignore */ }

  return data;
}

// ---------- 消息 ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === 'GDP_GET') {
    getGameInfo(msg.appid, msg.force)
      .then(d => sendResponse(d))
      .catch(e => sendResponse({ ok: false, errors: [String(e)] }));
    return true;
  }

  if (msg.type === 'GDP_GET_SETTINGS') {
    getSettings().then(s => sendResponse(s)).catch(() => sendResponse({}));
    return true;
  }

  if (msg.type === 'GDP_SAVE_SETTINGS') {
    saveSettings(msg.settings || {})
      .then(ok => sendResponse({ ok }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === 'GDP_CLEAR_CACHE') {
    (async () => {
      try {
        const all = await chrome.storage.local.get(null);
        const keys = Object.keys(all).filter(k => k.startsWith(KEY_PREFIX) && k !== SETTINGS_KEY);
        if (keys.length) await chrome.storage.local.remove(keys);
        sendResponse({ ok: true, cleared: keys.length });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const all = await chrome.storage.local.get(null);
    const stale = [];
    for (const [k, v] of Object.entries(all)) {
      if (k === SETTINGS_KEY) continue;
      if (k.startsWith(KEY_PREFIX + 'itad-id:')) continue;   // 长效缓存不动
      if (k.startsWith(KEY_PREFIX) && (!v || !v.at || Date.now() - v.at > CACHE_TTL * 6)) stale.push(k);
    }
    if (stale.length) await chrome.storage.local.remove(stale);
  } catch (_) { /* ignore */ }
});
