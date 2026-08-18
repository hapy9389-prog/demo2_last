import fs from "node:fs";
import path from "node:path";
import { getStoryById } from "./stories";
import { formatStoryDate } from "./storyFormat";
import {
  GuestCharacterSlot,
  StoryMessage,
  StoryMessageRole,
  StorySession,
  StorySessionSummary,
} from "@/types/story";

// lib/store.ts(Chat Mode 저장소)와 완전히 별도의 파일/전역 캐시를 쓴다 — 공유 상태가
// 전혀 없으므로 Story Mode를 아무리 바꿔도 Chat Mode의 Message/Reminder 저장에는
// 영향을 줄 수 없다. lib/store.ts는 이 파일에서 import하지 않는다.

interface StoryStoreShape {
  sessions: StorySession[];
  messages: StoryMessage[];
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "story-store.json");

declare global {
  var __storyStore: StoryStoreShape | undefined;
}

function loadFromDisk(): StoryStoreShape {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<StoryStoreShape>;
    const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    const { sessions: migratedSessions, changed } = migrateSessions(sessions, messages);
    if (changed) {
      // 마이그레이션 결과를 즉시 다시 저장해, 다음 로드부터는 보정이 필요 없게 한다.
      saveToDisk({ sessions: migratedSessions, messages });
    }
    return { sessions: migratedSessions, messages };
  } catch {
    // 파일이 없거나(첫 실행) 손상된 경우 빈 store로 시작한다.
    return { sessions: [], messages: [] };
  }
}

/**
 * 이전 버전(StorySession.updatedAt 필드 도입 전)에 만들어진 세션을 보정한다.
 * updatedAt이 없으면 그 세션의 메시지 중 가장 최근 createdAt(메시지가 없으면
 * session.createdAt)으로 채운다 — 기존에 쌓인 플레이 기록을 잃지 않기 위함(요구사항 7).
 * title은 optional 필드라 마이그레이션이 필요 없다.
 */
function migrateSessions(
  sessions: StorySession[],
  messages: StoryMessage[]
): { sessions: StorySession[]; changed: boolean } {
  let changed = false;
  const migrated = sessions.map((s) => {
    if (typeof (s as Partial<StorySession>).updatedAt === "string") return s;
    changed = true;
    const latestMessageAt = messages
      .filter((m) => m.sessionId === s.id)
      .reduce<string | null>(
        (latest, m) => (!latest || m.createdAt > latest ? m.createdAt : latest),
        null
      );
    return { ...s, updatedAt: latestMessageAt ?? s.createdAt };
  });
  return { sessions: migrated, changed };
}

function saveToDisk(store: StoryStoreShape) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.error("[storyStore] JSON 백업 저장 실패:", err);
  }
}

function getStore(): StoryStoreShape {
  if (!globalThis.__storyStore) {
    globalThis.__storyStore = loadFromDisk();
  }
  return globalThis.__storyStore;
}

function persist() {
  saveToDisk(getStore());
}

// ---------- Sessions ----------

/**
 * 새 세션을 만들어 저장하고 반환한다. 이 함수를 직접 호출하는 곳은
 * app/api/story/sessions/route.ts(POST)뿐이다 — 세션 생성은 항상 사용자의 명시적
 * "새로 시작" 행동에서만 일어나야 한다(GET 계열 조회 경로에서는 절대 호출하지 않는다).
 */
export function createStorySession(storyId: string): StorySession {
  const now = new Date().toISOString();
  const session: StorySession = {
    id: crypto.randomUUID(),
    storyId,
    createdAt: now,
    updatedAt: now,
    status: "active",
    guestCharacters: [],
  };
  getStore().sessions.push(session);
  persist();
  return session;
}

/** 읽기 전용, 부작용 없음. */
export function getStorySession(sessionId: string): StorySession | undefined {
  return getStore().sessions.find((s) => s.id === sessionId);
}

/**
 * 읽기 전용, 부작용 없음. 같은 storyId로 세션이 여러 개 존재할 수 있다는 전제 하에,
 * 그중 updatedAt이 가장 최신인 것을 반환한다(없으면 null) — "그 스토리의 유일한 진행
 * 세션"이 아니라 "그 스토리에서 가장 최근에 진행된 세션"이라는 뜻이다.
 */
export function getLatestActiveSession(storyId: string): StorySession | null {
  const candidates = getStore().sessions.filter(
    (s) => s.storyId === storyId && s.status !== "archived"
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, s) => (s.updatedAt > latest.updatedAt ? s : latest));
}

/**
 * 레거시 fallback 전용. `POST /api/story/turn`이 sessionId 없이 storyId만 받는 구버전
 * 호출을 처리할 때만 쓴다 — 그 경로 자체가 "실제 진행 요청"이므로 세션이 없으면 새로
 * 만드는 것이 맞다. `/story/[storyId]` 페이지의 GET 렌더링 경로에서는 이 함수를
 * 호출하지 않는다(세션이 없으면 안내 화면만 보여준다).
 */
export function getOrCreateLatestActiveSession(storyId: string): StorySession {
  return getLatestActiveSession(storyId) ?? createStorySession(storyId);
}

/** 전체 세션, updatedAt 내림차순(최근 진행 순). */
export function listStorySessions(): StorySession[] {
  return [...getStore().sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** 특정 storyId의 세션만, updatedAt 내림차순. */
export function listStorySessionsForStory(storyId: string): StorySession[] {
  return listStorySessions().filter((s) => s.storyId === storyId);
}

/**
 * 세션 하나를 표시용 요약으로 변환한다. 세션 생성 직후(POST /api/story/sessions)에도
 * 같은 조인/fallback-title 로직을 그대로 재사용하기 위해 export한다 — 두 곳에서 각자
 * title fallback 문자열을 다시 조립하지 않도록 하기 위함이다.
 */
export function toStorySessionSummary(session: StorySession): StorySessionSummary {
  const story = getStoryById(session.storyId);
  const title = session.title ?? `${story?.title ?? "알 수 없는 스토리"} · ${formatStoryDate(session.createdAt)}`;
  return {
    sessionId: session.id,
    storyId: session.storyId,
    storyTitle: story?.title ?? "알 수 없는 스토리",
    title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: getSessionMessages(session.id).length,
    guestCharacters: session.guestCharacters,
  };
}

/**
 * GET /api/story/sessions와 app/story/page.tsx(홈 서버 컴포넌트) 양쪽에서 재사용하는
 * 표시용 요약 목록 — story title 조인과 messageCount 계산 로직이 두 곳에 중복되지
 * 않도록 이 한 곳에만 둔다.
 */
export function listStorySessionSummaries(): StorySessionSummary[] {
  return listStorySessions().map(toStorySessionSummary);
}

export function listStorySessionSummariesForStory(storyId: string): StorySessionSummary[] {
  return listStorySessionsForStory(storyId).map(toStorySessionSummary);
}

// ---------- Guest Characters ----------

// MVP 제한: 세션당 Guest Character 1명. 배열 구조 자체는 이미 여러 명을 지원하므로,
// 나중에 여러 명을 허용하려면 이 상수만 올리면 된다(스키마/API 변경 불필요).
const MAX_GUEST_CHARACTERS_PER_SESSION = 1;

export type AddGuestCharacterResult =
  | { ok: true; slot: GuestCharacterSlot }
  | {
      ok: false;
      reason: "session_not_found" | "archived" | "already_invited" | "guest_limit_reached";
    };

/**
 * "characterId가 실제 lib/characters.ts에 존재하는가"는 여기서 검증하지 않는다 —
 * 그건 Chat 카탈로그를 참조하는 라우트(app/api/story/sessions/[sessionId]/guests/route.ts)의
 * 책임이다. 이 함수는 세션 상태(존재/archived/중복/정원)에 관한 가드만 맡는다 —
 * lib/store.ts의 deleteReminder()가 리마인더 상태만 검증하는 것과 같은 역할 분리다.
 */
export function addGuestCharacter(
  sessionId: string,
  characterId: string
): AddGuestCharacterResult {
  const session = getStorySession(sessionId);
  if (!session) return { ok: false, reason: "session_not_found" };
  if (session.status === "archived") return { ok: false, reason: "archived" };
  if (session.guestCharacters.some((g) => g.sourceCharacterId === characterId)) {
    return { ok: false, reason: "already_invited" };
  }
  if (session.guestCharacters.length >= MAX_GUEST_CHARACTERS_PER_SESSION) {
    return { ok: false, reason: "guest_limit_reached" };
  }

  const slot: GuestCharacterSlot = {
    id: crypto.randomUUID(),
    sourceCharacterId: characterId,
    invitedAt: new Date().toISOString(),
  };
  session.guestCharacters.push(slot);
  persist();
  return { ok: true, slot };
}

export type RemoveGuestCharacterResult =
  | { ok: true; slot: GuestCharacterSlot }
  | { ok: false; reason: "session_not_found" | "not_found" };

/**
 * 제거된 slot을 반환한다(Shared Memory의 게스트 제거 시 최종 추출이 invitedAt/
 * lastMemoryExtractedAt을 알아야 하기 때문 — app/api/story/sessions/[sessionId]/
 * guests/[characterId]/route.ts DELETE 참고). 호출부가 이전 반환 모양({ok:true}만)을
 * 기대하고 있었다면 `.slot`을 참조하지 않는 한 그대로 동작한다.
 */
export function removeGuestCharacter(
  sessionId: string,
  characterId: string
): RemoveGuestCharacterResult {
  const session = getStorySession(sessionId);
  if (!session) return { ok: false, reason: "session_not_found" };

  const idx = session.guestCharacters.findIndex((g) => g.sourceCharacterId === characterId);
  if (idx === -1) return { ok: false, reason: "not_found" };

  const [removed] = session.guestCharacters.splice(idx, 1);
  persist();
  return { ok: true, slot: removed };
}

/**
 * Shared Memory 증분 추출 커서 갱신. sessionId/characterId에 해당하는 guest slot이 이미
 * 제거되었거나 세션이 없으면 조용히 무시한다(추출 시점과 제거 시점 사이의 레이스는 "이미
 * 최종 추출로 처리됐거나 곧 처리될 것"이므로 실패로 취급하지 않는다).
 */
export function markGuestMemoryExtracted(
  sessionId: string,
  characterId: string,
  atISO: string
): void {
  const session = getStorySession(sessionId);
  if (!session) return;
  const slot = session.guestCharacters.find((g) => g.sourceCharacterId === characterId);
  if (!slot) return;
  slot.lastMemoryExtractedAt = atISO;
  persist();
}

// ---------- Messages ----------

/**
 * storyId를 파라미터로 받지 않는다. sessionId로 StorySession을 조회해
 * storyId = session.storyId를 자동으로 채워 저장하므로, 호출부의 실수로
 * sessionId/storyId가 서로 다른 스토리를 가리키는 불일치가 구조적으로 발생할 수 없다.
 * 메시지가 추가될 때마다 해당 세션의 updatedAt도 함께 갱신한다 — 별도의 저장 버튼 없이
 * 진행할 때마다 자동 저장되는 것이 이 필드의 목적이다.
 */
export function addStoryMessage(
  sessionId: string,
  role: StoryMessageRole,
  content: string
): StoryMessage {
  const session = getStorySession(sessionId);
  if (!session) {
    throw new Error(`[storyStore] 존재하지 않는 세션에 메시지를 추가하려 했습니다: ${sessionId}`);
  }
  const message: StoryMessage = {
    id: crypto.randomUUID(),
    sessionId,
    storyId: session.storyId,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
  getStore().messages.push(message);
  session.updatedAt = message.createdAt;
  persist();
  return message;
}

/** 특정 세션의 메시지만 시간순으로 반환한다. Claude 호출용 히스토리 구성에 쓴다. */
export function getSessionMessages(sessionId: string): StoryMessage[] {
  return getStore()
    .messages.filter((m) => m.sessionId === sessionId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * 읽기 전용, 부작용 없음. storyId의 가장 최근 세션이 없으면 세션을 만들지 않고 빈
 * 배열을 반환한다 — 스토리 화면 조회만으로 새 세션을 시작시키지 않기 위함이다.
 */
export function getMessagesForStory(storyId: string): StoryMessage[] {
  const session = getLatestActiveSession(storyId);
  if (!session) return [];
  return getSessionMessages(session.id);
}
