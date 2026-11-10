/*
 * 游戏数据面板 —— 桥接脚本（ISOLATED world）
 * 读取 background 写入 storage 的数据，写到 DOM 属性上供渲染脚本使用。
 * ISOLATED world 能访问 chrome.storage，但不一定访问得到页面 JS，
 * 因此通过 DOM attribute 传递，双方都能看到。
 */

(() => {
  'use strict';

  if (window.__GDP_BRIDGE__) return;
  window.__GDP_BRIDGE__ = true;

  const ROOT_ID = 'gdp-panel';
  const DATA_ATTR = 'data-gdp-result';
  const CACHE_TTL = 10 * 60 * 1000;

  function appidFromUrl() {
    const m = location.pathname.match(/\/app\/(\d+)/);
    return m ? m[1] : null;
  }

  let lastAppId = null;
  let done = false;

  async function step() {
    const appid = appidFromUrl();
    if (!appid) return;

    const el = document.getElementById(ROOT_ID);
    if (!el) return;

    if (lastAppId !== appid) {
      lastAppId = appid;
      done = false;
      el.removeAttribute(DATA_ATTR);
    }
    if (done) return;

    // 已有数据就不再重复
    if (el.getAttribute(DATA_ATTR)) { done = true; return; }

    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      // 没有 storage 能力，直接让渲染脚本走超时提示
      return;
    }

    const key = 'gdp:result:' + appid;
    try {
      const got = await chrome.storage.local.get(key);
      let rec = got[key];

      if (!rec || !rec.at || Date.now() - rec.at > CACHE_TTL) {
        // 让 background 去抓（若 storage 里没有）
        try {
          await chrome.runtime.sendMessage({ type: 'GDP_GET', appid });
        } catch (_) { /* ignore */ }
        const again = await chrome.storage.local.get(key);
        rec = again[key];
      }

      if (rec && rec.data) {
        el.setAttribute(DATA_ATTR, JSON.stringify({ appid, data: rec.data }));
      }
    } catch (e) {
      /* 忽略，由渲染脚本兜底 */
    }
  }

  setInterval(step, 600);
  step();
})();
