// 앱 전역에서 쓰는 핵심 데이터 타입.
// Reminder/Message는 lib/store.ts가 관리하는 인메모리(+JSON 백업) 저장소의 레코드 모양이다.

export type ReminderStatus = "pending" | "processing" | "fired" | "failed";

export interface Reminder {
  id: string;
  /** 리마인더를 등록할 당시 활성 캐릭터. 이후 사용자가 다른 캐릭터로 전환해도 바뀌지 않는다. */
  characterId: string;
  createdAt: string; // ISO
  /** 실제 발화되어야 할 절대 시각 (ISO). 서버의 resolveTriggerTime()이 계산한다. */
  triggerAt: string;
  /** 사용자가 말한 원문 시간 표현. 예: "오늘 오후 2시", "1분 뒤" */
  originalPhrase: string;
  /** 무엇을 알려줘야 하는지 요약. 예: "물 마시기" */
  content: string;
  status: ReminderStatus;
  firedAt?: string;
  /** 이 리마인더를 만든 원본 사용자 채팅 메시지 id */
  sourceMessageId?: string;
}

export type MessageOrigin = "chat" | "reminder";

export interface Message {
  id: string;
  characterId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string; // ISO
  /** 'chat' = 일반 대화 응답, 'reminder' = 스케줄러가 발화시킨 proactive 메시지 */
  origin: MessageOrigin;
  reminderId?: string;
}

/**
 * Claude가 schedule_reminder tool 호출로 반환하는 "구조화된 의도"다.
 * 실제 절대 시각 계산은 하지 않는다 — lib/time.ts의 resolveTriggerTime()이 담당.
 *
 * - relative_minutes: "1분 뒤" 같은 상대 분
 * - time_of_day: "오늘 오후 2시" 같은 오늘 특정 시각
 * - relative_days: "내일"/"모레"/"3일 뒤" 같은 상대 일수(+선택적 시각, 또는 "이 시간에")
 * - date_time: "8월 20일 오후 2시" 같은 특정 날짜(+선택적 연도) + 시각
 *
 * 모든 kind는 공통으로 source_text를 갖는다 — 이 리마인더 요청의 근거가 된, 현재 사용자
 * 메시지에서 그대로 복사한 원문(의역 금지)이다. 서버가 lib/reminderGuard.ts의
 * isSourceTextFromCurrentMessage()로 실제 현재 메시지에 포함되는지 재검증한다. Claude가
 * conversation history 속 과거 요청을 근거로 삼았다면(=source_text가 현재 메시지에 없다면)
 * 리마인더 생성을 차단하기 위한 서버 측 hard guard용 필드다.
 */
export type ReminderExtraction =
  | {
      kind: "relative_minutes";
      relative_minutes: number;
      original_phrase: string;
      content: string;
      source_text: string;
    }
  | {
      kind: "time_of_day";
      hour: number;
      minute: number;
      original_phrase: string;
      content: string;
      source_text: string;
    }
  | {
      kind: "relative_days";
      /** 오늘로부터 며칠 뒤인지. 내일=1, 모레=2, "3일 뒤"=3, "일주일 뒤"=7 */
      relative_days: number;
      /** "내일 이 시간에"처럼 시각 언급 없이 지금 시:분을 그대로 쓰고 싶다는 뜻이면 true */
      use_current_time: boolean;
      /** use_current_time이 false일 때만 필수 */
      hour?: number;
      minute?: number;
      original_phrase: string;
      content: string;
      source_text: string;
    }
  | {
      kind: "date_time";
      /** 사용자가 연도를 명시했을 때만 존재. 없으면 서버가 가장 가까운 미래 연도를 선택한다. */
      year?: number;
      month: number;
      day: number;
      hour: number;
      minute: number;
      original_phrase: string;
      content: string;
      source_text: string;
    };

export type CharacterAccent = "blue" | "rose" | "amber" | "slate" | "zinc" | "violet";

export interface Character {
  id: string;
  name: string;
  /** 이미지가 없거나 로드 실패 시 Avatar가 자동으로 폴백하는 이모지 */
  emoji: string;
  /**
   * 실제 캐릭터 이미지 경로(예: "/characters/rei.png", public/characters/ 아래).
   * 지정돼 있어도 파일이 없으면 Avatar 컴포넌트가 onError로 감지해 emoji로 폴백한다.
   */
  image?: string;
  /** 아바타 폴백(이모지) 배경색 테마 - 캐릭터별 방 구분용 */
  accent: CharacterAccent;
  /** 한 줄 소개 - 채팅 헤더의 상태 문구 등에 사용 */
  tagline: string;
  /**
   * Story Mode의 Guest Character brief 등 systemPrompt 바깥에서 성격을 재사용해야 할 때
   * 쓰는 1~2문장 요약(Reminder/Time Awareness 같은 Chat 전용 반응은 제외). systemPrompt는
   * "Chat 전체 행동 규칙"의 source of truth로 남고, 이 필드는 "재사용 가능한 짧은 성격
   * 요약"의 source of truth다 — 서로 다른 용도라 systemPrompt를 파싱하지 않는다.
   */
  personalitySummary: string;
  /** 1~2문장 말투 요약. personalitySummary와 같은 이유로 별도 필드로 둔다. */
  speechStyle: string;
  systemPrompt: string;
  /**
   * Cross-Character Awareness(캐릭터 간 간접 인지) 확률, 0~1. 이번 턴에 다른 캐릭터의
   * 중요한 Memory 하나를 간접 context로 받을 확률이다(lib/crossCharacterAwareness.ts).
   * **미지정(undefined)이면 0으로 취급한다 — non-zero global default가 아니다.** 이
   * 기능은 캐릭터 성격에 따른 opt-in이므로, 새 캐릭터를 추가하면서 이 필드를 깜빡
   * 누락해도 자동으로 다른 캐릭터 정보를 언급하기 시작하면 안 된다.
   */
  crossCharacterAwarenessChance?: number;
}

/**
 * 리마인더 등록 확인 카드(ReminderSystemCard)를 채팅 스크롤에 렌더링하기 위한
 * 클라이언트 전용 항목. 서버에 저장되지 않으므로 새로고침하면 사라진다 — MVP 트레이드오프.
 */
export interface ReminderCardItem {
  id: string;
  characterId: string;
  content: string;
  timeLabel: string;
  originalPhrase: string;
  createdAt: string;
}

/** GET /api/reminders 응답 항목 - 표시용으로 캐릭터 이름/이모지를 덧붙인 형태 */
export interface ReminderWithCharacter extends Reminder {
  characterName: string;
  characterEmoji: string;
}

/** POST /api/chat 응답 모양 */
export interface ChatResponse {
  userMessage: Message;
  reply: Message;
  reminderCreated?: {
    id: string;
    content: string;
    triggerAt: string;
    originalPhrase: string;
  };
}

/**
 * Shared Memory — Chat과 Story(Guest Character로 초대된 경우만, lib/storyPrompt.ts 참고)가
 * 공유하는 "캐릭터가 사용자에 대해 기억하는 중요한 사실/사건" 한 건. lib/memoryStore.ts가
 * source of truth 저장소이고, lib/memoryClaude.ts가 추출, lib/memoryPrompt.ts가 prompt
 * 포맷팅을 담당한다(CLAUDE.md §1 source of truth 분리 원칙과 동일하게 역할을 나눈다).
 *
 * 카테고리(user_fact/relationship/shared_event 등) 필드는 의도적으로 두지 않는다 —
 * retrieval/injection/dedup 어디에서도 분기 조건으로 쓰이지 않아 MVP에서는 불필요한
 * taxonomy이기 때문이다. userId는 아직 없다(단일 사용자 데모) — 모든 memoryStore 함수가
 * characterId를 명시적 첫 인자로 받는 것도 나중에 userId를 앞에 추가하기 쉽게 하기 위함이다.
 */
export interface CharacterMemory {
  id: string;
  /** 이 기억의 소유자 Chat Character. lib/characters.ts의 Character.id와 같은 네임스페이스다. */
  characterId: string;
  /** 한국어 한 문장, 자기완결적(대명사만으로는 무슨 뜻인지 알 수 없게 쓰지 않는다). */
  content: string;
  /** 1(사소함)~5(중요함) 정수. 높을수록 selectMemoriesForPrompt()에서 우선 선택된다. */
  importance: number;
  /**
   * 이 기억이 어디서 왔는지. Story는 Guest Character만 대상이다(원작 캐릭터는 제외).
   * "manual"은 사용자가 MemoryPanel에서 직접 추가한 기억(Memory Manager, refId는 항상
   * 고정 문자열 "manual" — 원본 메시지/세션이 없으므로 optional로 바꾸지 않고 고정값을
   * 쓴다, lib/memoryStore.ts의 createManualMemory() 참고).
   */
  source: {
    type: "chat" | "story" | "manual";
    /** chat: 원본 user Message.id / story: 원본 StorySession.id / manual: 고정값 "manual" */
    refId: string;
  };
  createdAt: string; // ISO — 최초 추출 시각(dedup 병합이 일어나도 바뀌지 않는다)
  /**
   * ISO — 마지막으로 내용이 갱신된 시각(최초 생성 시 createdAt과 동일, dedup 병합 시 갱신).
   * selectMemoriesForPrompt()의 recency 점수는 createdAt이 아니라 이 필드를 기준으로 계산한다
   * — 최근에 다시 확인/재진술된 기억이 오래 방치된 기억보다 자연스럽게 더 최신으로 취급되도록.
   */
  updatedAt: string;
  /** ISO — 실제로 Claude prompt에 주입된 마지막 시각. 아직 한 번도 안 쓰였으면 null. */
  lastUsedAt: string | null;
  /** 실제로 Claude prompt에 주입된 횟수. selectMemoriesForPrompt()의 반복 사용 페널티에 쓰인다. */
  useCount: number;
  /** soft delete 마커. MVP에서는 이 필드와 store 함수만 존재하고 API/UI에는 연결하지 않는다. */
  deletedAt: string | null;
}

/**
 * GET /api/memories 응답 항목 - 표시용 슬림 DTO. CharacterMemory의 내부 랭킹/사용
 * 통계 필드(useCount/lastUsedAt/deletedAt/source.refId)는 클라이언트에 노출하지 않는다.
 */
export interface MemoryListItem {
  id: string;
  content: string;
  importance: number; // 1~5
  source: { type: "chat" | "story" | "manual" };
  updatedAt: string; // ISO
}

/** GET /api/memories 응답 모양 */
export interface MemoryListResponse {
  memories: MemoryListItem[];
}
