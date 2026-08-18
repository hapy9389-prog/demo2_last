/**
 * lib/crossCharacterAwareness.ts의 순수 함수를 검증하는 스크립트. tsx로 직접 실행한다:
 * npm run test:cross-awareness
 *
 * 실 API 배선(app/api/chat/route.ts에서 dev override로 강제 ON 후 실제 대화 확인)은 이
 * 스크립트로 커버되지 않는다 — scripts/dev-set-cross-awareness-override.ts로 수동 확인.
 */
import {
  MIN_CROSS_AWARENESS_IMPORTANCE,
  buildCrossCharacterAwarenessBlock,
  getCrossCharacterCandidates,
  isConservativelySafe,
  pickCrossCharacterCandidate,
  shouldUseCrossCharacterAwareness,
} from "../lib/crossCharacterAwareness";
import { getMemoriesExcludingCharacter } from "../lib/memoryStore";
import { CharacterMemory } from "../types";

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

console.log("=== lib/crossCharacterAwareness.ts 단위 테스트 ===\n");

console.log("--- shouldUseCrossCharacterAwareness ---");
check("rand()=0 → chance>0이면 항상 true", () => {
  assertEqual(shouldUseCrossCharacterAwareness(0.25, () => 0), true, "hit");
});
check("rand()=0.999 → chance=0.25면 false", () => {
  assertEqual(shouldUseCrossCharacterAwareness(0.25, () => 0.999), false, "hit");
});
check("chance=0이면 rand()가 무엇을 반환해도 항상 false(기본값 0 = off 보장)", () => {
  assertEqual(shouldUseCrossCharacterAwareness(0, () => 0), false, "hit-at-zero");
});

console.log("\n--- pickCrossCharacterCandidate: 상위 K개 밖은 절대 고르지 않음 ---");
function makeMemory(id: string, characterId: string, importance: number, updatedAt: string): CharacterMemory {
  return {
    id,
    characterId,
    content: `memory-${id}`,
    importance,
    source: { type: "chat", refId: "x" },
    createdAt: updatedAt,
    updatedAt,
    lastUsedAt: null,
    useCount: 0,
    deletedAt: null,
  };
}
const rankedCandidates = [
  makeMemory("1", "yandere", 5, "2026-08-16T00:00:00.000Z"),
  makeMemory("2", "yandere", 4, "2026-08-15T00:00:00.000Z"),
  makeMemory("3", "mina", 4, "2026-08-14T00:00:00.000Z"),
  makeMemory("4", "sera", 3, "2026-08-13T00:00:00.000Z"), // 상위 3개 밖(TOP_K=3)
];
check("여러 번 뽑아도 항상 상위 3개(id 1~3) 안에서만 나옴", () => {
  for (let i = 0; i < 50; i++) {
    const picked = pickCrossCharacterCandidate(rankedCandidates, () => i / 50);
    assertTrue(picked !== null, "picked not null");
    assertTrue(["1", "2", "3"].includes(picked!.id), `picked id ${picked!.id} should be in top-3`);
  }
});
check("빈 배열이면 null", () => {
  assertEqual(pickCrossCharacterCandidate([], () => 0), null, "empty pick");
});
check("rand()=0 → 정렬 1순위(id=1)를 고름", () => {
  const picked = pickCrossCharacterCandidate(rankedCandidates, () => 0);
  assertEqual(picked?.id, "1", "picked id");
});

console.log("\n--- buildCrossCharacterAwarenessBlock: 형식 확인 ---");
check("소스 이름과 content가 블록에 포함됨", () => {
  const block = buildCrossCharacterAwarenessBlock("유이", "사용자는 취업 준비 중이다.");
  assertTrue(block.includes("<cross_character_awareness>"), "has open tag");
  assertTrue(block.includes("</cross_character_awareness>"), "has close tag");
  assertTrue(block.includes("유이"), "has source name");
  assertTrue(block.includes("사용자는 취업 준비 중이다."), "has content");
  assertTrue(block.includes("정확한 대화 기록이 아닙니다"), "has no-exact-log rule");
  assertTrue(block.includes("반드시 언급할 필요는 없습니다"), "has optional-mention rule");
});

console.log("\n--- isConservativelySafe: 키워드 필터 ---");
check("정상 문자열은 통과", () => {
  assertEqual(isConservativelySafe("사용자는 요즘 취업 준비 때문에 스트레스를 받는다."), true, "safe");
});
check("비밀 요청 문구가 남아있으면 제외", () => {
  assertEqual(isConservativelySafe("이건 비밀인데 사용자는 이직을 고민 중이다."), false, "secret");
  assertEqual(isConservativelySafe("다른 사람한테는 말하지 마."), false, "dont-tell");
  assertEqual(isConservativelySafe("이건 너한테만 말하는 거야."), false, "only-you");
});
check("민감 카테고리 키워드가 남아있으면 제외", () => {
  assertEqual(isConservativelySafe("사용자의 전화번호는 010-1234-5678이다."), false, "phone");
  assertEqual(isConservativelySafe("사용자는 최근 병원에서 진단을 받았다."), false, "health");
});

console.log("\n--- MIN_CROSS_AWARENESS_IMPORTANCE 상수 확인 ---");
check("현재 값은 3", () => {
  assertEqual(MIN_CROSS_AWARENESS_IMPORTANCE, 3, "constant");
});

console.log(
  "\n--- getCrossCharacterCandidates: 실제 store 연동(§10 자기 자신 제외/importance " +
    "하한/정렬) — 통합 성격이 강해 값 자체보다 '깨지지 않고 배열을 반환하는지'만 " +
    "가볍게 확인 ---"
);
check("임의 characterId로 호출해도 예외 없이 배열 반환, 자기 자신은 절대 포함 안 됨", () => {
  const candidates = getCrossCharacterCandidates("tsundere");
  assertTrue(Array.isArray(candidates), "is array");
  for (const c of candidates) {
    assertTrue(c.characterId !== "tsundere", `candidate ${c.id} must not be tsundere's own memory`);
    assertTrue(c.importance >= MIN_CROSS_AWARENESS_IMPORTANCE, `candidate ${c.id} importance too low`);
  }
  // 정렬 확인(있다면): importance desc, 동점이면 updatedAt desc
  for (let i = 1; i < candidates.length; i++) {
    const prev = candidates[i - 1];
    const cur = candidates[i];
    assertTrue(
      prev.importance > cur.importance ||
        (prev.importance === cur.importance && prev.updatedAt >= cur.updatedAt),
      `sort order broken at index ${i}`
    );
  }
});
check("getMemoriesExcludingCharacter도 자기 자신을 절대 포함하지 않음", () => {
  const all = getMemoriesExcludingCharacter("luna");
  for (const m of all) {
    assertTrue(m.characterId !== "luna", `must exclude luna, got ${m.id}`);
    assertTrue(m.deletedAt === null, `must exclude soft-deleted, got ${m.id}`);
  }
});

console.log(`\n=== 결과: ${passCount}개 통과 / ${failCount}개 실패 ===`);
console.log(
  "\n비밀/민감정보 키워드 필터의 완전성은 이 스크립트로 검증할 수 없습니다 — " +
    "구조적으로 결정론적 보장이 불가능하다는 한계는 lib/crossCharacterAwareness.ts의 " +
    "주석과 plan 문서에 명시돼 있습니다. 실제 대화 시나리오 확인은 " +
    "scripts/dev-set-cross-awareness-override.ts로 수동 진행하세요."
);
if (failCount > 0) {
  process.exit(1);
}
