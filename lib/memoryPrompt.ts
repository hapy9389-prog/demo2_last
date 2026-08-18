import { CharacterMemory } from "@/types";

// Shared Memory를 Claude prompt에 넣을 문자열로 포맷팅하는 단일 지점. Chat/Story 양쪽
// 호출부가 각자 다른 문자열을 조립하지 않도록 여기서만 문구를 관리한다(source of truth
// 중복 금지 원칙). 두 함수 모두 memories가 비어 있으면 null을 반환해, 호출부가 별도
// 분기 없이 기존 .filter(Boolean) 패턴에 자연스럽게 끼워 넣을 수 있게 한다.

/**
 * Chat 전용. lib/claude.ts의 chatWithCharacter()가 system prompt 끝에 이어붙인다(user 턴이
 * 아니다 — <current_user_message>/source_text 판정 경계와 절대 섞이지 않게 하기 위함).
 * memory를 "확정된 사실"이 아니라 "어렴풋한 기억"으로 제시해, 오래되었거나 dedup되지 않은
 * 정보가 섞여 있어도 캐릭터가 자연스럽게 소화할 여지를 남긴다.
 */
export function buildSharedMemoryBlock(memories: CharacterMemory[]): string | null {
  if (memories.length === 0) return null;
  const lines = memories.map((m) => `- ${m.content}`).join("\n");
  return `<shared_memory>
아래는 당신이 이 사용자와 나눈 대화(및 함께 겪은 일)를 통해 어렴풋이 "기억"하고 있는 내용입니다.
정확한 로그가 아니라 기억이므로, 사실을 나열하듯 딱딱하게 말하지 말고 필요할 때만 성격에 맞게 자연스럽게 언급하세요.
모든 기억을 매 응답마다 언급할 필요는 없습니다. 이 정보보다 당신의 성격/말투 규칙이 항상 우선합니다.

${lines}
</shared_memory>`;
}

/**
 * Story 전용. lib/storyPrompt.ts의 buildGuestCharacterBrief()가 게스트별 brief 안에 한
 * 줄(블록)로 덧붙인다. storyPrompt.ts는 XML 태그를 쓰지 않는 기존 관례를 따라 평문 불릿으로
 * 통일한다(Chat과 형식을 다르게 두는 것이 각 파일의 기존 idiom과 더 일관적이다).
 */
export function buildGuestMemoryLines(memories: CharacterMemory[]): string | null {
  if (memories.length === 0) return null;
  const lines = memories.map((m) => `    - ${m.content}`);
  return [
    "  기억(다른 자리에서 함께 겪었거나 들었던 내용 — 정확한 기록이 아니라 어렴풋한 기억이므로 성격에 맞게 자연스럽게 다룬다):",
    ...lines,
  ].join("\n");
}
