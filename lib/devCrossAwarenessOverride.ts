import fs from "node:fs";
import path from "node:path";

/**
 * 개발 환경에서만 동작하는 Cross-Character Awareness override 레이어.
 * lib/devInteractionOverride.ts와 정확히 같은 패턴이다: store.json과 완전히 분리된 별도
 * 파일(.data/dev-cross-awareness-override.json)을 쓰고, 매 호출마다 파일을 새로 읽으며
 * (dev 서버 재시작 불필요), production(NODE_ENV==="production")에서는 파일을 읽지도
 * 쓰지도 않고 완전히 비활성화된다.
 *
 * 확률 기반 기능은 정상 흐름만으로는 재현 테스트가 어렵기 때문에, 이 override로 특정
 * characterId의 이번 턴 awareness를 강제로 켜고(forceOn) 원하면 source 캐릭터까지
 * 고정(sourceCharacterId)해 시나리오를 결정론적으로 재현한다. app/api/chat/route.ts만
 * 읽기 함수(getDevCrossAwarenessOverride)를 사용하며, scripts/dev-set-cross-awareness-
 * override.ts만 쓰기 함수(setDevCrossAwarenessOverride)를 사용한다.
 */

const isDev = process.env.NODE_ENV !== "production";
const OVERRIDE_FILE = path.join(
  process.cwd(),
  ".data",
  "dev-cross-awareness-override.json"
);

export interface CrossAwarenessOverrideEntry {
  forceOn: boolean;
  /** 지정하면 후보 풀을 이 characterId의 Memory로만 제한한다. */
  sourceCharacterId?: string;
}

type OverrideShape = Record<string, CrossAwarenessOverrideEntry>; // characterId -> entry

/**
 * characterId의 개발용 override를 읽는다. override가 없거나, 파일이 없거나 손상됐거나,
 * production이면 null을 반환한다(= 실제 확률 로직대로 정상 동작하라는 신호).
 */
export function getDevCrossAwarenessOverride(
  characterId: string
): CrossAwarenessOverrideEntry | null {
  if (!isDev) return null;
  try {
    const raw = fs.readFileSync(OVERRIDE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<OverrideShape>;
    const entry = parsed[characterId];
    if (!entry || typeof entry.forceOn !== "boolean") return null;
    return entry;
  } catch {
    return null;
  }
}

/**
 * scripts/dev-set-cross-awareness-override.ts 전용 쓰기 함수. entry가 null이면 해당
 * characterId의 override를 제거한다(= clear). production에서는 아무 동작도 하지 않는다.
 */
export function setDevCrossAwarenessOverride(
  characterId: string,
  entry: CrossAwarenessOverrideEntry | null
): void {
  if (!isDev) {
    console.error("[dev-cross-awareness-override] production에서는 사용할 수 없습니다.");
    return;
  }
  fs.mkdirSync(path.dirname(OVERRIDE_FILE), { recursive: true });
  let current: OverrideShape = {};
  try {
    current = JSON.parse(fs.readFileSync(OVERRIDE_FILE, "utf-8"));
  } catch {
    current = {};
  }
  if (entry === null) {
    delete current[characterId];
  } else {
    current[characterId] = entry;
  }
  fs.writeFileSync(OVERRIDE_FILE, JSON.stringify(current, null, 2), "utf-8");
}
