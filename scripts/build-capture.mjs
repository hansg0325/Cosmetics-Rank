import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";
const source = ts.transpileModule(
  readFileSync("src/client/capture.ts", "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { captureRanking } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
writeFileSync(
  "extension/capture-function.js",
  `// Generated from src/client/capture.ts; do not edit.\nexport async function readWhenReady(){\nconst capture=${captureRanking.toString()};\nreturn new Promise((resolve,reject)=>{\nlet observer;let timer;\nfunction finish(error,result){observer?.disconnect();clearTimeout(timer);if(error)reject(error);else resolve(result);}\nfunction attempt(){try{const result=capture(document,location.href,new Date().toISOString());finish(null,result);return true;}catch{return false;}}\nif(attempt())return;\nobserver=new MutationObserver(attempt);observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,characterData:true});\ntimer=setTimeout(()=>finish(new Error('전체 랭킹이 표시되지 않습니다. 접속 확인이나 페이지 구조를 확인하세요.')),15000);\n});}\n`,
);
const code = `javascript:(()=>{try{const capture=${captureRanking.toString()};const result=capture(document,location.href,new Date().toISOString());const blob=new Blob([JSON.stringify(result,null,2)],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='oliveyoung-overall-'+result.ranking_date+'.json';a.click();URL.revokeObjectURL(url);}catch(error){alert(error.message);}})();`;
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OliveRank 실제 랭킹 가져오기</title><style>body{font:16px system-ui,sans-serif;max-width:720px;margin:50px auto;padding:20px;color:#28332b;line-height:1.9}a{color:#547b2b}#capture{display:inline-block;background:#6e8e42;color:white;padding:12px 24px;border-radius:8px;text-decoration:none}li{margin:12px 0}</style><h1>실제 전체 랭킹 가져오기</h1><p>현재 열린 화면의 100개 상품 정보만 JSON으로 저장합니다. 가격·이미지·추적 파라미터는 포함하지 않습니다. 추가 페이지 요청이나 자동 반복은 없습니다.</p><ol><li>아래 버튼을 브라우저 북마크바로 끌어 놓아 저장하세요.</li><li><a href="https://www.oliveyoung.co.kr/store/main/getBestList.do" target="_blank" rel="noopener">올리브영 랭킹</a>을 열고 ‘전체’를 선택합니다. 접속 확인이 표시되면 정상적으로 완료되어 목록이 나올 때까지 기다립니다.</li><li>상품 100개가 표시된 상태에서 저장한 북마크를 누릅니다.</li><li>다운로드한 JSON을 OliveRank의 ‘가져오기’에서 선택하고 저장합니다.</li></ol><a id="capture" href="#">OliveRank 전체 랭킹 저장</a><p>이 페이지에서 버튼을 누르면 랭킹 페이지 안내가 나옵니다. 북마크바에 저장한 뒤 올리브영 페이지에서 실행하세요. 모바일·브라우저 보안 설정에 따라 북마크 실행이 지원되지 않을 수 있습니다.</p><p>연속 순위 100개·고유 상품 ID를 검증하며 다른 카테고리나 불완전한 화면은 거부합니다. 차단 회피나 예약 수집 기능은 제공하지 않습니다.</p><a href="/">← OliveRank 돌아가기</a><script>document.getElementById('capture').href=${JSON.stringify(code).replaceAll("<", "\\u003c")};</script></html>`;
writeFileSync("public/capture.html", html);
console.log("public/capture.html 생성 완료");
