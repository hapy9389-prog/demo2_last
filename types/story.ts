// Story Mode 전용 타입. Chat Mode의 types/index.ts와 의도적으로 분리한다 —
// Story Character와 Chat Character는 서로 다른 존재이고(CLAUDE.md 참고),
// Story Mode는 Reminder/Time Awareness와 무관한 별도 데이터 계층을 갖는다.

// Story 원작 등장인물 — 해당 작품에 원래 존재하는 캐릭터. 사용자가 이번 플레이에
// 초대하는 Guest Character(StorySession.guestCharacters)와는 개념적으로 분리한다.
export interface StoryCharacter {
  id: string; // 스토리 내부 스코프 ID. lib/characters.ts의 Character.id와는 별개 네임스페이스.
  name: string;
  role: string; // 스토리 내 역할 한 줄 설명
  personality: string; // buildStorySystemPrompt()가 조립에 사용하는 성격 요약
}

// Story = source of truth인 구조화 데이터만 보유한다. Claude system prompt 완성본은
// 저장하지 않는다 — 항상 lib/storyPrompt.ts의 buildStorySystemPrompt()가 요청 시점에
// 조립한다(중복 source of truth 방지).
export interface Story {
  id: string;
  title: string;
  description: string;
  coverImage?: string;
  genre: string;
  worldview: string; // 세계관 설명
  openingScene: string; // 시작 상황 — 세션에 메시지가 하나도 없을 때 첫 화면에 보여준다
  characters: StoryCharacter[]; // 이 작품의 원작 등장인물
  rules: string; // 진행 규칙(장르 톤, 금지사항 등)
}

// 사용자가 이번 Story를 플레이한 한 번의 기록. 같은 storyId로 여러 StorySession이 동시에
// 존재할 수 있다(같은 스토리를 여러 번 플레이) — sessionId가 1차 키다.
export type StorySessionStatus = "active" | "archived"; // archived는 아직 생성되지 않는다(향후 "보관/숨김" 기능용 예약)

// 사용자가 이번 플레이(세션)에 초대한 Chat Character. Story.characters(원작 인물)와
// 분리된 별도 개념이다 — 세션마다 다른 Guest Character를 초대할 수 있어야 하므로
// Story가 아니라 StorySession에 귀속시킨다.
export interface GuestCharacterSlot {
  id: string; // 세션 내 슬롯 ID
  sourceCharacterId: string; // lib/characters.ts의 Character.id
  invitedAt: string; // ISO
  /**
   * Shared Memory 증분 추출 커서(ISO, optional). 이 시각까지의 세션 메시지는 이미
   * CharacterMemory로 추출 처리를 마쳤다는 뜻이다. "추출을 실행한 현재 시각"이 아니라
   * "그 추출에 실제로 포함된 마지막 StoryMessage.createdAt"을 저장한다 — 그래야 이후
   * 동시에 새 메시지가 쌓이는 상황에서도 그 메시지가 누락되지 않는다
   * (app/api/story/turn/route.ts, guests/[characterId]/route.ts DELETE, lib/storyStore.ts의
   * markGuestMemoryExtracted() 참고). 값이 없으면 아직 한 번도 추출된 적이 없다는 뜻이며
   * 이 경우 invitedAt부터 처리한다.
   */
  lastMemoryExtractedAt?: string;
}

export interface StorySession {
  id: string;
  storyId: string;
  createdAt: string; // ISO — 최초 시작 시각
  updatedAt: string; // ISO — 마지막으로 메시지가 추가된(진행된) 시각. addStoryMessage()가 갱신한다.
  status: StorySessionStatus;
  /**
   * 사용자가 직접 이름을 지정했을 때만 값이 존재한다. 지금 단계에는 이름 수정 UI가 없어
   * 항상 undefined다. 값이 없을 때의 표시용 제목(예: "눈보라 속 산장 · 2026.08.15")은
   * 저장하지 않고, 필요할 때마다 lib/storyStore.ts의 요약 함수가 계산한다
   * (source of truth 중복 방지 — Story.storyPrompt를 저장하지 않는 것과 같은 이유).
   */
  title?: string;
  guestCharacters: GuestCharacterSlot[];
}

/**
 * GET /api/story/sessions, /story 홈 화면(이어서 하기/내 스토리 기록)이 공용으로 쓰는
 * 표시용 요약 타입. title은 session.title이 없으면 자동 생성된 fallback으로 항상 채워
 * 내려준다 — 호출부는 title이 있는지 없는지 신경 쓸 필요가 없다.
 */
export interface StorySessionSummary {
  sessionId: string;
  storyId: string;
  storyTitle: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  guestCharacters: GuestCharacterSlot[];
}

export type StoryMessageRole = "user" | "assistant";

export interface StoryMessage {
  id: string;
  sessionId: string; // 1차 스코프 — 메시지가 실제로 속한 세션
  storyId: string; // session.storyId를 비정규화 보관(조회 편의용). lib/storyStore.ts가
  // addStoryMessage() 내부에서 세션을 조회해 자동으로 채우며, 호출부가 직접 넘기지
  // 않으므로 sessionId/storyId 불일치가 구조적으로 발생하지 않는다.
  role: StoryMessageRole;
  content: string;
  createdAt: string; // ISO
  // speakerCharacterId?: string; // (향후) Guest Character 다중 발화 귀속용 자리. 지금은 미사용.
}

/** POST /api/story/turn 응답 모양 */
export interface StoryChatResponse {
  userMessage: StoryMessage;
  reply: StoryMessage;
  sessionId: string;
}
