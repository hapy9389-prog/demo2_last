/**
 * lib/crossCharacterInteraction.ts의 순수 함수를 검증하는 스크립트. tsx로 직접 실행한다:
 * npm run test:cross-interaction
 *
 * 실 API 배선(app/api/chat/route.ts에서 실제로 A→B→A 순서로 채팅)은 이 스크립트로
 * 커버되지 않는다 — 이 기능은 순수 메시지 순서 기반 결정론적 로직이라 dev 환경에서
 * 실제 채팅만으로 즉시 재현 가능하므로 별도 dev override 스크립트는 만들지 않았다.
 */
import {
  buildCrossCharacterInteractionBlock,
  detectCrossCharacterInteraction,
  findMostRecentOtherCharacterUserMessage,
  isCrossCharacterInteractionDemoMode,
  isCrossCharacterInteractionEnabled,
} from "../lib/crossCharacterInteraction";
import { isCrossCharacterAwarenessEnabled } from "../lib/crossCharacterAwareness";
import { Message } from "../types";

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

function assertTrue(cond: boolean, label: string) {
  if (!cond) throw new Error(`${label}: expected true`);
}

function assertFalse(cond: boolean, label: string) {
  if (cond) throw new Error(`${label}: expected false`);
}

function msg(
  characterId: string,
  role: "user" | "assistant",
  createdAt: string,
  origin: Message["origin"] = "chat"
): Message {
  return {
    id: `${characterId}-${role}-${createdAt}`,
    characterId,
    role,
    content: `${characterId} ${role} message @ ${createdAt}`,
    origin,
    createdAt,
  };
}

// env를 임시로 바꿨다가 되돌리는 헬퍼 — 다른 테스트에 영향을 주지 않기 위함.
function withEnv(key: string, value: string | undefined, fn: () => void) {
  const original = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    fn();
  } finally {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
}

console.log("=== lib/crossCharacterInteraction.ts 단위 테스트 ===\n");

console.log("--- findMostRecentOtherCharacterUserMessage ---");
check("후보 없음 → null", () => {
  const result = findMostRecentOtherCharacterUserMessage("luna", [
    msg("luna", "user", "2026-08-18T10:00:00.000Z"),
  ]);
  assertEqual(result, null, "no-candidate");
});
check("후보 1건 → 해당 characterId 반환", () => {
  const result = findMostRecentOtherCharacterUserMessage("luna", [
    msg("kai", "user", "2026-08-18T10:05:00.000Z"),
  ]);
  assertEqual(result?.characterId, "kai", "single candidate");
});
check("여러 다른 캐릭터 혼재 시 createdAt 최댓값(가장 최근) 1건만 반환", () => {
  // 입력 순서를 일부러 뒤섞어도 성립해야 한다(reduce가 정렬 여부에 의존하지 않음).
  const result = findMostRecentOtherCharacterUserMessage("luna", [
    msg("haeun", "user", "2026-08-18T10:10:00.000Z"),
    msg("kai", "user", "2026-08-18T10:05:00.000Z"),
  ]);
  assertEqual(result?.characterId, "haeun", "most recent wins");
});
check("role=assistant인 다른 캐릭터 메시지는 후보 제외(리마인더 발화 오탐 방지)", () => {
  const result = findMostRecentOtherCharacterUserMessage("luna", [
    msg("kai", "assistant", "2026-08-18T10:05:00.000Z", "reminder"),
  ]);
  assertEqual(result, null, "assistant-excluded");
});
check("자기 자신(characterId 동일) 메시지는 후보 제외", () => {
  const result = findMostRecentOtherCharacterUserMessage("luna", [
    msg("luna", "user", "2026-08-18T10:05:00.000Z"),
  ]);
  assertEqual(result, null, "self-excluded");
});

console.log("\n--- detectCrossCharacterInteraction: 첫 대화(Case 4) ---");
check("lastOwnUserMessageAtISO=null이면 메시지 배열과 무관하게 항상 null", () => {
  const result = detectCrossCharacterInteraction("luna", null, [
    msg("kai", "user", "2026-08-18T10:05:00.000Z"),
  ]);
  assertEqual(result, null, "first-conversation");
});

console.log("\n--- CLAUDE.md Case 1~5 시뮬레이션 ---");

check("Case 1: 루나 → 루나 → context 없음", () => {
  // T1: luna 첫 대화(L1). T2: luna에게 두 번째 메시지(L2) 보내기 직전 판정.
  const lastOwn = "2026-08-18T10:00:00.000Z"; // L1 createdAt
  const since = [msg("luna", "user", lastOwn)]; // getMessagesSince(L1 이후)는 L1 자신뿐
  const result = detectCrossCharacterInteraction("luna", lastOwn, since);
  assertEqual(result, null, "same-character-consecutive");
});

check("Case 2: 루나 → 카이 → 루나 → '카이' 감지", () => {
  const t1 = "2026-08-18T10:00:00.000Z"; // L1(루나 첫 메시지)
  const t2 = "2026-08-18T10:05:00.000Z"; // K1(카이 메시지)
  // T3(루나 복귀) 판정 시점: lastOwnUserMessageAtISO는 아직 t1(L2는 아직 저장 전)
  const since = [msg("kai", "user", t2)]; // getMessagesSince(t1) 결과
  const result = detectCrossCharacterInteraction("luna", t1, since);
  assertEqual(result?.characterId, "kai", "detected-kai");
});

check("Case 3: 루나 → 카이 → 하은 → 루나 → 가장 최근인 '하은'만 감지", () => {
  const t1 = "2026-08-18T10:00:00.000Z"; // L1
  const t2 = "2026-08-18T10:05:00.000Z"; // K1(카이)
  const t3 = "2026-08-18T10:10:00.000Z"; // H1(하은)
  const since = [msg("kai", "user", t2), msg("haeun", "user", t3)];
  const result = detectCrossCharacterInteraction("luna", t1, since);
  assertEqual(result?.characterId, "haeun", "most-recent-only");
});

check("Case 5: 루나 → 카이 → 루나 → 루나 → 루나, 복귀 이후 반복 주입 안 됨", () => {
  const t1 = "2026-08-18T10:00:00.000Z"; // L1(루나 T1)
  const t2 = "2026-08-18T10:05:00.000Z"; // K1(카이 T2)
  const t3 = "2026-08-18T10:10:00.000Z"; // L2(루나 T3 자신의 메시지)
  const t4 = "2026-08-18T10:15:00.000Z"; // L3(루나 T4 자신의 메시지)

  // T3 판정: lastOwnUserMessageAtISO=t1(L2는 아직 저장 전), t1 이후 메시지 중 kai(t2) 존재.
  const sinceForT3 = [msg("kai", "user", t2)];
  const t3Result = detectCrossCharacterInteraction("luna", t1, sinceForT3);
  assertEqual(t3Result?.characterId, "kai", "T3-detected");

  // T3에서 L2(@t3)가 저장된 뒤 T4 판정: lastOwnUserMessageAtISO=t3로 갱신됨.
  // t3 이후 다른 캐릭터 메시지가 없으므로 감지되지 않아야 한다.
  const sinceForT4: Message[] = [];
  const t4Result = detectCrossCharacterInteraction("luna", t3, sinceForT4);
  assertEqual(t4Result, null, "T4-not-repeated");

  // T4에서 L3(@t4)가 저장된 뒤 T5 판정도 마찬가지.
  const sinceForT5: Message[] = [];
  const t5Result = detectCrossCharacterInteraction("luna", t4, sinceForT5);
  assertEqual(t5Result, null, "T5-not-repeated");
});

console.log("\n--- buildCrossCharacterInteractionBlock: 형식 확인 ---");
check("일반 모드(demoMode=false): 선택적 언급 문구, 내용 모름 원칙 포함", () => {
  const block = buildCrossCharacterInteractionBlock("카이", false);
  assertTrue(block.includes("<cross_character_interaction>"), "has open tag");
  assertTrue(block.includes("</cross_character_interaction>"), "has close tag");
  assertTrue(block.includes("카이"), "has other character name");
  assertTrue(block.includes("반드시 언급할 필요는 없습니다"), "has optional-mention rule");
  assertTrue(block.includes("내용은 알 수 없습니다"), "has content-unknown rule");
  assertFalse(block.includes("[데모 모드]"), "no demo-mode marker in normal mode");
});
check("데모 모드(demoMode=true): 강제 언급 문구 포함, 선택적 문구는 미포함", () => {
  const block = buildCrossCharacterInteractionBlock("카이", true);
  assertTrue(block.includes("[데모 모드]"), "has demo-mode marker");
  assertTrue(block.includes("반드시 한 번은"), "has mandatory-mention rule");
  assertFalse(block.includes("반드시 언급할 필요는 없습니다"), "optional rule must not leak in");
  // 데모 모드에서도 "내용을 아는 척하지 말라"는 원칙은 동일하게 유지되어야 한다.
  assertTrue(block.includes("내용은 알 수 없습니다"), "content-unknown rule still present");
});

console.log("\n--- on/off 플래그: 기본값 및 파싱 ---");
check("isCrossCharacterInteractionEnabled: 미설정이면 true", () => {
  withEnv("CROSS_CHARACTER_INTERACTION_ENABLED", undefined, () => {
    assertEqual(isCrossCharacterInteractionEnabled(), true, "default-on");
  });
});
check('isCrossCharacterInteractionEnabled: "false"일 때만 false', () => {
  withEnv("CROSS_CHARACTER_INTERACTION_ENABLED", "false", () => {
    assertEqual(isCrossCharacterInteractionEnabled(), false, "explicit-off");
  });
  withEnv("CROSS_CHARACTER_INTERACTION_ENABLED", "true", () => {
    assertEqual(isCrossCharacterInteractionEnabled(), true, "explicit-on");
  });
});
check("isCrossCharacterInteractionDemoMode: 미설정이면 false", () => {
  withEnv("CROSS_CHARACTER_INTERACTION_DEMO_MODE", undefined, () => {
    assertEqual(isCrossCharacterInteractionDemoMode(), false, "default-off");
  });
});
check('isCrossCharacterInteractionDemoMode: "true"일 때만 true', () => {
  withEnv("CROSS_CHARACTER_INTERACTION_DEMO_MODE", "true", () => {
    assertEqual(isCrossCharacterInteractionDemoMode(), true, "explicit-on");
  });
  withEnv("CROSS_CHARACTER_INTERACTION_DEMO_MODE", "yes", () => {
    assertEqual(isCrossCharacterInteractionDemoMode(), false, "non-true-value-off");
  });
});
check(
  "isCrossCharacterAwarenessEnabled(기존 Memory 기반 기능, lib/crossCharacterAwareness.ts): " +
    "미설정이면 true, 명시적 false만 false — 신규 기능과 완전히 독립된 별도 env",
  () => {
    withEnv("CROSS_CHARACTER_AWARENESS_ENABLED", undefined, () => {
      assertEqual(isCrossCharacterAwarenessEnabled(), true, "default-on");
    });
    withEnv("CROSS_CHARACTER_AWARENESS_ENABLED", "false", () => {
      assertEqual(isCrossCharacterAwarenessEnabled(), false, "explicit-off");
    });
  }
);

console.log(`\n=== 결과: ${passCount}개 통과 / ${failCount}개 실패 ===`);
if (failCount > 0) {
  process.exit(1);
}
