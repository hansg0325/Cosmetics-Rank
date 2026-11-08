/* global chrome */
import { readWhenReady } from "./capture-function.js";
let collecting = false;
function allowedSender(sender) {
  try {
    const url = new URL(sender.url);
    return (
      sender.id === chrome.runtime.id &&
      sender.frameId === 0 &&
      sender.tab?.id !== undefined &&
      ["http://127.0.0.1:8787", "http://localhost:8787"].includes(url.origin)
    );
  } catch {
    return false;
  }
}
async function waitForPage(id) {
  if ((await chrome.tabs.get(id)).status === "complete") return;
  await new Promise((resolve, reject) => {
    const onUpdate = (tabId, info) => {
      if (tabId === id && info.status === "complete") finish();
    };
    const onRemove = (tabId) => {
      if (tabId === id) finish(new Error("랭킹 탭이 닫혔습니다."));
    };
    const timer = setTimeout(
      () => finish(new Error("랭킹 페이지 로딩 시간이 초과됐습니다.")),
      20000,
    );
    function finish(error) {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdate);
      chrome.tabs.onRemoved.removeListener(onRemove);
      if (error) reject(error);
      else resolve();
    }
    chrome.tabs.onUpdated.addListener(onUpdate);
    chrome.tabs.onRemoved.addListener(onRemove);
    chrome.tabs.get(id).then((tab) => {
      if (tab.status === "complete") finish();
    }, finish);
  });
}
export async function collect(sender) {
  if (!allowedSender(sender))
    throw new Error("허용된 로컬 cosmetics rank 페이지에서만 실행할 수 있습니다.");
  if (collecting) throw new Error("이미 수집 중입니다. 완료 후 다시 누르세요.");
  collecting = true;
  let tab;
  try {
    tab = await chrome.tabs.create({
      url: "https://www.oliveyoung.co.kr/store/main/getBestList.do",
      active: false,
    });
    await waitForPage(tab.id);
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readWhenReady,
    });
    const capture = result[0]?.result;
    if (!capture?.rows || capture.rows.length !== 100)
      throw new Error("전체 랭킹 100개를 읽지 못했습니다.");
    await chrome.tabs.remove(tab.id).catch(() => {});
    return { capture };
  } catch (error) {
    if (tab?.id)
      await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    throw new Error(
      (error instanceof Error ? error.message : "수집 실패") +
        " 올리브영 화면이 정상 표시되는지 확인하고 다시 눌러주세요. 차단은 우회하지 않습니다.",
    );
  } finally {
    collecting = false;
  }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== "COLLECT_OVERALL") return false;
  if (!allowedSender(sender)) {
    reply({ error: "허용되지 않은 요청입니다." });
    return false;
  }
  collect(sender).then(reply, (error) => reply({ error: error.message }));
  return true;
});
