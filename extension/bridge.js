/* global chrome */
// The extension never receives local authentication cookies or tokens.
if (
  ["http://127.0.0.1:8787", "http://localhost:8787"].includes(
    location.origin,
  ) &&
  window.top === window
) {
  let armedUntil = 0;
  let busy = false;
  document.addEventListener("click", (event) => {
    if (
      event.isTrusted &&
      event.target instanceof Element &&
      event.target.closest('button[data-oliverank-collect="true"]')
    )
      armedUntil = Date.now() + 3000;
  });
  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const m = event.data;
    if (
      !m ||
      m.channel !== "OLIVERANK_APP_V1" ||
      typeof m.id !== "string" ||
      !/^[\da-f-]{36}$/.test(m.id)
    )
      return;
    if (m.type === "PING") {
      window.postMessage(
        { channel: "OLIVERANK_EXTENSION_V1", type: "PONG", id: m.id },
        location.origin,
      );
      return;
    }
    if (m.type !== "COLLECT" || busy || Date.now() > armedUntil) return;
    armedUntil = 0;
    busy = true;
    try {
      const result = await chrome.runtime.sendMessage({
        type: "COLLECT_OVERALL",
      });
      window.postMessage(
        {
          channel: "OLIVERANK_EXTENSION_V1",
          type: "RESULT",
          id: m.id,
          ...result,
        },
        location.origin,
      );
    } catch {
      window.postMessage(
        {
          channel: "OLIVERANK_EXTENSION_V1",
          type: "RESULT",
          id: m.id,
          error:
            "브라우저 연결이 끊겼습니다. 확장 프로그램과 앱 페이지를 새로고침하세요.",
        },
        location.origin,
      );
    } finally {
      busy = false;
    }
  });
}
