import { Message } from "@/types";

// Cross-Character Interaction Awareness(캐릭터 간 "행동 사실" 인지) 전용 순수 로직.
// Chat Mode에서만 쓰인다(app/api/chat/route.ts가 chatWithCharacter() 호출 전에 이
// 모듈로 이번 턴 context를 결정한다). Story Mode(lib/storyPrompt.ts,
// lib/storyClaude.ts, app/api/story/*)와 proactive Reminder(lib/claude.ts의
// fireReminderMessage(), lib/scheduler.ts)는 이 모듈을 전혀 import하지 않는다.
//
// 이 모듈은 lib/crossCharacterAwareness.ts(다른 캐릭터의 Shared Memory 내용을 확률로
// 간접 인지시키는 기존 기능)와 명확히 다른 별개 계층이다 — 그 기능은 "무엇을 아는가"
// (Memory 내용)를 다루고, 이 모듈은 "무엇을 했는가"(다른 캐릭터와 대화했다는 행동
// 사실)만 다룬다. 다른 캐릭터와 나눈 대화의 "내용"은 이 모듈 어디에도 존재하지
// 않는다 — 아래 함수들의 시그니처 자체에 content류 파라미터가 없으므로 구조적으로
// 섞여 들어갈 수 없다.
//
// 판정은 확률(Math.random)이 아니라 실제 메시지 기록(lib/store.ts) 기반 결정론적
// 로직이다. 이 파일 자체는 store를 직접 import하지 않는다 — lib/interactionTime.ts와
// 동일한 원칙으로, store 조회는 app/api/chat/route.ts가 담당하고 이 모듈은 순수
// 함수로만 구성한다.

export interface DetectedOtherCharacterInteraction {
  /** 가장 최근에 사용자가 대화한 다른 캐릭터의 characterId. */
  characterId: string;
  /** 그 메시지의 생성 시각(ISO). 디버깅/로그 용도로만 쓰인다. */
  createdAt: string;
}

/**
 * 이 기능 전체의 on/off 스위치. lib/crossCharacterAwareness.ts의
 * isCrossCharacterAwarenessEnabled()와 완전히 독립된 별도 env — 두 Cross-Character
 * 계열 기능을 서로 다른 조합으로 켜고 끌 수 있어야 한다. 기본값은 true(켜짐)이며,
 * CROSS_CHARACTER_INTERACTION_ENABLED=false로 명시했을 때만 꺼진다.
 */
export function isCrossCharacterInteractionEnabled(): boolean {
  return process.env.CROSS_CHARACTER_INTERACTION_ENABLED !== "false";
}

/**
 * 데모/개발 전용 강제 언급 모드. 기본값은 false(옵트인)이며, 일반 서비스 동작에는
 * 절대 영향을 주지 않는다. true면 감지된 턴에서 buildCrossCharacterInteractionBlock()이
 * "이번 응답에서 반드시 한 번은 언급하라"는 지침을 담은 블록을 만든다 — 단, 어떤
 * 말투/표현으로 언급할지는 여전히 캐릭터 성격에 맡긴다("언급 여부"만 강제하고
 * "표현 방식"은 강제하지 않는다).
 */
export function isCrossCharacterInteractionDemoMode(): boolean {
  return process.env.CROSS_CHARACTER_INTERACTION_DEMO_MODE === "true";
}

/**
 * messagesSinceLastOwnMessage(현재 캐릭터와의 마지막 user 대화 이후 전체 메시지) 중
 * currentCharacterId가 아닌 다른 캐릭터에게 사용자가 보낸(role: "user") 메시지만 골라,
 * 가장 최근(createdAt 최댓값) 1건만 반환한다. 여러 캐릭터가 섞여 있어도 "가장 최근
 * 상호작용한 캐릭터"만 알려준다 — lib/crossCharacterAwareness.ts의
 * pickCrossCharacterCandidate()도 한 턴에 정확히 1개만 고르는 것과 동일하게, 이
 * 프로젝트의 두 Cross-Character 계열 기능이 "한 턴당 최대 1건"이라는 규칙을 공유한다.
 *
 * role이 "assistant"인 다른 캐릭터 메시지(예: 리마인더 발화)는 후보에서 제외한다 —
 * "사용자가 그 캐릭터와 대화했다"는 사실은 사용자가 실제로 말을 건 경우에만 성립한다.
 */
export function findMostRecentOtherCharacterUserMessage(
  currentCharacterId: string,
  messagesSinceLastOwnMessage: Message[]
): DetectedOtherCharacterInteraction | null {
  const candidates = messagesSinceLastOwnMessage.filter(
    (m) => m.role === "user" && m.characterId !== currentCharacterId
  );
  if (candidates.length === 0) return null;

  const mostRecent = candidates.reduce((latest, m) =>
    m.createdAt > latest.createdAt ? m : latest
  );
  return { characterId: mostRecent.characterId, createdAt: mostRecent.createdAt };
}

/**
 * Claude system prompt에 이어붙일 `<cross_character_interaction>` 블록을 만든다.
 * otherCharacterName만 인자로 받고 "대화 내용"은 파라미터 자체에 존재하지 않는다 —
 * 구조적으로 내용이 섞여 들어갈 수 없다.
 *
 * demoMode=false(기본, 일반 서비스 동작): 언급 여부 자체를 캐릭터 재량에 맡긴다.
 * demoMode=true(데모 전용): 이번 응답에서 반드시 한 번은 언급하도록 지침만 강제하고,
 * 표현 방식은 여전히 캐릭터 성격에 맡긴다. 두 모드 모두 "대화 내용은 알 수 없으니
 * 아는 척하거나 추측하지 말라"는 마지막 원칙은 동일하게 유지한다.
 */
export function buildCrossCharacterInteractionBlock(
  otherCharacterName: string,
  demoMode: boolean = false
): string {
  const mentionRule = demoMode
    ? `[데모 모드] 이 사실을 이번 응답에서 반드시 한 번은 자연스럽게 반영하세요.
언급 여부는 선택이 아니지만, 어떤 말투와 표현으로 반영할지는 전적으로 당신의 성격과
말투에 맞게 자유롭게 정하세요. 예: "어디 갔다 왔어?", "나 없는 사이에 누구랑 얘기한
거 아니야?", "${otherCharacterName}랑 이야기하고 온 거야?" — 이 예시 문구를 그대로 쓸
필요는 없습니다.`
    : `이 사실을 반드시 언급할 필요는 없습니다.
현재 대화의 흐름과 당신의 성격에 자연스럽게 맞을 때만 활용하세요.`;

  return `
<cross_character_interaction>
사용자는 당신과 마지막으로 대화한 이후 '${otherCharacterName}'와 대화했습니다.

${mentionRule}

사용자가 다른 캐릭터와 나눈 대화 내용은 알 수 없습니다.
따라서 그 대화의 내용을 알고 있는 것처럼 말하거나 추측해서 사실처럼 표현하지 마세요.
</cross_character_interaction>
`.trim();
}

/**
 * lastOwnUserMessageAtISO(null=이 캐릭터와의 첫 대화) → 다른 캐릭터 상호작용 탐지까지
 * 한 번에 처리하는 조합 헬퍼(lib/interactionTime.ts의 buildTimeAwarenessForCharacter()와
 * 동일 패턴). app/api/chat/route.ts는 이 함수 하나만 부르면 된다.
 *
 * 첫 대화(lastOwnUserMessageAtISO === null)면 "다른 캐릭터와 이야기했다"는 개념 자체가
 * 성립하지 않으므로 메시지 배열을 보기도 전에 즉시 null을 반환한다.
 *
 * 반복 언급 방지는 별도 상태 없이 stateless로 해결된다: 현재 캐릭터에게 새 user
 * 메시지가 저장되는 순간 다음 호출의 lastOwnUserMessageAtISO가 그 메시지 시각으로
 * 갱신되고, 그 이후로는 "그 갱신된 시각 이후 다른 캐릭터 메시지"가 없어지므로 자동으로
 * 재감지되지 않는다 — CLAUDE.md §7 "반복 언급 방지"(Time Awareness)와 동형(isomorphic)
 * 메커니즘이다.
 */
export function detectCrossCharacterInteraction(
  currentCharacterId: string,
  lastOwnUserMessageAtISO: string | null,
  messagesSinceLastOwnMessage: Message[]
): DetectedOtherCharacterInteraction | null {
  if (!lastOwnUserMessageAtISO) return null;
  return findMostRecentOtherCharacterUserMessage(currentCharacterId, messagesSinceLastOwnMessage);
}
