/**
 * 시간 인식(time awareness) 기능을 실제 며칠씩 기다리지 않고 테스트하기 위한 개발 전용 CLI.
 *
 * 실제 Message/store.json은 전혀 건드리지 않는다 — 별도의
 * .data/dev-interaction-override.json에만 기록되며, 채팅 기록에 표시되는 메시지
 * 타임스탬프는 그대로 유지된다(변경되는 것은 <time_awareness> 계산에 쓰이는 값뿐).
 * override 파일은 요청마다 새로 읽으므로 dev 서버 재시작이 필요 없다.
 *
 * 사용법:
 *   npx tsx scripts/dev-set-interaction-override.ts <characterId> <days> [hours] [minutes]
 *   npx tsx scripts/dev-set-interaction-override.ts <characterId> clear
 *
 * 예:
 *   npx tsx scripts/dev-set-interaction-override.ts tsundere 8 3 40
 *   npx tsx scripts/dev-set-interaction-override.ts tsundere clear
 */
import { setDevInteractionOverride } from "../lib/devInteractionOverride";

if (process.env.NODE_ENV === "production") {
  console.error("dev-set-interaction-override.ts는 개발 환경에서만 실행하세요.");
  process.exit(1);
}

const [characterId, arg2, arg3, arg4] = process.argv.slice(2);

if (!characterId || !arg2) {
  console.error(
    "사용법: npx tsx scripts/dev-set-interaction-override.ts <characterId> <days> [hours] [minutes]"
  );
  console.error("       npx tsx scripts/dev-set-interaction-override.ts <characterId> clear");
  process.exit(1);
}

if (arg2 === "clear") {
  setDevInteractionOverride(characterId, null);
  console.log(`[dev-interaction-override] ${characterId}의 override를 제거했습니다.`);
  process.exit(0);
}

const days = Number(arg2) || 0;
const hours = Number(arg3) || 0;
const minutes = Number(arg4) || 0;

const totalMs = (days * 24 * 60 + hours * 60 + minutes) * 60_000;
const overrideDate = new Date(Date.now() - totalMs);
const iso = overrideDate.toISOString();

setDevInteractionOverride(characterId, iso);

console.log(`[dev-interaction-override] ${characterId}의 lastInteractionAt을 override했습니다.`);
console.log(`  ${days}일 ${hours}시간 ${minutes}분 전 → ${iso}`);
console.log("  dev 서버 재시작 없이 바로 다음 채팅 요청부터 반영됩니다.");
