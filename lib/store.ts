import fs from "node:fs";
import path from "node:path";
import { Message, MessageOrigin, Reminder, ReminderStatus } from "@/types";

interface StoreShape {
  messages: Message[];
  reminders: Reminder[];
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

// Next.js dev 서버의 Fast Refresh로 이 모듈이 여러 번 재평가되어도 데이터가 날아가지
// 않도록 globalThis에 싱글턴으로 보관한다(Prisma client 싱글턴과 동일한 이유의 패턴).
declare global {
  var __appStore: StoreShape | undefined;
}

function loadFromDisk(): StoreShape {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
    };
  } catch {
    // 파일이 없거나(첫 실행) 손상된 경우 빈 store로 시작한다.
    return { messages: [], reminders: [] };
  }
}

function saveToDisk(store: StoreShape) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    // 어디까지나 데모용 안전망 백업일 뿐이므로, 실패해도 서비스 자체는 계속 동작해야 한다.
    console.error("[store] JSON 백업 저장 실패:", err);
  }
}

function getStore(): StoreShape {
  if (!globalThis.__appStore) {
    globalThis.__appStore = loadFromDisk();
  }
  return globalThis.__appStore;
}

function persist() {
  saveToDisk(getStore());
}

// ---------- Messages ----------

export function addMessage(input: {
  characterId: string;
  role: "user" | "assistant";
  content: string;
  origin: MessageOrigin;
  reminderId?: string;
}): Message {
  const message: Message = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...input,
  };
  getStore().messages.push(message);
  persist();
  return message;
}

/** 특정 캐릭터의 전체 대화 이력. 캐릭터 전환/최초 로드 시 채팅창을 채우는 데 쓴다. */
export function getMessagesForCharacter(characterId: string): Message[] {
  return getStore()
    .messages.filter((m) => m.characterId === characterId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** since(ISO)보다 뒤에 생성된, 캐릭터 무관 전체 메시지. 폴링(새 메시지 감지)용. */
export function getMessagesSince(sinceISO: string | null): Message[] {
  const all = getStore().messages;
  const filtered = sinceISO ? all.filter((m) => m.createdAt > sinceISO) : all;
  return [...filtered].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Claude 채팅 호출에 보낼 최근 N턴. 전체 이력을 매번 보내지 않기 위한 컨텍스트 트리밍. */
export function getRecentHistory(characterId: string, limit = 20): Message[] {
  return getMessagesForCharacter(characterId).slice(-limit);
}

/**
 * 시간 인식(time awareness) 기능 전용 — characterId에게 사용자가 보낸(role: "user")
 * 마지막 메시지 시각(ISO). 없으면 null(이 캐릭터와의 첫 대화). getRecentHistory()의
 * limit(기본 20개)과 무관하게 전체 메시지를 스캔한다 — 리마인더 발화 메시지(role:
 * "assistant", origin: "reminder")가 연속으로 여러 개 쌓여도 실제 마지막 사용자 메시지를
 * 놓치지 않기 위함이다. 순수 조회 함수이며 store.messages를 절대 수정하지 않는다 —
 * 개발 환경에서 시간 경과를 시뮬레이션하려면 이 함수를 우회하지 말고
 * lib/devInteractionOverride.ts를 사용한다.
 */
export function getLastUserMessageAt(characterId: string): string | null {
  const userMessages = getStore().messages.filter(
    (m) => m.characterId === characterId && m.role === "user"
  );
  if (userMessages.length === 0) return null;
  return userMessages.reduce(
    (latest, m) => (m.createdAt > latest ? m.createdAt : latest),
    userMessages[0].createdAt
  );
}

// ---------- Reminders ----------

export function addReminder(input: {
  characterId: string;
  triggerAt: string;
  originalPhrase: string;
  content: string;
  sourceMessageId?: string;
}): Reminder {
  const reminder: Reminder = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: "pending",
    ...input,
  };
  getStore().reminders.push(reminder);
  persist();
  return reminder;
}

export function listReminders(): Reminder[] {
  return [...getStore().reminders].sort((a, b) =>
    a.triggerAt.localeCompare(b.triggerAt)
  );
}

export function getReminder(id: string): Reminder | undefined {
  return getStore().reminders.find((r) => r.id === id);
}

/** 스케줄러 tick에서 발화 대상을 스캔할 때 사용. pending && 도래 시각 지남. */
export function getDueReminders(now: Date = new Date()): Reminder[] {
  const nowISO = now.toISOString();
  return getStore().reminders.filter(
    (r) => r.status === "pending" && r.triggerAt <= nowISO
  );
}

export function updateReminderStatus(
  id: string,
  status: ReminderStatus,
  extra?: Partial<Pick<Reminder, "firedAt">>
): Reminder | undefined {
  const reminder = getReminder(id);
  if (!reminder) return undefined;
  reminder.status = status;
  if (extra?.firedAt) reminder.firedAt = extra.firedAt;
  persist();
  return reminder;
}

// 같은 characterId+content의 리마인더가 이미 pending/fired 상태로 있는데 새로
// 계산된 triggerAt이 여기서 정한 오차 범위 안이면 "같은 걸 다시 등록하려는 것"으로 본다.
const NEAR_DUPLICATE_TRIGGER_TOLERANCE_MS = 2 * 60 * 1000; // 2분
// 또는 같은 characterId+content의 리마인더가 아주 최근(이 시간 이내)에 생성됐다면
// triggerAt이 달라도 즉시 연속 재호출(예: 같은 응답 안 중복 tool_use, 순간 재전송)로 보고 막는다.
const RECENT_DUPLICATE_CREATION_WINDOW_MS = 30 * 1000; // 30초

function normalizeReminderContent(content: string): string {
  return content.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Claude가 과거 대화의 리마인더 요청을 잘못 재해석해 같은 리마인더를 다시 만들려는
 * 경우를 잡아내는 서버 측 마지막 방어선(1차 방어는 tool description/system prompt).
 * 같은 characterId + 정규화된 content가 일치하는 pending/fired 리마인더 중,
 * (a) 새 triggerAt이 기존 것과 거의 같거나, (b) 기존 것이 아주 최근에 생성됐다면
 * 중복으로 판단해 그 기존 리마인더를 반환한다(없으면 null = 중복 아님, 생성 진행).
 *
 * 사용자가 "다시 알려줘"처럼 명시적으로 새 시간을 지정하면 새 triggerAt이 기존
 * 것과 충분히 달라지므로 이 검사에 걸리지 않고 정상적으로 새 리마인더가 만들어진다.
 */
export function findDuplicateReminder(
  characterId: string,
  content: string,
  triggerAt: Date,
  now: Date = new Date()
): Reminder | null {
  const normalized = normalizeReminderContent(content);
  const candidates = getStore().reminders.filter(
    (r) =>
      r.characterId === characterId &&
      (r.status === "pending" || r.status === "fired") &&
      normalizeReminderContent(r.content) === normalized
  );

  for (const existing of candidates) {
    const triggerDiffMs = Math.abs(
      new Date(existing.triggerAt).getTime() - triggerAt.getTime()
    );
    const existingCreatedAgoMs = now.getTime() - new Date(existing.createdAt).getTime();

    if (
      triggerDiffMs <= NEAR_DUPLICATE_TRIGGER_TOLERANCE_MS ||
      existingCreatedAgoMs <= RECENT_DUPLICATE_CREATION_WINDOW_MS
    ) {
      return existing;
    }
  }

  return null;
}

export type DeleteReminderResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_pending" };

/**
 * pending 상태인 리마인더만 취소(삭제) 가능하다. 스케줄러가 이미 processing으로
 * 마킹한 뒤(=발화가 진행 중)라면 삭제 요청은 거부한다 — 좁은 race window지만
 * "이미 처리 중인 걸 취소했다고 착각하는" 상황을 막기 위한 최소한의 안전장치다.
 */
export function deleteReminder(id: string): DeleteReminderResult {
  const store = getStore();
  const idx = store.reminders.findIndex((r) => r.id === id);
  if (idx === -1) return { ok: false, reason: "not_found" };
  if (store.reminders[idx].status !== "pending") {
    return { ok: false, reason: "not_pending" };
  }
  store.reminders.splice(idx, 1);
  persist();
  return { ok: true };
}
