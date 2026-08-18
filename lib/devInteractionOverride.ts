import fs from "node:fs";
import path from "node:path";

/**
 * 개발 환경에서만 동작하는 lastInteractionAt override 레이어.
 *
 * 실제 채팅 기록(Message.createdAt, lib/store.ts의 store.messages)은 절대 건드리지
 * 않는다 — 시간 인식(time awareness) 기능을 실제 7일씩 기다리지 않고 테스트하기 위해,
 * "마치 마지막 대화가 N일 전이었던 것처럼" 별도 파일에만 가짜 값을 기록해두고, 앱은
 * 이 값을 실제 값 대신 참고만 한다.
 *
 * store.json과 완전히 분리된 별도 파일(.data/dev-interaction-override.json)을 쓰며,
 * lib/store.ts의 getStore()/__appStore 싱글턴과 전혀 무관하다 — 매 호출마다 파일을
 * 새로 읽으므로 dev 서버를 재시작하지 않아도 스크립트 실행 직후 바로 반영된다.
 *
 * production(NODE_ENV==="production")에서는 파일을 읽지도 쓰지도 않고 완전히
 * 비활성화된다. 앱의 API route나 클라이언트 코드는 이 모듈을 절대 import하면 안 되는
 * scripts/dev-set-interaction-override.ts 전용 쓰기 함수(setDevInteractionOverride)를
 * 제외하면, 읽기 함수(getDevInteractionOverride)만 app/api/chat/route.ts에서 사용한다.
 */

const isDev = process.env.NODE_ENV !== "production";
const OVERRIDE_FILE = path.join(process.cwd(), ".data", "dev-interaction-override.json");

type OverrideShape = Record<string, string>; // characterId -> ISO timestamp

/**
 * characterId의 개발용 override 시각(ISO)을 읽는다. override가 없거나, 파일이 없거나
 * 손상됐거나, production이면 null을 반환한다(= 실제 getLastUserMessageAt() 기준으로
 * 정상 동작하라는 신호).
 */
export function getDevInteractionOverride(characterId: string): string | null {
  if (!isDev) return null;
  try {
    const raw = fs.readFileSync(OVERRIDE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<OverrideShape>;
    return typeof parsed[characterId] === "string" ? parsed[characterId]! : null;
  } catch {
    return null;
  }
}

/**
 * scripts/dev-set-interaction-override.ts 전용 쓰기 함수. iso가 null이면 해당
 * characterId의 override를 제거한다(= clear). production에서는 아무 동작도 하지 않는다.
 */
export function setDevInteractionOverride(characterId: string, iso: string | null): void {
  if (!isDev) {
    console.error("[dev-interaction-override] production에서는 사용할 수 없습니다.");
    return;
  }
  fs.mkdirSync(path.dirname(OVERRIDE_FILE), { recursive: true });
  let current: OverrideShape = {};
  try {
    current = JSON.parse(fs.readFileSync(OVERRIDE_FILE, "utf-8"));
  } catch {
    current = {};
  }
  if (iso === null) {
    delete current[characterId];
  } else {
    current[characterId] = iso;
  }
  fs.writeFileSync(OVERRIDE_FILE, JSON.stringify(current, null, 2), "utf-8");
}
