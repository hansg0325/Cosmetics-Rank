function exchange(type: "PING" | "COLLECT", timeout: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const handler = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.origin !== location.origin ||
        event.data?.channel !== "OLIVERANK_EXTENSION_V1" ||
        event.data.id !== id ||
        event.data.type !== (type === "PING" ? "PONG" : "RESULT")
      )
        return;
      cleanup();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.capture);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          type === "PING"
            ? "브라우저 연결 확장 프로그램이 필요합니다. 설치 안내를 확인한 뒤 앱을 같은 브라우저에서 새로고침하세요."
            : "수집 시간이 초과됐습니다. 올리브영 탭을 확인한 뒤 다시 눌러주세요.",
        ),
      );
    }, timeout);
    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener("message", handler);
    }
    window.addEventListener("message", handler);
    window.postMessage(
      { channel: "OLIVERANK_APP_V1", type, id },
      location.origin,
    );
  });
}
export async function requestBrowserCapture() {
  await exchange("PING", 1000);
  return exchange("COLLECT", 40000);
}
