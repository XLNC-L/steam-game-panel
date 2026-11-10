# -*- coding: utf-8 -*-
"""Millennium 插件在 Steam CEF 中的空值/越界崩溃修复。

Steam 的 CEF 在部分状态下会向插件回调传入 undefined，或让集合接口返回
空值，导致插件抛出未捕获异常。本脚本对以下插件做防御性补丁：

steam-librarian
  1. webkit.js   MutationObserver 的 addedNodes 含文本节点，
                 文本节点没有 querySelectorAll 方法
  2. index.js    appStore.allApps.find(...) 未匹配时返回 undefined
  3. index.js    appDetailsStore.GetAppDetails(...) 可能返回 undefined
  4. index.js    e.per_client_data 可能为空数组
  5. index.js    item_data[0] 可能越界
  6. index.js    collectionStore.GetCollection(...) 可能返回 undefined

steam-taskbar-progress
  7. index.js    RegisterForDownloadOverview 回调参数可能为 undefined
  8. index.js    item_data[0] 可能越界

steam-easygrid
  9. index.js    collectionStore.GetCollection(...) 可能返回 undefined

用法：python fix_plugin_errors.py
"""
import io
import os
import shutil
import subprocess
import time

BASE = r"D:\Steam\millennium\plugins"
NODE = r"C:\Program Files\nodejs\node.exe"

FIXES = [
    # ---- steam-librarian / webkit.js ----
    (
        r"steam-librarian\.millennium\Dist\webkit.js",
        'for(const e of t.addedNodes){const t=e.querySelectorAll("div.apphub_CardRatingButtons:not(.extra-dl-button-added)");for(const e of t)n(e)}',
        'for(const e of t.addedNodes){if(!e||1!==e.nodeType||!e.querySelectorAll)continue;const t=e.querySelectorAll("div.apphub_CardRatingButtons:not(.extra-dl-button-added)");for(const e of t)n(e)}',
        "webkit.js: 过滤非元素节点",
    ),
    # ---- steam-librarian / index.js ----
    (
        r"steam-librarian\.millennium\Dist\index.js",
        'const e=appStore.allApps.find(e=>e.display_name===n);SteamUIStore.Navigate(`/library/app/${e.appid}`)',
        'const e=appStore.allApps.find(e=>e.display_name===n);if(e)SteamUIStore.Navigate(`/library/app/${e.appid}`)',
        "index.js: autoselect 未匹配时跳过跳转",
    ),
    (
        r"steam-librarian\.millennium\Dist\index.js",
        'if(l){const e=appStore.allApps.find(e=>e.appid===uiStore.currentGameListSelection.nAppId);e.BIsShortcut()&&(e.per_client_data[0].installed=!1)}',
        'if(l){const e=appStore.allApps.find(e=>e.appid===uiStore.currentGameListSelection.nAppId);e&&e.BIsShortcut()&&e.per_client_data&&e.per_client_data[0]&&(e.per_client_data[0].installed=!1)}',
        "index.js: 标记快捷方式未安装前判空",
    ),
    (
        r"steam-librarian\.millennium\Dist\index.js",
        "const t=appDetailsStore.GetAppDetails(e.appid).strShortcutExe;",
        "const _ad=appDetailsStore.GetAppDetails(e.appid);const t=_ad&&_ad.strShortcutExe;",
        "index.js: GetAppDetails 返回值判空",
    ),
    (
        r"steam-librarian\.millennium\Dist\index.js",
        "e.BIsShortcut()&&(e.per_client_data[0].installed=!1)",
        "e.BIsShortcut()&&e.per_client_data&&e.per_client_data[0]&&(e.per_client_data[0].installed=!1)",
        "index.js: per_client_data 判空（循环内）",
    ),
    (
        r"steam-librarian\.millennium\Dist\index.js",
        "await a({file_path:t})||(e.per_client_data[0].installed=!1)",
        "await a({file_path:t})||(e.per_client_data&&e.per_client_data[0]&&(e.per_client_data[0].installed=!1))",
        "index.js: per_client_data 判空（await 后）",
    ),
    (
        r"steam-librarian\.millennium\Dist\index.js",
        "const n=t.find(e=>e.item_data[0].appid===window.PLUGIN_LIST[pluginName].current_download_appid);",
        "const n=t.find(e=>e.item_data&&e.item_data[0]&&e.item_data[0].appid===window.PLUGIN_LIST[pluginName].current_download_appid);",
        "index.js: item_data 越界保护",
    ),
    (
        r"steam-librarian\.millennium\Dist\index.js",
        "const o=n[e][0],i=collectionStore.GetCollection(uiStore.currentGameListSelection.strCollectionId).allApps.find(e=>",
        "const o=n[e][0],_c=collectionStore.GetCollection(uiStore.currentGameListSelection.strCollectionId),i=_c&&_c.allApps?_c.allApps.find(e=>",
        "index.js: GetCollection 判空",
    ),
    (
        r"steam-librarian\.millennium\Dist\index.js",
        "i=_c&&_c.allApps?_c.allApps.find(e=>e.appid===uiStore.currentGameListSelection.nAppId);",
        "i=_c&&_c.allApps?_c.allApps.find(e=>e.appid===uiStore.currentGameListSelection.nAppId):null;if(i)",
        "index.js: find 结果判空",
    ),
    # ---- steam-taskbar-progress / index.js ----
    (
        r"steam-taskbar-progress\.millennium\Dist\index.js",
        'async function o(e){console.log("[steam-taskbar-progress] onDownloadOverview:",e);const n=e.update_state;',
        'async function o(e){if(!e)return console.log("[steam-taskbar-progress] onDownloadOverview: no data");console.log("[steam-taskbar-progress] onDownloadOverview:",e);const n=e.update_state;',
        "index.js: 回调无参数时提前返回",
    ),
    (
        r"steam-taskbar-progress\.millennium\Dist\index.js",
        "const o=n.find(e=>e.item_data[0].appid===window.PLUGIN_LIST[pluginName].current_download_appid);",
        "const o=n.find(e=>e.item_data&&e.item_data[0]&&e.item_data[0].appid===window.PLUGIN_LIST[pluginName].current_download_appid);",
        "index.js: item_data 越界保护",
    ),
    # ---- steam-easygrid / index.js ----
    (
        r"steam-easygrid\.millennium\Dist\index.js",
        "const t=collectionStore.GetCollection(uiStore.currentGameListSelection.strCollectionId).allApps.find(e=>",
        "const _c=collectionStore.GetCollection(uiStore.currentGameListSelection.strCollectionId);const _a=_c&&_c.allApps?_c.allApps:[];const t=_a.find(e=>",
        "index.js: GetCollection 判空",
    ),
]


def main():
    stamp = time.strftime("%Y%m%d-%H%M%S")
    total = 0

    for rel, old, new, desc in FIXES:
        path = os.path.join(BASE, rel)
        if not os.path.exists(path):
            print("SKIP  (missing) %s" % rel)
            continue

        src = io.open(path, encoding="utf-8").read()

        if new in src:
            print("SKIP  (already patched) %s  <- %s" % (rel, desc))
            continue

        cnt = src.count(old)
        if cnt == 0:
            print("MISS  %s  <- %s" % (rel, desc))
            continue

        backup = path + ".bak-" + stamp
        shutil.copy2(path, backup)
        src = src.replace(old, new)
        io.open(path, "w", encoding="utf-8", newline="").write(src)

        print("PATCH %s  x%d  <- %s" % (rel, cnt, desc))
        total += cnt

    print("\n--- syntax check ---")
    for rel in sorted(set(r for r, _, _, _ in FIXES)):
        path = os.path.join(BASE, rel)
        if not os.path.exists(path):
            continue
        p = subprocess.run([NODE, "--check", path],
                           capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
        print("%-58s %s" % (rel, "OK" if p.returncode == 0 else "FAIL"))
        if p.returncode != 0:
            print((p.stderr or "")[:700])

    print("\ntotal: %d" % total)


if __name__ == "__main__":
    main()
