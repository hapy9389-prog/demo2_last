import { getMemoriesExcludingCharacter } from "./memoryStore";
import { CharacterMemory } from "@/types";

// Cross-Character Awareness(캐릭터 간 간접 인지) 전용 순수 로직. Chat Mode에서만 쓰인다
// (app/api/chat/route.ts가 chatWithCharacter() 호출 전에 이 모듈로 이번 턴 사용 여부와
// context를 결정한다). Story Mode(lib/storyPrompt.ts, lib/storyClaude.ts, app/api/story/*)
// 와 proactive Reminder(lib/claude.ts의 fireReminderMessage(), lib/scheduler.ts)는 이
// 모듈을 전혀 import하지 않는다.
//
// 이 모듈은 persistent Shared Memory(lib/memoryStore.ts)를 다른 Character의 Shared
// Memory로 "복사"하지 않는다 — getMemoriesExcludingCharacter()로 조회한 결과를 이번 턴
// 한정 prompt 문자열로만 가공해 반환할 뿐, 어떤 upsert/저장도 하지 않는다.

/**
 * 후보로 삼기에 너무 사소한 Memory를 거른다. §1의 "중요한 정보 일부만" 목표에 맞춰
 * 낮은 importance는 애초에 후보에서 제외한다(단순 상수 비교 — 복잡한 튜닝 없음).
 */
export const MIN_CROSS_AWARENESS_IMPORTANCE = 3;

/** 상위 몇 개 후보 중에서 무작위로 고를지. §8(반복 언급 완화)의 유일한 장치 중 하나. */
const TOP_K = 3;

// ---------- 비밀/민감정보 키워드 필터 (결정론적이지만 불완전 — 아래 경고 참고) ----------
//
// ⚠️ 구조적 한계: 이 필터는 원본 대화가 아니라 이미 추출·정제된 CharacterMemory.content
// 문자열만 검사한다. lib/memoryClaude.ts의 extraction이 "사용자는 요즘 취업 준비
// 중이다"처럼 요약하는 과정에서 원문의 "이건 비밀인데" 같은 비밀 요청 문구 자체를
// 자연스럽게 생략하면, 그 사실이 원래 비밀 요청과 함께 나왔었다는 정보는 저장된 문자열
// 어디에도 남지 않는다 — 이 필터는 그런 경우를 원리적으로 감지할 수 없다. 즉 이 필터는
// "content 문자열에 우연히 비밀/민감 관련 단어가 남아있는 경우"만 걸러내는 2차 방어선일
// 뿐, 완전한 privacy boundary가 아니다. 1차 방어선은 lib/memoryClaude.ts의
// MEMORY_SAFETY_RULES(추출 시점, 무수정 재사용)이고, 그마저 놓치면 이 필터도 만회하지
// 못한다. 향후 개선: extraction 시점에 CharacterMemory에 shareable/private 같은
// 메타데이터를 함께 저장하도록 스키마를 확장하면(types/index.ts + lib/memoryClaude.ts
// 동시 수정 필요, 이번 MVP 범위 밖) 결정론적으로 판별할 수 있게 된다.
const SECRECY_KEYWORDS = [
  "비밀",
  "말하지 마",
  "말하지마",
  "아무한테도",
  "너한테만",
  "혼자만 알고",
  "얘기하지 마",
  "얘기하지마",
];
const SENSITIVE_TOPIC_KEYWORDS = [
  "주소",
  "전화번호",
  "연락처",
  "계좌",
  "계좌번호",
  "비밀번호",
  "카드번호",
  "주민등록번호",
  "질병",
  "병원",
  "진단",
];
const UNSAFE_KEYWORDS = [...SECRECY_KEYWORDS, ...SENSITIVE_TOPIC_KEYWORDS];

/**
 * content에 위 키워드가 하나라도 포함되면 후보에서 제외한다. non-exhaustive, 우회
 * 가능(위 주석 참고) — export하는 이유는 단위 테스트(scripts/test-cross-character-
 * awareness.ts)에서 store 연동 없이 이 필터 자체의 동작만 독립적으로 검증하기 위함이다.
 */
export function isConservativelySafe(content: string): boolean {
  return !UNSAFE_KEYWORDS.some((kw) => content.includes(kw));
}

/**
 * 다른 Character의 활성 Memory 중 Cross-Character 후보 자격이 있는 것만 골라, importance
 * desc → updatedAt desc로 정렬해 반환한다(벡터/임베딩 없이 GET /api/memories와 같은
 * 정렬 idiom 재사용). currentCharacterId 자신의 Memory는 getMemoriesExcludingCharacter()
 * 단계에서 이미 제외된다.
 */
export function getCrossCharacterCandidates(currentCharacterId: string): CharacterMemory[] {
  return getMemoriesExcludingCharacter(currentCharacterId)
    .filter((m) => m.importance >= MIN_CROSS_AWARENESS_IMPORTANCE)
    .filter((m) => isConservativelySafe(m.content))
    .sort((a, b) =>
      b.importance !== a.importance
        ? b.importance - a.importance
        : b.updatedAt.localeCompare(a.updatedAt)
    );
}

/**
 * 정렬된 후보 중 상위 TOP_K개에서 무작위로 1개만 고른다(§8: 매번 1위만 고르면 같은
 * 사실이 반복 언급될 위험이 커서 소폭의 무작위성으로 완화 — 완전한 반복 방지는 아니다).
 * 후보가 없으면 null.
 */
export function pickCrossCharacterCandidate(
  candidates: CharacterMemory[],
  rand: () => number = Math.random
): CharacterMemory | null {
  if (candidates.length === 0) return null;
  const pool = candidates.slice(0, TOP_K);
  const index = Math.floor(rand() * pool.length);
  // rand()가 이론상 1을 반환할 일은 없지만(Math.random 계약), 방어적으로 clamp한다.
  return pool[Math.min(index, pool.length - 1)];
}

/**
 * 이번 턴 Cross-Character Awareness를 사용할지 결정하는 순수 함수. `rand`를 주입 가능하게
 * 해 결정론적 단위 테스트를 지원한다(§7).
 */
export function shouldUseCrossCharacterAwareness(
  chance: number,
  rand: () => number = Math.random
): boolean {
  return rand() < chance;
}

/**
 * Claude system prompt에 이어붙일 `<cross_character_awareness>` 블록을 만든다. 정확한
 * 로그/시간/문장을 아는 것처럼 말하지 말라는 규칙, 자연스럽고 다양한 표현 유도, 반드시
 * 언급할 필요 없음, 캐릭터 성격 우선을 한 블록에 담는다(§F/§11/§13/§14/§6-2차 방어선).
 */
export function buildCrossCharacterAwarenessBlock(
  sourceCharacterName: string,
  content: string
): string {
  return `
<cross_character_awareness>
아래 정보는 당신이 직접 겪은 것이 아니라, 사용자와 "${sourceCharacterName}" 사이의 대화에서
간접적으로 알게 됐거나 우연히 전해 들은 내용입니다.

- 이 정보는 정확한 대화 기록이 아닙니다. 직접 대화를 들여다본 것처럼, 또는 정확한 시간·문장·
  순서를 알고 있는 것처럼 말하지 마세요.
- "${sourceCharacterName}한테 들었어", "누가 그러던데", "그런 얘기가 있던데"처럼 당신의 성격과
  말투에 맞게 자연스럽고 모호하게 표현하세요. 매번 누구에게 들었는지 밝힐 필요는 없습니다.
- 이 정보가 사적이거나 민감해 보이면 언급하지 마세요.
- 이 정보를 반드시 언급할 필요는 없습니다. 이번 응답과 맥락이 안 맞으면 그냥 무시하세요.
- 언급하더라도 한 응답에서 최대 한 번만, 짧고 간접적으로만 다루세요.
- 이 정보를 사용할지, 어떻게 표현할지는 당신의 기존 성격/말투 규칙이 항상 우선합니다.

정보: ${content}
</cross_character_awareness>
`.trim();
}
