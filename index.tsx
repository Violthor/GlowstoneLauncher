import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { ErrorBoundary } from "react-error-boundary";
import { AppContainer, ErrorRender } from "@lark-apaas/client-toolkit-lite";
import { Toaster } from "sonner";
import App from "./app";
import { initMobileBridge } from "./mobile/bridge";
import "./index.css";

// Android WebView 环境：在渲染前注入原生 bridge，把 electronAPI 契约接到原生能力
initMobileBridge();

// Windows 7 兼容：Electron 22（Chromium 108）缺少较新浏览器 API，这里补上最小 polyfill。
// React 19 内部用到 Promise.withResolvers（Chrome 119+ 才有）；108 上没有时补一个，避免白屏。
if (typeof Promise !== "undefined" && !(Promise as unknown as { withResolvers?: unknown }).withResolvers) {
  (Promise as unknown as { withResolvers: (o?: unknown) => unknown }).withResolvers = function withResolvers() {
    let resolve: (v: unknown) => void = () => {};
    let reject: (e?: unknown) => void = () => {};
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}
// Chromium 108 同样缺 AbortSignal.time / any（React 缓存路径偶用），补最小版本
const asAny = AbortSignal as unknown as { any?: (s: Iterable<AbortSignal>) => AbortSignal; time?: (ms: number) => AbortSignal };
if (typeof AbortSignal !== "undefined" && !asAny.time) {
  asAny.time = (ms: number) => { const c = new AbortController(); setTimeout(() => c.abort(new DOMException("Timeout", "TimeoutError")), ms); return c.signal; };
}
if (typeof AbortSignal !== "undefined" && !asAny.any) {
  asAny.any = (signals: Iterable<AbortSignal>) => { const c = new AbortController(); for (const s of signals) { if (s.aborted) { c.abort(s.reason); return c.signal; } s.addEventListener("abort", () => c.abort(s.reason), { once: true }); } return c.signal; };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <AppContainer>
        <ErrorBoundary
          fallbackRender={({ error, resetErrorBoundary }) => (
            <ErrorRender error={error} resetErrorBoundary={resetErrorBoundary} />
          )}
        >
          <App />
        </ErrorBoundary>
        <Toaster position="top-right" richColors closeButton />
      </AppContainer>
    </HashRouter>
  </StrictMode>,
);
