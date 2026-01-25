/**
 * WebSocket 代理 Patch（Node.js / ESM）
 *
 * 背景：
 * - `@polymarket/real-time-data-client` 在 Node 里使用 `isomorphic-ws`
 * - 其内部 `new WebSocket(url)` 不提供传 `agent` 的配置入口
 *
 * 结论：
 * - 想让 `wss://` 走本地代理（例如 Clash Meta），需要在连接创建前给 `ws` 注入 `agent`
 *
 * 用法：
 * - 在任何会触发 WebSocket 连接的 import 之前先 import 本文件（side-effect）
 * - 通过环境变量提供代理（按优先级）：
 *   - `POLY_WS_PROXY`（推荐）
 *   - `WSS_PROXY` / `WS_PROXY`
 *   - `HTTPS_PROXY` / `HTTP_PROXY`
 *   - `SOCKS_PROXY`（例如 `socks5://127.0.0.1:7891`）
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const proxyUrl =
  process.env.POLY_WS_PROXY ||
  process.env.WSS_PROXY ||
  process.env.WS_PROXY ||
  process.env.HTTPS_PROXY ||
  process.env.HTTP_PROXY ||
  process.env.SOCKS_PROXY;

  console.log(proxyUrl)

const isNode = typeof process !== 'undefined' && process?.versions?.node && typeof window === 'undefined';

if (isNode && proxyUrl) {
  try {
    // -------------------------------------------------------------------------
    // 1) Patch global fetch (undici) to use HTTP proxy (Clash Meta HTTP port 7890)
    // -------------------------------------------------------------------------
    // Node.js built-in fetch is powered by undici and does NOT automatically honor HTTP_PROXY.
    // So we set a global dispatcher when an HTTP(S) proxy URL is available.
    const fetchProxyUrl =
      process.env.POLY_HTTP_PROXY ||
      // reuse WS proxy if it's HTTP(S)
      (proxyUrl.startsWith('http://') || proxyUrl.startsWith('https://') ? proxyUrl : undefined) ||
      process.env.HTTPS_PROXY ||
      process.env.HTTP_PROXY;

    if (fetchProxyUrl) {
      try {
        const { ProxyAgent, setGlobalDispatcher, getGlobalDispatcher } = require('undici');
        const current = getGlobalDispatcher?.();
        const already = globalThis.__POLY_UNDICI_PROXY__ === fetchProxyUrl;
        if (!already) {
          setGlobalDispatcher(new ProxyAgent(fetchProxyUrl));
          globalThis.__POLY_UNDICI_PROXY__ = fetchProxyUrl;
          console.log(`[Proxy] undici(fetch) proxy set via ${fetchProxyUrl}`);
        } else if (current) {
          console.log(`[Proxy] undici(fetch) proxy already set: ${fetchProxyUrl}`);
        }
      } catch (err) {
        const msg = err?.message || String(err);
        console.warn(`[Proxy] failed to set undici(fetch) proxy: ${msg}`);
        if (msg.includes("Cannot find module 'undici'")) {
          console.warn('[Proxy] 提示：请先安装 undici（用于让 Node 内置 fetch 走代理）：pnpm install（或 pnpm add undici）');
        }
      }
    } else if (proxyUrl.startsWith('socks')) {
      console.warn('[Proxy] SOCKS proxy detected: undici(fetch) generally requires HTTP proxy; set POLY_HTTP_PROXY=http://127.0.0.1:7890');
    }

    // -------------------------------------------------------------------------
    // 2) Patch WebSocket (ws) to use proxy agent for wss://
    // -------------------------------------------------------------------------
    const wsPath = require.resolve('ws');
    const ws = require(wsPath);
    const { HttpsProxyAgent } = require('https-proxy-agent');
    const { SocksProxyAgent } = require('socks-proxy-agent');

    if (ws.__POLY_WS_PROXY_PATCHED__ === proxyUrl) {
      console.log(`[Proxy] ws already patched: ${proxyUrl}`);
    } else {
      const agent =
        proxyUrl.startsWith('socks5://') || proxyUrl.startsWith('socks://')
          ? new SocksProxyAgent(proxyUrl)
          : new HttpsProxyAgent(proxyUrl);

      const OriginalWebSocket = ws.WebSocket ?? ws;

      class PatchedWebSocket extends OriginalWebSocket {
        constructor(address, protocols, options) {
          const opts = options ?? {};

          const urlStr =
            typeof address === 'string'
              ? address
              : typeof address?.href === 'string'
                ? address.href
                : String(address);

          const isWss = urlStr.startsWith('wss://') || address?.protocol === 'wss:';

          // Only attach agent for secure ws (wss://) and when caller didn't provide one
          if (isWss && !opts.agent) {
            opts.agent = agent;
          }

          super(address, protocols, opts);
        }
      }

      // If ws exports a function/class directly (common case), replace module exports in require cache.
      // This ensures `isomorphic-ws` (which does `require('ws')`) will receive the patched constructor.
      const wsCacheEntry = require.cache?.[wsPath];
      if (typeof ws === 'function' && wsCacheEntry?.exports) {
        // Replace module export with patched constructor.
        // Static props (e.g. CONNECTING/OPEN/...) remain accessible via prototype chain
        // because PatchedWebSocket.__proto__ === OriginalWebSocket.
        PatchedWebSocket.WebSocket = PatchedWebSocket;
        Object.defineProperty(PatchedWebSocket, '__POLY_WS_PROXY_PATCHED__', {
          value: proxyUrl,
          writable: false,
          enumerable: false,
          configurable: true,
        });
        wsCacheEntry.exports = PatchedWebSocket;
      } else {
        if (ws.WebSocket) ws.WebSocket = PatchedWebSocket;
        if (ws.default) ws.default = PatchedWebSocket;
        ws.__POLY_WS_PROXY_PATCHED__ = proxyUrl;
      }

      // If isomorphic-ws is already loaded, also update its cached export to the patched ws constructor.
      try {
        const isoPath = require.resolve('isomorphic-ws');
        const isoEntry = require.cache?.[isoPath];
        if (isoEntry?.exports) {
          isoEntry.exports = require(wsPath);
        }
      } catch {
        // ignore
      }

      console.log(`[Proxy] ws patched for WSS via ${proxyUrl}`);
    }
  } catch (err) {
    console.warn(`[Proxy] failed to patch ws: ${err?.message || err}`);
  }
}

