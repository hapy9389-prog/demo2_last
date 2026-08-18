/**
 * lib/interactionTime.ts의 순수 함수(calculateInteractionGap/getInteractionRelevanceTier/
 * formatElapsedKorean)를 검증하는 스크립트. tsx로 직접 실행한다: npm run test:interaction-time
 *
 * G(캐릭터별 독립성)/H(순서 보장)는 store.ts/route.ts 통합 영역이라 순수 함수 테스트로
 * 커버할 수 없다 — lib/store.ts의 getLastUserMessageAt() characterId 필터, 그리고
 * app/api/chat/route.ts의 getLastUserMessageAt → addMessage 순서(주석으로 명시)로 코드
 * 검토 확인 + 실제 앱에서 scripts/dev-set-interaction-override.ts로 수동 확인한다.
 */
import {
  EXTREMELY_LONG_THRESHOLD_MINUTES,
  InteractionGap,
  InteractionRelevanceTier,
  LIGHT_THRESHOLD_MINUTES,
  LONG_ABSENCE_THRESHOLD_MINUTES,
  NONE_THRESHOLD_MINUTES,
  NOTABLE_THRESHOLD_MINUTES,
  SEVERAL_DAYS_THRESHOLD_MINUTES,
  calculateInteractionGap,
  formatElapsedKorean,
  getInteractionRelevanceTier,
} from "../lib/interactionTime";

let passCount = 0;
let failCount = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passCount++;
    console.log(`  ok  - ${name}`);
  } catch (err) {
    failCount++;
    console.error(`FAIL  - ${name}`);
    console.error(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const NOW = new Date(2026, 7, 14, 21, 30, 0, 0); // 2026-08-14 21:30:00 (KST 가정)

function minutesAgo(m: number): Date {
  return new Date(NOW.getTime() - m * 60_000);
}

function checkGapAndTier(
  name: string,
  last: Date,
  expected: Partial<InteractionGap> & { tier: InteractionRelevanceTier }
) {
  check(name, () => {
    const gap = calculateInteractionGap(last, NOW);
    if (expected.totalMinutes !== undefined) {
      assertEqual(gap.totalMinutes, expected.totalMinutes, "totalMinutes");
    }
    if (expected.days !== undefined) assertEqual(gap.days, expected.days, "days");
    if (expected.hours !== undefined) assertEqual(gap.hours, expected.hours, "hours");
    if (expected.minutes !== undefined) assertEqual(gap.minutes, expected.minutes, "minutes");
    assertEqual(getInteractionRelevanceTier(gap), expected.tier, "tier");
  });
}

console.log("=== lib/interactionTime.ts 단위 테스트 ===\n");

console.log("--- A~F: 스펙 케이스 ---");
checkGapAndTier("A. 10분 전 → 30분 미만(none)", minutesAgo(10), {
  totalMinutes: 10,
  tier: "none",
});
checkGapAndTier("B. 3시간 전 → 30분~6시간(light)", minutesAgo(3 * 60), {
  totalMinutes: 180,
  tier: "light",
});
checkGapAndTier("C. 12시간 전 → 6~24시간(notable)", minutesAgo(12 * 60), {
  totalMinutes: 720,
  tier: "notable",
});
checkGapAndTier("D. 2일 전 → 1~3일(several_days)", minutesAgo(2 * 24 * 60), {
  totalMinutes: 2880,
  tier: "several_days",
});
checkGapAndTier("E. 5일 전 → 3~7일(long)", minutesAgo(5 * 24 * 60), {
  totalMinutes: 7200,
  tier: "long",
});
checkGapAndTier("F. 8일 3시간 40분 전 → 7~30일(very_long), days/hours/minutes 정확히", minutesAgo(8 * 24 * 60 + 3 * 60 + 40), {
  totalMinutes: 11740,
  days: 8,
  hours: 3,
  minutes: 40,
  tier: "very_long",
});
checkGapAndTier("G. 35일 전 → 30일 이상(extremely_long)", minutesAgo(35 * 24 * 60), {
  totalMinutes: 35 * 24 * 60,
  days: 35,
  tier: "extremely_long",
});

console.log("\n--- 8일 vs 30일: 서로 다른 tier여야 한다(반응 강도 차이의 전제) ---");
check("8일 전과 30일 전은 서로 다른 tier(very_long vs extremely_long)", () => {
  const eightDays = getInteractionRelevanceTier(calculateInteractionGap(minutesAgo(8 * 24 * 60), NOW));
  const thirtyDays = getInteractionRelevanceTier(calculateInteractionGap(minutesAgo(30 * 24 * 60), NOW));
  assertEqual(eightDays, "very_long", "8일 tier");
  assertEqual(thirtyDays, "extremely_long", "30일 tier");
  if (eightDays === thirtyDays) {
    throw new Error("8일과 30일의 tier가 같으면 안 됨(반응 강도가 벌어지지 않음)");
  }
});

console.log("\n--- 경계값 쌍(off-by-one 방지) ---");
const boundaries: Array<[number, InteractionRelevanceTier, InteractionRelevanceTier]> = [
  [NONE_THRESHOLD_MINUTES, "none", "light"],
  [LIGHT_THRESHOLD_MINUTES, "light", "notable"],
  [NOTABLE_THRESHOLD_MINUTES, "notable", "several_days"],
  [SEVERAL_DAYS_THRESHOLD_MINUTES, "several_days", "long"],
  [LONG_ABSENCE_THRESHOLD_MINUTES, "long", "very_long"],
  [EXTREMELY_LONG_THRESHOLD_MINUTES, "very_long", "extremely_long"],
];
for (const [threshold, beforeTier, atTier] of boundaries) {
  checkGapAndTier(`${threshold - 1}분 전(경계 -1) → ${beforeTier}`, minutesAgo(threshold - 1), {
    tier: beforeTier,
  });
  checkGapAndTier(`${threshold}분 전(경계) → ${atTier}`, minutesAgo(threshold), {
    tier: atTier,
  });
}

console.log("\n--- formatElapsedKorean: 0-생략 포맷팅 ---");
check("days=0이면 일 단위 생략", () => {
  assertEqual(
    formatElapsedKorean({ totalMinutes: 220, days: 0, hours: 3, minutes: 40 }),
    "3시간 40분",
    "포맷"
  );
});
check("hours=0이면 시간 단위 생략", () => {
  assertEqual(
    formatElapsedKorean({ totalMinutes: 11560, days: 8, hours: 0, minutes: 40 }),
    "8일 40분",
    "포맷"
  );
});
check("모든 단위가 있으면 전부 표시", () => {
  assertEqual(
    formatElapsedKorean({ totalMinutes: 11740, days: 8, hours: 3, minutes: 40 }),
    "8일 3시간 40분",
    "포맷"
  );
});
check("전부 0이면 '0분'으로 폴백", () => {
  assertEqual(
    formatElapsedKorean({ totalMinutes: 0, days: 0, hours: 0, minutes: 0 }),
    "0분",
    "포맷"
  );
});

console.log("\n--- 음수 gap 방어(clamp) ---");
check("now가 lastInteractionAt보다 과거 → totalMinutes=0으로 clamp", () => {
  const future = new Date(NOW.getTime() + 60 * 60_000); // NOW보다 1시간 미래
  const gap = calculateInteractionGap(future, NOW);
  assertEqual(gap.totalMinutes, 0, "totalMinutes");
  assertEqual(gap.days, 0, "days");
  assertEqual(gap.hours, 0, "hours");
  assertEqual(gap.minutes, 0, "minutes");
});

console.log(`\n=== 결과: ${passCount}개 통과 / ${failCount}개 실패 ===`);
console.log(
  "\nG(캐릭터별 독립성)/H(순서 보장)는 이 스크립트로 커버되지 않습니다 — " +
    "lib/store.ts의 getLastUserMessageAt() characterId 필터 및 " +
    "app/api/chat/route.ts의 실행 순서 주석으로 코드 검토 확인, " +
    "scripts/dev-set-interaction-override.ts로 수동 확인하세요."
);
if (failCount > 0) {
  process.exit(1);
}
