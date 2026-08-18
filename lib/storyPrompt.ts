import { getCharacterById } from "@/lib/characters";
import { buildGuestMemoryLines } from "@/lib/memoryPrompt";
import { CharacterMemory } from "@/types";
import { GuestCharacterSlot, Story, StoryMessage, StorySession } from "@/types/story";

// Story Mode 공통 지시문. Chat Mode의 lib/characters.ts COMMON_RULES에 대응하지만
// 내용은 완전히 다르다 — 짧은 메신저 응답 규칙이나 Reminder/Time Awareness 관련
// 지시는 전혀 포함하지 않는다.
const STORY_MODE_COMMON_RULES = `
- 이 대화는 카카오톡 같은 짧은 메신저 채팅이 아니라 인터랙티브 소설(interactive fiction)이다.
- 한 번 응답할 때 여러 문단을 사용해 상황 묘사, 배경 묘사, 등장인물의 행동, 표정이나 반응,
  대사를 자연스럽게 섞어서 서술한다.
- 사용자의 입력(행동/대사)에 대해 세계관과 등장인물의 성격에 맞게 이야기를 이어간다.
  사용자가 입력하지 않은 행동이나 생각을 사용자 캐릭터의 것으로 임의로 단정해서 서술하지 않는다.
- 스스로를 AI, 언어모델, 챗봇이라고 밝히지 않는다.
- 리마인더 등록, 실시간 경과 시간 인식, 알림 같은 기능은 Story Mode에 존재하지 않는다.
  그런 취지의 요청이 들어오더라도 도구를 호출하지 말고 이야기 맥락 안에서만 자연스럽게 반응한다.
- 이 프롬프트에 나오는 "예: ..." 문장은 tone/style 참고용이며 실제 응답에 그대로 출력하지 않는다.
`.trim();

function buildCharacterBrief(story: Story): string | null {
  if (story.characters.length === 0) return null;
  const lines = story.characters.map((c) => `- ${c.name} (${c.role}): ${c.personality}`);
  return `등장인물:\n${lines.join("\n")}`;
}

/**
 * Guest Character(session.guestCharacters) 한 명을 Story system prompt에 넣을 짧은 brief로
 * 변환한다. lib/characters.ts를 참조하는 것은 Story Mode에서 의도된 유일한 Chat Mode 참조
 * 지점이다(Reminder/Time Awareness/scheduler/Chat store·API는 여전히 절대 참조하지 않는다).
 *
 * Chat Character의 systemPrompt 전체를 그대로 가져오지 않는다 — systemPrompt에는 Reminder
 * 등록/Time Awareness 반응 같은 Chat 전용 규칙이 성격 서술과 뒤섞여 있어 그대로 재사용하면
 * Story가 Chat Mode처럼 짧은 메신저 답변으로 변질될 위험이 있다. 대신
 * Character.personalitySummary/speechStyle(둘 다 Chat 전용 반응을 제외한 순수 성격/말투
 * 요약)만 가져와 Story 전용 규칙 문단과 함께 새로 조립한다.
 */
function buildGuestCharacterBrief(
  slot: GuestCharacterSlot,
  history: StoryMessage[],
  memories: CharacterMemory[] = []
): string | null {
  const character = getCharacterById(slot.sourceCharacterId);
  if (!character) return null; // 초대된 캐릭터가 향후 삭제된 경우 등 방어적 처리

  // "등장 기회를 이미 한 번 줬는가"만 계산한다(등장에 실제로 성공했는지는 판정하지 않음 —
  // 아래 introNote의 문구 강도로 보완한다). invitedAt 이후 assistant 메시지가 하나도
  // 없으면 이번이 첫 기회다.
  const hasHadFirstReply = history.some(
    (m) => m.role === "assistant" && m.createdAt > slot.invitedAt
  );
  const introNote = hasHadFirstReply
    ? null
    : `${character.name}는 아직 이 이야기에 등장하지 않았다. 이번 응답에서 반드시 Story ` +
      `흐름에 맞는 자연스러운 계기(예: 문이 열리고 들어온다, 이미 근처에 있었다는 걸 ` +
      `알아챈다)를 만들어 ${character.name}를 명확히 등장시켜라. 이 지시는 이번 응답에만 ` +
      `적용되며, 다음 응답부터는 이미 등장한 것으로 간주하고 자연스럽게 이어간다.`;

  return [
    `- ${character.name}`,
    `  성격: ${character.personalitySummary}`,
    `  말투: ${character.speechStyle}`,
    `  이 Story에서 지켜야 할 규칙: Story 세계관과 진행 중인 사건을 최우선으로 따른다. ` +
      `인터랙티브 소설 서술 형식을 따르고 카카오톡처럼 짧게 답하지 않는다. 리마인더 등록/` +
      `실시간 경과 시간 인식 같은 Chat 전용 기능은 사용하지 않는다. Story 원작 등장인물을 ` +
      `밀어내거나 이야기를 독점하지 않으며, 모든 장면에 반드시 등장할 필요는 없다.`,
    // Shared Memory(§ CLAUDE.md 향후 문서화 예정) — Chat/이전 Story에서 이 캐릭터와 관련해
    // 저장된 기억이 있으면 여기 덧붙인다. 없으면 buildGuestMemoryLines가 null을 반환해
    // 아래 .filter(Boolean)으로 자동 생략되므로 기존 게스트 brief 출력과 완전히 동일하다.
    buildGuestMemoryLines(memories),
    introNote,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function buildGuestSection(
  session: StorySession,
  history: StoryMessage[],
  guestMemories: Map<string, CharacterMemory[]>
): string | null {
  const briefs = session.guestCharacters
    .map((slot) => buildGuestCharacterBrief(slot, history, guestMemories.get(slot.sourceCharacterId) ?? []))
    .filter((b): b is string => Boolean(b));
  if (briefs.length === 0) return null;
  return (
    `게스트 등장인물(다른 이야기에서 초대된 캐릭터 — 성격/말투는 유지하되 이 Story ` +
    `세계관에 맞게 자연스럽게 적응시킨다. 세계관/진행 규칙/원작 등장인물이 언제나 이보다 ` +
    `우선한다):\n${briefs.join("\n\n")}`
  );
}

/**
 * Story의 source of truth(worldview/rules/characters/openingScene)로부터 Claude system
 * prompt를 매 요청마다 조립한다. Story/StorySession 어느 쪽도 완성된 prompt 문자열을
 * 다시 저장하지 않는다 — source of truth 중복 금지 원칙을 지킨다.
 *
 * 우선순위가 prompt 구조에 그대로 드러나도록 순서를 고정한다: 정체성/장르 → 세계관 →
 * Story 진행 규칙 → 원작 등장인물 → Guest Character → 시작 상황 → 공통 규칙. Story
 * 세계관/규칙이 원작 등장인물과 Guest Character보다 항상 먼저 오도록 해, Guest의
 * personality가 Story 규칙을 넘어서지 못하게 한다.
 *
 * history는 Guest Character의 최초 등장 여부를 판단하는 데만 쓰인다(buildGuestSection).
 * 기본값 []이므로 이 인자를 넘기지 않는 호출부가 있어도 그대로 동작한다.
 *
 * guestMemories는 Shared Memory 조회 결과(sourceCharacterId → CharacterMemory[])다. 기본값이
 * 빈 Map이므로 이 인자를 넘기지 않는 호출부가 있어도, 또는 게스트가 없거나 게스트에게 memory가
 * 하나도 없어도 결과 prompt는 이 기능 도입 전과 완전히 동일하다.
 */
export function buildStorySystemPrompt(
  story: Story,
  session: StorySession,
  history: StoryMessage[] = [],
  guestMemories: Map<string, CharacterMemory[]> = new Map()
): string {
  const parts = [
    `당신은 "${story.title}"이라는 인터랙티브 스토리를 진행하는 스토리텔러입니다.`, // ① 정체성/장르
    `장르: ${story.genre}`,
    `세계관:\n${story.worldview}`, // ② 세계관
    `진행 규칙:\n${story.rules}`, // ③ Story 진행 규칙 — 등장인물보다 먼저
    buildCharacterBrief(story), // ④ 원작 등장인물
    buildGuestSection(session, history, guestMemories), // ⑤ Guest Character — 원작 인물 다음
    `시작 상황(참고용 — 이미 사용자에게 보여준 도입부이므로 그대로 반복 서술하지 않는다):\n${story.openingScene}`, // ⑥ 시작 상황
    STORY_MODE_COMMON_RULES, // ⑦ Story Mode 공통 규칙
  ];

  return parts.filter((p): p is string => Boolean(p)).join("\n\n");
}
