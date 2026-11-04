import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
if (!existsSync(".dev.vars")) {
  writeFileSync(
    ".dev.vars",
    `LOCAL_DEV_TOKEN=${randomBytes(24).toString("hex")}\n`,
  );
  console.log(
    ".dev.vars 생성 완료. 로컬 로그인에는 이 파일의 토큰을 사용하세요.",
  );
} else console.log("기존 .dev.vars 유지");
