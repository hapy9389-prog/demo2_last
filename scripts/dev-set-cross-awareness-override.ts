/**
 * Cross-Character Awareness(캐릭터 간 간접 인지) 기능을 확률에 기대지 않고 결정론적으로
 * 재현하기 위한 개발 전용 CLI.
 *
 * 실제 확률 로직/Character 설정은 전혀 건드리지 않는다 — 별도의
 * .data/dev-cross-awareness-override.json에만 기록되며, 요청마다 새로 읽으므로 dev
 * 서버 재시작이 필요 없다.
 *
 * 사용법:
 *   npx tsx scripts/dev-set-cross-awareness-override.ts <characterId> on [sourceCharacterId]
 *   npx tsx scripts/dev-set-cross-awareness-override.ts <characterId> clear
 *
 * 예:
 *   npx tsx scripts/dev-set-cross-awareness-override.ts tsundere on yandere
 *     → 레이(tsundere) 턴에서 확률 롤을 건너뛰고 항상 켜지며, 후보 풀을 유이(yandere)의
 *       Memory로만 제한한다.
 *   npx tsx scripts/dev-set-cross-awareness-override.ts tsundere on
 *     → 레이 턴에서 항상 켜지지만 후보 풀은 제한하지 않는다(모든 다른 캐릭터 대상).
 *   npx tsx scripts/dev-set-cross-awareness-override.ts tsundere clear
 */
import { setDevCrossAwarenessOverride } from "../lib/devCrossAwarenessOverride";

if (process.env.NODE_ENV === "production") {
  console.error("dev-set-cross-awareness-override.ts는 개발 환경에서만 실행하세요.");
  process.exit(1);
}

const [characterId, mode, sourceCharacterId] = process.argv.slice(2);

if (!characterId || !mode || (mode !== "on" && mode !== "clear")) {
  console.error(
    "사용법: npx tsx scripts/dev-set-cross-awareness-override.ts <characterId> on [sourceCharacterId]"
  );
  console.error("       npx tsx scripts/dev-set-cross-awareness-override.ts <characterId> clear");
  process.exit(1);
}

if (mode === "clear") {
  setDevCrossAwarenessOverride(characterId, null);
  console.log(`[dev-cross-awareness-override] ${characterId}의 override를 제거했습니다.`);
  process.exit(0);
}

setDevCrossAwarenessOverride(characterId, {
  forceOn: true,
  ...(sourceCharacterId ? { sourceCharacterId } : {}),
});

console.log(`[dev-cross-awareness-override] ${characterId}의 awareness를 강제 ON했습니다.`);
if (sourceCharacterId) {
  console.log(`  후보 풀을 "${sourceCharacterId}"의 Memory로만 제한합니다.`);
} else {
  console.log("  후보 풀은 제한하지 않습니다(모든 다른 캐릭터 대상).");
}
console.log("  dev 서버 재시작 없이 바로 다음 채팅 요청부터 반영됩니다.");
