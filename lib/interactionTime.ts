/**
 * 캐릭터의 "시간 인식(time awareness)" 기능 전용 순수 계산 함수 모음.
 *
 * Claude는 사용자와의 마지막 대화 이후 실제로 얼마나 시간이 지났는지 직접 계산하지
 * 않는다 — 이 파일이 서버에서 deterministic하게 경과 시간을 계산하고, Claude는 그
 * 결과(정확한 일/시/분 숫자)를 캐릭터 성격에 맞게 "어떻게 표현할지"만 결정한다.
 *
 * 기존 lib/time.ts(리마인더 시간 계산)와는 별개의 관심사라 별도 파일로 분리했다.
 * KST 처리 방식은 lib/time.ts와 동일한 컨벤션을 따른다 — 별도 타임존 변환 라이브러리를
 * 추가하지 않고, 서버 프로세스의 로컬 타임존이 KST라는 전제하에 순수 Date 연산만 쓴다
 * (기동 시 타임존 sanity check는 lib/time.ts에 이미 있으므로 여기서 중복하지 않는다).
 */

export interface InteractionGap {
  totalMinutes: number;
  days: number;
  hours: number;
  minutes: number;
}

/**
 * 마지막 사용자 대화 이후 경과 시간을 계산한다. now를 인자로 받아 테스트에서 고정된
 * 값을 주입할 수 있다(함수 내부에서 무조건 new Date()를 호출하지 않음).
 */
export function calculateInteractionGap(
  lastInteractionAt: Date,
  now: Date = new Date()
): InteractionGap {
  // 시계가 살짝 어긋나거나 lastInteractionAt이 미래인 비정상 케이스를 방어적으로 0에 clamp.
  const totalMs = Math.max(0, now.getTime() - lastInteractionAt.getTime());
  const totalMinutes = Math.floor(totalMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  return { totalMinutes, days, hours, minutes };
}

// 시간 경과에 따른 반응 강도(relevance) 티어 경계값. 분 단위, 하한 포함(inclusive).
// 나중에 쉽게 조정할 수 있도록 상수로 분리한다.
export const NONE_THRESHOLD_MINUTES = 30; // <30분: 언급 안 함
export const LIGHT_THRESHOLD_MINUTES = 6 * 60; // 30분~6시간: 가벼운 인식
export const NOTABLE_THRESHOLD_MINUTES = 24 * 60; // 6~24시간: "오늘 바빴어?" 정도
export const SEVERAL_DAYS_THRESHOLD_MINUTES = 3 * 24 * 60; // 1~3일: 꽤 오랜만 인식
export const LONG_ABSENCE_THRESHOLD_MINUTES = 7 * 24 * 60; // 3~7일: 적극적 반응
// 7일~30일: 강한 복귀 반응(very_long)
export const EXTREMELY_LONG_THRESHOLD_MINUTES = 30 * 24 * 60; // >=30일: 한 단계 더 강한 반응

export type InteractionRelevanceTier =
  | "none"
  | "light"
  | "notable"
  | "several_days"
  | "long"
  | "very_long"
  | "extremely_long";

export function getInteractionRelevanceTier(gap: InteractionGap): InteractionRelevanceTier {
  const m = gap.totalMinutes;
  if (m < NONE_THRESHOLD_MINUTES) return "none";
  if (m < LIGHT_THRESHOLD_MINUTES) return "light";
  if (m < NOTABLE_THRESHOLD_MINUTES) return "notable";
  if (m < SEVERAL_DAYS_THRESHOLD_MINUTES) return "several_days";
  if (m < LONG_ABSENCE_THRESHOLD_MINUTES) return "long";
  if (m < EXTREMELY_LONG_THRESHOLD_MINUTES) return "very_long";
  return "extremely_long";
}

/** "2026-08-14 21:30 KST" 형식. lib/time.ts와 동일하게 Intl 없이 순수 Date getter만 사용. */
function formatTimestampForPrompt(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d} ${h}:${mi} KST`;
}

/** "8일 3시간 40분"처럼 0인 단위는 생략한 한글 경과 시간 표기. 테스트를 위해 export한다. */
export function formatElapsedKorean(gap: InteractionGap): string {
  const parts: string[] = [];
  if (gap.days > 0) parts.push(`${gap.days}일`);
  if (gap.hours > 0) parts.push(`${gap.hours}시간`);
  if (gap.minutes > 0 || parts.length === 0) parts.push(`${gap.minutes}분`);
  return parts.join(" ");
}

// tier별로 Claude에게 주는 "반응 강도" 가이드 한 줄. 문구 자체를 강제하지 않고
// 강도만 알려준다 — 실제 표현은 항상 Claude(캐릭터 성격)가 결정한다.
const TIER_GUIDANCE: Record<Exclude<InteractionRelevanceTier, "none">, string> = {
  light: "굳이 언급하지 않아도 됩니다. 언급한다면 아주 가볍게만 하세요.",
  notable: "'오늘 바빴어?' 정도의 자연스러운 언급이 어울립니다.",
  several_days: "꽤 오랜만이라는 사실을 인식할 만합니다.",
  long: "적극적으로 오랜만이라는 반응을 보일 수 있습니다.",
  very_long: "강한 복귀 반응을 보여도 좋습니다. 캐릭터 성격이 확실히 드러나게 하세요.",
  extremely_long:
    "이번엔 특히 오래 비어 있었던 시간입니다. very_long보다 한 단계 더 놀람·서운함·걱정·반가움 중 " +
    "캐릭터에게 어울리는 감정을 뚜렷하게 드러내세요. 단, 사용자를 비난하거나 다그치지 말고, " +
    "위협·협박이나 과도한 집착을 강요하는 표현으로 흐르지 않게 하세요.",
};

/**
 * <time_awareness> context 블록을 만든다. tier가 "none"(30분 미만)이면 null을 반환해
 * context 자체를 아예 보내지 않는다 — "언급하지 않는다"를 Claude의 재량이 아니라
 * 서버가 기계적으로 보장하기 위함이다.
 */
export function buildTimeAwarenessContext(
  gap: InteractionGap,
  tier: InteractionRelevanceTier,
  now: Date
): string | null {
  if (tier === "none") return null;

  return `<time_awareness>
현재 시각: ${formatTimestampForPrompt(now)}
마지막 사용자 대화 이후 경과 시간: ${formatElapsedKorean(gap)}
elapsed_days: ${gap.days}
elapsed_hours: ${gap.hours}
elapsed_minutes: ${gap.minutes}

이 시간 정보는 서버가 계산한 정확한 값입니다. 직접 다시 계산하거나 수정하지 마세요.
${TIER_GUIDANCE[tier]}
필요하다면 이 시간의 흐름을 캐릭터 성격에 맞게 자연스럽게 반영하세요. 매 응답마다 반드시 시간 이야기를 할 필요는 없습니다.
</time_awareness>`;
}

/**
 * lastInteractionAtISO(없으면 null=첫 대화) → gap 계산 → tier 판정 → context 조립까지
 * 한 번에 처리하는 조합 헬퍼. 호출부(app/api/chat/route.ts)는 이 함수 하나만 부르면 된다.
 */
export function buildTimeAwarenessForCharacter(
  lastInteractionAtISO: string | null,
  now: Date = new Date()
): string | null {
  if (!lastInteractionAtISO) return null; // 이 캐릭터와의 첫 대화 — 경과 시간 개념이 없음
  const gap = calculateInteractionGap(new Date(lastInteractionAtISO), now);
  const tier = getInteractionRelevanceTier(gap);
  return buildTimeAwarenessContext(gap, tier, now);
}
