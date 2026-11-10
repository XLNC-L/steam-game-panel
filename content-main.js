/*
 * 游戏数据面板 —— 渲染脚本
 *
 * 布局（2×2 + 标签）：
 *   ┌──────────────┬──────────────┐
 *   │ 小黑盒评分    │ Steam 好评率 │
 *   │ 9.3          │ 93%          │
 *   │ 2.3 万人评分  │ 特别好评      │
 *   ├──────────────┼──────────────┤
 *   │ 实时在线      │ 史低价格      │
 *   │ 3,033        │ ¥7           │
 *   ├─────────────────────────────┤
 *   │ 类型标签                     │
 *   └─────────────────────────────┘
 */

(() => {
  'use strict';

  if (window.__GDP_BOOT__) return;
  window.__GDP_BOOT__ = true;

  const ROOT_ID = 'gdp-panel';
  const STYLE_ID = 'gdp-style';
  const DATA_ATTR = 'data-gdp-result';

  // ---------- 工具 ----------

  const fmt = (n) => {
    const v = Number(n);
    if (!isFinite(v) || v <= 0) return '—';
    if (v >= 1e8) return (v / 1e8).toFixed(2).replace(/\.?0+$/, '') + ' 亿';
    if (v >= 1e4) return (v / 1e4).toFixed(1).replace(/\.0$/, '') + ' 万';
    return v.toLocaleString('zh-CN');
  };

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const money = (v) => {
    if (v == null || !isFinite(Number(v))) return null;
    const n = Number(v);
    return '¥' + (Number.isInteger(n) ? n : n.toFixed(2));
  };

  function appidFromUrl() {
    const m = location.pathname.match(/\/app\/(\d+)/);
    return m ? m[1] : null;
  }

  // ---------- 样式 ----------

  const CSS = `
#${ROOT_ID} {
  margin: 0 0 14px 0;
  background: linear-gradient(150deg, rgba(27,40,56,.96), rgba(20,30,42,.96));
  border: 1px solid rgba(102,192,244,.20);
  border-radius: 6px;
  overflow: hidden;
  font-size: 13px;
  color: #c6d4df;
  font-family: "Motiva Sans", Arial, Helvetica, sans-serif;
  box-shadow: 0 2px 10px rgba(0,0,0,.35);
}
#${ROOT_ID} .gdp-head {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 14px;
  background: rgba(102,192,244,.09);
  border-bottom: 1px solid rgba(102,192,244,.15);
  font-size: 12px; font-weight: 600; letter-spacing: .5px;
  color: #66c0f4;
}
#${ROOT_ID} .gdp-head .gdp-badge {
  margin-left: auto; font-weight: 400; font-size: 11px;
  color: #7c8b99; letter-spacing: 0;
  max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#${ROOT_ID} .gdp-grid {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 1px; background: rgba(102,192,244,.10);
}
#${ROOT_ID} .gdp-cell {
  background: rgba(20,30,42,.94);
  padding: 10px 13px;
  min-width: 0;
}
#${ROOT_ID} .gdp-k {
  font-size: 11px; color: #7c8b99; margin-bottom: 3px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#${ROOT_ID} .gdp-v {
  font-size: 20px; font-weight: 600; color: #fff; line-height: 1.2;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#${ROOT_ID} .gdp-v.gdp-score { color: #ff9f1c; }
#${ROOT_ID} .gdp-v.gdp-pos { color: #66c0f4; }
#${ROOT_ID} .gdp-v.gdp-online { color: #66c0f4; }
#${ROOT_ID} .gdp-v.gdp-low { color: #a4d007; }
#${ROOT_ID} .gdp-sub {
  font-size: 11px; color: #8f98a0; margin-top: 3px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#${ROOT_ID} .gdp-bar {
  display: flex; height: 4px; border-radius: 2px;
  overflow: hidden; margin-top: 5px; background: rgba(255,255,255,.06);
}
#${ROOT_ID} .gdp-bar span { display: block; height: 100%; }
#${ROOT_ID} .gdp-ratio {
  height: 4px; border-radius: 2px; overflow: hidden;
  background: rgba(160,60,60,.35); margin-top: 5px;
}
#${ROOT_ID} .gdp-ratio > i { display: block; height: 100%; background: #66c0f4; }
#${ROOT_ID} .gdp-tags {
  display: flex; flex-wrap: wrap; gap: 5px; padding: 9px 13px;
  background: rgba(20,30,42,.94);
}
#${ROOT_ID} .gdp-tag {
  background: rgba(102,192,244,.13);
  border: 1px solid rgba(102,192,244,.25);
  border-radius: 3px;
  padding: 2px 8px; font-size: 11px; color: #a5c9e0;
}
#${ROOT_ID} .gdp-foot {
  padding: 6px 13px; font-size: 11px; color: #6e7a86;
  border-top: 1px solid rgba(102,192,244,.08);
  display: flex; align-items: center; gap: 6px;
  background: rgba(16,24,34,.96);
}
#${ROOT_ID} .gdp-dot { width: 6px; height: 6px; border-radius: 50%; background: #5ba85b; flex: 0 0 auto; }
#${ROOT_ID} .gdp-dot.gdp-warn { background: #e0a33a; }
#${ROOT_ID} .gdp-foot .gdp-err {
  margin-left: auto; color: #b4685f; font-size: 10px;
  max-width: 58%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
`;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // ---------- 各格渲染 ----------

  function scoreCell(d) {
    const stars = Array.isArray(d.stars) && d.stars.length === 5 ? d.stars : null;
    let bar = '';
    if (stars) {
      const total = stars.reduce((a, b) => a + b, 0) || 1;
      const colors = ['#5ba85b', '#7cb342', '#d4b840', '#e08c3a', '#c0392b'];
      bar = '<div class="gdp-bar">' + stars.map((v, i) =>
        `<span style="width:${(v / total * 100).toFixed(2)}%;background:${colors[i]}"></span>`
      ).join('') + '</div>';
    }
    return `
      <div class="gdp-cell">
        <div class="gdp-k">小黑盒评分</div>
        <div class="gdp-v gdp-score">${d.score ? esc(d.score) : '—'}</div>
        <div class="gdp-sub">${d.scoreComment ? fmt(d.scoreComment) + ' 人评分' : '暂无数据'}</div>
        ${bar}
      </div>`;
  }

  function reviewCell(rv) {
    if (!rv) {
      return `
        <div class="gdp-cell">
          <div class="gdp-k">Steam 好评率</div>
          <div class="gdp-v">—</div>
          <div class="gdp-sub">暂无数据</div>
        </div>`;
    }
    const pct = Number(rv.percent) || 0;
    return `
      <div class="gdp-cell">
        <div class="gdp-k">Steam 好评率</div>
        <div class="gdp-v gdp-pos">${pct}%</div>
        <div class="gdp-sub">${esc(rv.desc || '')}${rv.total ? ' · ' + fmt(rv.total) + ' 篇' : ''}</div>
        <div class="gdp-ratio"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>
      </div>`;
  }

  function onlineCell(d) {
    return `
      <div class="gdp-cell">
        <div class="gdp-k">实时在线</div>
        <div class="gdp-v gdp-online">${d.online != null ? fmt(d.online) : '—'}</div>
        <div class="gdp-sub">Steam 官方</div>
      </div>`;
  }

  function lowestCell(lo) {
    if (!lo) {
      return `
        <div class="gdp-cell">
          <div class="gdp-k">史低价格</div>
          <div class="gdp-v">—</div>
          <div class="gdp-sub">未配置 ITAD Key</div>
        </div>`;
    }
    const main = money(lo.cny) || '—';
    const subs = [];
    if (lo.cut > 0) subs.push('-' + lo.cut + '%');
    if (lo.regular) subs.push('原价 ' + money(lo.regular));
    return `
      <div class="gdp-cell">
        <div class="gdp-k">史低价格${lo.shop ? ' · ' + esc(lo.shop) : ''}</div>
        <div class="gdp-v gdp-low">${esc(main)}</div>
        <div class="gdp-sub">${esc(subs.join(' · ')) || '历史最低'}</div>
      </div>`;
  }

  // ---------- 整体渲染 ----------

  function render(el, d) {
    const tags = Array.isArray(d.genres) && d.genres.length
      ? `<div class="gdp-tags">${d.genres.map(g => `<span class="gdp-tag">${esc(g)}</span>`).join('')}</div>`
      : '';

    const errs = (d.errors || []).filter(Boolean);
    const healthy = errs.length === 0;

    el.innerHTML = `
      <div class="gdp-head">
        <span>口碑与史低</span>
        <span class="gdp-badge">${d.name ? esc(d.name) : ''}</span>
      </div>
      <div class="gdp-grid">
        ${scoreCell(d)}
        ${reviewCell(d.reviews)}
        ${onlineCell(d)}
        ${lowestCell(d.lowest)}
      </div>
      ${tags}
      <div class="gdp-foot">
        <span class="gdp-dot ${healthy ? '' : 'gdp-warn'}"></span>
        <span>${healthy ? '小黑盒 · Steam · ITAD' : '部分数据不可用'}</span>
        ${d.cached ? '<span style="margin-left:auto;color:#5c6b78">缓存</span>' : ''}
        ${!healthy ? `<span class="gdp-err" title="${esc(errs.join(' | '))}">${esc(errs.join(' | '))}</span>` : ''}
      </div>`;
  }

  function renderSkeleton(el) {
    el.innerHTML = `
      <div class="gdp-head"><span>口碑与史低</span><span class="gdp-badge">加载中…</span></div>
      <div class="gdp-grid">
        <div class="gdp-cell"><div class="gdp-k">小黑盒评分</div><div class="gdp-v">…</div></div>
        <div class="gdp-cell"><div class="gdp-k">Steam 好评率</div><div class="gdp-v">…</div></div>
        <div class="gdp-cell"><div class="gdp-k">实时在线</div><div class="gdp-v">…</div></div>
        <div class="gdp-cell"><div class="gdp-k">史低价格</div><div class="gdp-v">…</div></div>
      </div>`;
  }

  // ---------- 锚点 ----------

  function findAnchor() {
    const sels = ['.glance_ctn_responsive_left', '#game_area_purchase', '.game_area_purchase_game_wrapper', '.rightcol'];
    for (const s of sels) {
      const n = document.querySelector(s);
      if (n) return n;
    }
    return null;
  }

  // ---------- 主流程 ----------

  let mountedAppId = null;
  let polls = 0;

  function ensurePanel() {
    const anchor = findAnchor();
    if (!anchor) return null;
    injectStyle();
    let el = document.getElementById(ROOT_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = ROOT_ID;
      anchor.insertBefore(el, anchor.firstChild);
      renderSkeleton(el);
    }
    return el;
  }

  function readBridge(el, appid) {
    const raw = el.getAttribute(DATA_ATTR);
    if (!raw) return null;
    try {
      const o = JSON.parse(raw);
      if (String(o.appid) !== String(appid)) return null;
      return o.data || null;
    } catch (_) {
      return null;
    }
  }

  function boot() {
    const appid = appidFromUrl();
    if (!appid) return;

    const el = ensurePanel();
    if (!el) return;

    if (mountedAppId !== appid) {
      mountedAppId = appid;
      polls = 0;
      renderSkeleton(el);
    }

    if (el.dataset.loaded === '1') return;

    const data = readBridge(el, appid);
    if (data) {
      render(el, data);
      el.dataset.loaded = '1';
      return;
    }

    polls++;
    if (polls > 45) {
      render(el, { errors: ['数据获取超时'] });
      el.dataset.loaded = '1';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 400));
  } else {
    setTimeout(boot, 400);
  }

  setInterval(boot, 700);

  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      mountedAppId = null;
      polls = 0;
      const old = document.getElementById(ROOT_ID);
      if (old) old.remove();
      setTimeout(boot, 600);
    }
  }, 1200);
})();
