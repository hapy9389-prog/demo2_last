import fs from "node:fs";
import path from "node:path";
import { CharacterMemory } from "@/types";

// Shared Memory 전용 저장소. Chat(lib/store.ts)/Story(lib/storyStore.ts) 어느 쪽에도
// 속하지 않는 제3의 독립 leaf 모듈이다 — 두 저장소는 서로도, 이 파일도 import하지 않는다.
// 반대로 이 파일은 @/types 외 어떤 store/도메인 모듈도 import하지 않는다. Chat 라우트와
// Story 라우트가 각각 이 모듈만 대칭적으로 import해서 memory를 읽고 쓴다.

interface MemoryStoreShape {
  memories: CharacterMemory[];
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "memory-store.json");

declare global {
  var __memoryStore: MemoryStoreShape | undefined;
}

function loadFromDisk(): MemoryStoreShape {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<MemoryStoreShape>;
    return { memories: Array.isArray(parsed.memories) ? parsed.memories : [] };
  } catch {
    // 파일이 없거나(첫 실행) 손상된 경우 빈 store로 시작한다.
    return { memories: [] };
  }
}

function saveToDisk(store: MemoryStoreShape) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    // 어디까지나 데모용 안전망 백업일 뿐이므로, 실패해도 서비스 자체는 계속 동작해야 한다.
    console.error("[memoryStore] JSON 백업 저장 실패:", err);
  }
}

function getStore(): MemoryStoreShape {
  if (!globalThis.__memoryStore) {
    globalThis.__memoryStore = loadFromDisk();
  }
  return globalThis.__memoryStore;
}

function persist() {
  saveToDisk(getStore());
}

// ---------- 조회 ----------

/**
 * characterId로 필터링된 기억만 반환한다(다른 캐릭터의 기억이 절대 섞이지 않는다 —
 * lib/store.ts의 getMessagesForCharacter()와 동일한 격리 원칙). 기본적으로 soft-delete된
 * 항목은 제외한다.
 */
export function getMemoriesForCharacter(
  characterId: string,
  opts: { includeDeleted?: boolean } = {}
): CharacterMemory[] {
  const { includeDeleted = false } = opts;
  return getStore().memories.filter(
    (m) => m.characterId === characterId && (includeDeleted || m.deletedAt === null)
  );
}

/**
 * Cross-Character Awareness 전용 조회(lib/crossCharacterAwareness.ts). characterId로
 * 필터링하는 getMemoriesForCharacter()와 반대로, 그 characterId를 **제외한** 모든 활성
 * Memory를 반환한다. 정렬/중요도 필터/민감정보 필터/선택은 전부 호출부의 책임이다 —
 * 여기서는 순수 조회만 한다(soft-delete만 기본 제외).
 */
export function getMemoriesExcludingCharacter(excludeCharacterId: string): CharacterMemory[] {
  return getStore().memories.filter(
    (m) => m.characterId !== excludeCharacterId && m.deletedAt === null
  );
}

// ---------- dedup ----------

// "거의 같은 말을 다르게 표현한 경우"만 병합 대상으로 삼는 보수적인 임계값. 한국어 공백
// 토큰 기준 Jaccard 유사도는 짧은 문장의 단어 하나 차이(예: "딸기 좋아함"↔"딸기 아주
// 좋아함")조차 이 값을 넘기지 못한다 — 오탐 병합보다 중복 허용을 우선하는 MVP 원칙에
// 따라 의도된 동작이다. "커피 좋아함"→"요즘 커피 싫어함" 같은 의미 충돌은 이 방식으로는
// 안정적으로 구분할 수 없으므로 애초에 병합 대상으로 삼지 않는다(별도 행으로 공존).
const MERGE_SIMILARITY_THRESHOLD = 0.8;

function normalizeMemoryContent(content: string): string {
  return content.trim().replace(/\s+/g, " ");
}

function jaccardSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalizeMemoryContent(a).split(" ").filter(Boolean));
  const tokensB = new Set(normalizeMemoryContent(b).split(" ").filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** 근접-중복 탐지 전용(§7). 병합 여부 판단에만 쓰고, 의미 충돌 감지에는 쓰지 않는다. */
export function findSimilarMemory(characterId: string, content: string): CharacterMemory | null {
  const candidates = getMemoriesForCharacter(characterId);
  let best: CharacterMemory | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = jaccardSimilarity(candidate.content, content);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore >= MERGE_SIMILARITY_THRESHOLD ? best : null;
}

/**
 * 근접-중복이 있으면 병합(내용 덮어쓰기 + importance는 max + updatedAt 갱신), 없으면 새 행을
 * 추가한다. Claude가 제안한 content/importance를 그대로 신뢰하지 않고, 저장 전 최소한의
 * 방어적 정제(trim, 길이 상한, importance clamp)를 거친다.
 */
export function upsertMemory(input: {
  characterId: string;
  content: string;
  importance: number;
  source: CharacterMemory["source"];
}): { memory: CharacterMemory; wasMerged: boolean } {
  const content = normalizeMemoryContent(input.content).slice(0, 300);
  const importance = Math.min(5, Math.max(1, Math.round(input.importance)));
  const now = new Date().toISOString();

  const similar = findSimilarMemory(input.characterId, content);
  if (similar) {
    similar.content = content;
    similar.importance = Math.max(similar.importance, importance);
    similar.updatedAt = now;
    persist();
    return { memory: similar, wasMerged: true };
  }

  const memory: CharacterMemory = {
    id: crypto.randomUUID(),
    characterId: input.characterId,
    content,
    importance,
    source: input.source,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    useCount: 0,
    deletedAt: null,
  };
  getStore().memories.push(memory);
  persist();
  return { memory, wasMerged: false };
}

// ---------- retrieval(선택) ----------

/**
 * importance*2 + recency − usagePenalty 순으로 정렬한 전체 목록을 반환하는 순수 함수(부작용
 * 없음). recency는 createdAt이 아니라 updatedAt 기준이다 — dedup 병합으로 최근에 다시
 * 확인/재진술된 기억이 오래 방치된 기억보다 자연스럽게 더 최신으로 취급되도록 하기 위함.
 */
export function rankMemories(characterId: string, now: Date = new Date()): CharacterMemory[] {
  const memories = getMemoriesForCharacter(characterId);
  const score = (m: CharacterMemory): number => {
    const daysSinceUpdated = Math.floor(
      (now.getTime() - new Date(m.updatedAt).getTime()) / (24 * 60 * 60 * 1000)
    );
    const recencyScore = Math.max(0, 5 - Math.floor(daysSinceUpdated / 3));
    const usagePenalty = Math.min(2, Math.floor(m.useCount / 5));
    return m.importance * 2 + recencyScore - usagePenalty;
  };
  return [...memories].sort((a, b) => {
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

const MAX_MEMORIES_PER_PROMPT = 5;

/**
 * 순수 함수 — rankMemories()의 상위 N개만 골라 반환한다. lastUsedAt/useCount를 갱신하지
 * 않는다(mutation 없음). 실제 "사용됨" 기록은 이 함수를 호출한 쪽이 Claude 호출을
 * 성공적으로 마친 뒤에만 markMemoriesUsed()를 별도로 호출해 반영해야 한다 — Claude 호출이
 * 실패하면 이번 턴에 조회했던 기억은 "실제로 쓰이지 않은 것"이므로 사용 기록이 남으면
 * 안 된다.
 */
export function selectMemoriesForPrompt(
  characterId: string,
  now: Date = new Date()
): CharacterMemory[] {
  return rankMemories(characterId, now).slice(0, MAX_MEMORIES_PER_PROMPT);
}

/** Claude 호출이 성공했을 때만 caller가 호출한다. selectMemoriesForPrompt()와 분리된 별도 단계다. */
export function markMemoriesUsed(ids: string[], now: Date = new Date()): void {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  const nowISO = now.toISOString();
  let changed = false;
  for (const memory of getStore().memories) {
    if (idSet.has(memory.id)) {
      memory.lastUsedAt = nowISO;
      memory.useCount += 1;
      changed = true;
    }
  }
  if (changed) persist();
}

// ---------- Memory Manager(사용자 직접 CRUD) ----------

/** memoryId 단건 조회. deletedAt 여부와 무관하게 반환한다(ownership/상태 검증은 호출부 책임). */
export function getMemoryById(id: string): CharacterMemory | undefined {
  return getStore().memories.find((m) => m.id === id);
}

export type UpdateImportanceResult =
  | { ok: true; memory: CharacterMemory }
  | { ok: false; reason: "not_found" | "already_deleted" };

/**
 * importance만 변경한다(1~5 clamp). updatedAt은 의도적으로 건드리지 않는다 — updatedAt은
 * "이 기억의 내용이 마지막으로 갱신/재확인된 시각"이라는 의미로 upsertMemory()의 생성/
 * dedup-merge 경로에서만 쓰이며, rankMemories()의 recencyScore가 이를 "최근에 다시
 * 확인된 사실"이라는 신호로 해석한다. 단순 중요도 재평가는 내용이 새로 확인된 것이
 * 아니므로 이 의미를 침범하지 않는다 — 그래서 중요도 변경은 ranking의 importance*2 항에만
 * 반영되고 recencyScore는 그대로 유지된다.
 */
export function updateMemoryImportance(id: string, importance: number): UpdateImportanceResult {
  const memory = getStore().memories.find((m) => m.id === id);
  if (!memory) return { ok: false, reason: "not_found" };
  if (memory.deletedAt !== null) return { ok: false, reason: "already_deleted" };
  memory.importance = Math.min(5, Math.max(1, Math.round(importance)));
  persist();
  return { ok: true, memory };
}

/**
 * 사용자가 MemoryPanel에서 직접 추가하는 기억의 유일한 진입점. upsertMemory()를 그대로
 * 재사용해 dedup(findSimilarMemory, Jaccard≥0.8 merge)까지 자동/수동 기억이 완전히 동일한
 * 경로를 타게 한다 — "manual"이라는 source 태그만 여기서 붙인다. content 길이 검증(300자
 * 초과 거부)은 이 함수의 책임이 아니라 호출부(app/api/memories/route.ts)가 upsertMemory
 * 호출 이전에 이미 끝낸 상태여야 한다 — 여기서는 자동 extraction과 동일하게 그냥
 * 저장한다(이중 truncate는 no-op이므로 안전).
 */
export function createManualMemory(input: {
  characterId: string;
  content: string;
  importance: number;
}): { memory: CharacterMemory; wasMerged: boolean } {
  return upsertMemory({ ...input, source: { type: "manual", refId: "manual" } });
}

// ---------- 삭제 ----------

export type SoftDeleteMemoryResult = { ok: true } | { ok: false; reason: "not_found" };

/**
 * soft delete. MVP에서는 이 함수만 존재하고 API/UI에는 연결하지 않는다 — 나중에 얇은 라우트
 * 추가만으로 삭제 기능을 얹을 수 있도록 미리 마련해 둔 것이다.
 */
export function softDeleteMemory(id: string): SoftDeleteMemoryResult {
  const memory = getStore().memories.find((m) => m.id === id);
  if (!memory) return { ok: false, reason: "not_found" };
  memory.deletedAt = new Date().toISOString();
  persist();
  return { ok: true };
}
