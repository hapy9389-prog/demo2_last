/**
 * 홈 화면(Spotlight + CharacterCard 그리드)의 "캐릭터 상태" 판단을 담당하는 순수 함수 모음.
 *
 * `HomeSpotlight`/`CharacterCard`가 각자 상태를 판단하면 문구가 어긋날 위험이 있어서, 판단
 * 로직을 이 파일 한 곳에 모으고 UI는 결과만 받아 렌더링한다. `lib/interactionTime.ts`와 같은
 * 관례로 `now`를 인자로 받고(기본값만 `new Date()`) 내부에서 무조건 새로 만들지 않는다 —
 * 테스트에서 고정된 `now`/`lastUserMessageAt` 값을 주입해 실제 메시지 데이터 없이 결정론적으로
 * 검증할 수 있게 하기 위함이다(scripts/test-home-status.ts 참고).
 *
 * 새 임계값을 여기서 만들지 않는다 — 경과 시간 tier는 전부 lib/interactionTime.ts를 그대로
 * 재사용하고, 이 파일은 그 결과를 홈 화면 표시용 우선순위/문구로 옮기는 역할만 한다.
 */

import { Character, Message, ReminderWithCharacter } from "@/types";
import { formatReminderTime } from "./time";
import {
  InteractionGap,
  InteractionRelevanceTier,
  calculateInteractionGap,
  getInteractionRelevanceTier,
} from "./interactionTime";

/** 홈 화면 한 캐릭터 행. ChatApp.tsx가 allMessages/reminders로부터 계산해 만든다. */
export interface HomeRow {
  character: Character;
  /** role 무관 마지막 메시지 — 목록 미리보기 텍스트/시각용. */
  lastMessage?: Message;
  /**
   * 마지막 "user" 메시지 시각(ISO). lib/store.ts의 getLastUserMessageAt()과 동일한 정의를
   * 클라이언트에서 재현한 값이다. 대화 이력이 없으면 null.
   */
  lastUserMessageAt: string | null;
  /** 이 캐릭터의 가장 가까운 pending 리마인더(있으면). */
  nearestPendingReminder?: ReminderWithCharacter;
  unread: boolean;
}

export type CharacterStatus =
  | { kind: "unread" }
  | { kind: "reminder"; reminder: ReminderWithCharacter }
  | { kind: "elapsed"; gap: InteractionGap; tier: InteractionRelevanceTier }
  | { kind: "new" };

/** 우선순위: unread > pending reminder 존재 > 마지막 대화 경과(tier) > 대화 이력 없음. */
export function getCharacterStatus(row: HomeRow, now: Date = new Date()): CharacterStatus {
  if (row.unread) return { kind: "unread" };
  if (row.nearestPendingReminder) {
    return { kind: "reminder", reminder: row.nearestPendingReminder };
  }
  if (row.lastUserMessageAt) {
    const gap = calculateInteractionGap(new Date(row.lastUserMessageAt), now);
    const tier = getInteractionRelevanceTier(gap);
    return { kind: "elapsed", gap, tier };
  }
  return { kind: "new" };
}

/** elapsed tier → 홈 화면용 짧은 한글 라벨. */
function elapsedLabel(tier: InteractionRelevanceTier, gap: InteractionGap): string {
  switch (tier) {
    case "none":
    case "light":
      return "최근 대화";
    case "notable":
      return "오늘 대화함";
    case "several_days":
      return `${gap.days}일 전 대화`;
    case "long":
    case "very_long":
    case "extremely_long":
      return `오랜만이에요 · ${gap.days}일 전`;
  }
}

/**
 * `CharacterStatus`를 한 줄 문구로 바꾼다. `kind: "new"`는 표시할 상태 문구가 없다는 뜻이라
 * 빈 문자열을 반환 — 호출부는 이 경우 캐릭터 tagline 등으로 대체해서 보여준다.
 */
export function describeCharacterStatus(status: CharacterStatus, now: Date = new Date()): string {
  switch (status.kind) {
    case "unread":
      return "새 메시지";
    case "reminder":
      return `🔔 ${formatReminderTime(new Date(status.reminder.triggerAt), now)} 알림`;
    case "elapsed":
      return elapsedLabel(status.tier, status.gap);
    case "new":
      return "";
  }
}

export type SpotlightReason = "long_absence" | "recent" | "first_time";

export interface SpotlightPick {
  row: HomeRow;
  reason: SpotlightReason;
}

const LONG_ABSENCE_TIERS: InteractionRelevanceTier[] = ["long", "very_long", "extremely_long"];

/**
 * 홈 Spotlight에 띄울 캐릭터 1명을 고른다(우선순위 캐스케이드):
 * 1) 3일 이상(long/very_long tier) 대화하지 않은 캐릭터가 있으면 그중 가장 오래 안 온 캐릭터.
 * 2) 없으면 가장 최근에 메시지가 오간 캐릭터(role 무관, lastMessage 기준).
 * 3) 대화 이력이 전혀 없으면(첫 실행) fallbackCharacterId(보통 DEFAULT_CHARACTER_ID)를
 *    "말을 걸어보세요" 톤(reason: "first_time")으로 반환.
 */
export function pickSpotlightCharacter(
  rows: HomeRow[],
  now: Date = new Date(),
  fallbackCharacterId?: string
): SpotlightPick | null {
  if (rows.length === 0) return null;

  let longAbsenceBest: { row: HomeRow; gap: InteractionGap } | null = null;
  for (const row of rows) {
    if (!row.lastUserMessageAt) continue;
    const gap = calculateInteractionGap(new Date(row.lastUserMessageAt), now);
    const tier = getInteractionRelevanceTier(gap);
    if (!LONG_ABSENCE_TIERS.includes(tier)) continue;
    if (!longAbsenceBest || gap.totalMinutes > longAbsenceBest.gap.totalMinutes) {
      longAbsenceBest = { row, gap };
    }
  }
  if (longAbsenceBest) return { row: longAbsenceBest.row, reason: "long_absence" };

  let mostRecent: { row: HomeRow; createdAt: string } | null = null;
  for (const row of rows) {
    if (!row.lastMessage) continue;
    if (!mostRecent || row.lastMessage.createdAt > mostRecent.createdAt) {
      mostRecent = { row, createdAt: row.lastMessage.createdAt };
    }
  }
  if (mostRecent) return { row: mostRecent.row, reason: "recent" };

  const fallbackRow =
    (fallbackCharacterId && rows.find((r) => r.character.id === fallbackCharacterId)) || rows[0];
  return { row: fallbackRow, reason: "first_time" };
}
