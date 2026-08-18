import { ReminderExtraction } from "@/types";

/**
 * 이 서버는 KST(Asia/Seoul, UTC+9, DST 없음)에서 실행된다고 가정한다.
 * 모든 리마인더 시간 계산은 Date의 로컬 타임존 메서드(setHours/setDate/setFullYear 등)를
 * 그대로 사용하며 별도의 타임존 변환은 하지 않는다 — 서버 프로세스의 로컬 타임존이
 * 실제로 KST가 아니면 계산 결과 전체가 어긋난다. 복잡한 타임존 변환 라이브러리를 추가하는
 * 대신, 기동 시 한 번 실제 타임존이 이 가정과 맞는지만 확인하고 어긋나면 경고를 남긴다.
 */
export const ASSUMED_TIMEZONE = "Asia/Seoul";
// getTimezoneOffset()은 (UTC - 로컬) 분 단위를 반환한다. KST(UTC+9) → -540.
const KST_UTC_OFFSET_MINUTES = -540;

const actualOffset = new Date().getTimezoneOffset();
if (actualOffset !== KST_UTC_OFFSET_MINUTES) {
  console.warn(
    `[time] 서버 타임존이 ${ASSUMED_TIMEZONE}(UTC+9)가 아닌 것 같습니다 ` +
      `(getTimezoneOffset=${actualOffset}). 리마인더 시간 계산이 실제 KST와 어긋날 수 있습니다.`
  );
}

// 리마인더를 얼마나 먼 미래까지 등록할 수 있는지의 상한선(일 단위). 상수로 분리해 조정 용이하게 한다.
export const MAX_REMINDER_DAYS = 365;
const MAX_FUTURE_MS = MAX_REMINDER_DAYS * 24 * 60 * 60 * 1000;

/**
 * year/month/day 조합이 실제로 존재하는 달력 날짜인지 확인한다.
 * JS Date 생성자는 "2월 30일" 같은 잘못된 날짜를 예외 없이 다음 달로 밀어 넣어(예: 3월 2일)
 * 자동 정규화해버리므로, 생성된 Date의 구성 요소가 입력과 그대로 일치하는지 되짚어 검증해야
 * 잘못된 날짜를 걸러낼 수 있다. (2월 29일의 유효성은 이 함수에 전달된 year가 윤년인지에 달려있다.)
 */
function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const d = new Date(year, month - 1, day);
  return (
    d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day
  );
}

/**
 * Claude가 schedule_reminder tool로 추출한 구조화된 시간 표현(kind + 필드)을
 * 서버가 결정적으로(deterministic) 절대 시각으로 변환한다.
 *
 * Claude는 이 계산에 전혀 관여하지 않는다 — "1분 뒤", "오후 2시", "내일", "8월 20일" 같은 표현의
 * 실제 날짜/시:분 산술은 LLM이 아니라 여기서만 일어나므로 계산 오류 가능성이 없고,
 * 이 함수만 독립적으로 테스트할 수 있다.
 */
export function resolveTriggerTime(
  extraction: ReminderExtraction,
  now: Date = new Date()
): Date {
  if (extraction.kind === "relative_minutes") {
    return new Date(now.getTime() + extraction.relative_minutes * 60_000);
  }

  if (extraction.kind === "time_of_day") {
    // 오늘 날짜에 hour:minute을 그대로 적용한다.
    const result = new Date(now);
    result.setHours(extraction.hour, extraction.minute, 0, 0);
    return result;
  }

  if (extraction.kind === "relative_days") {
    const result = new Date(now);
    result.setDate(result.getDate() + extraction.relative_days);
    if (extraction.use_current_time) {
      // "내일 이 시간에" — 지금 시:분을 그대로 쓰되, 초/밀리초는 항상 0으로 정규화한다.
      // (setDate만으로는 now의 초/밀리초가 그대로 남아 어중간한 값이 되기 때문)
      result.setHours(now.getHours(), now.getMinutes(), 0, 0);
      return result;
    }
    if (extraction.hour === undefined || extraction.minute === undefined) {
      // 시각도 use_current_time도 없는 잘못된 추출 — 방어적으로 무효 처리.
      return new Date(NaN);
    }
    result.setHours(extraction.hour, extraction.minute, 0, 0);
    return result;
  }

  // date_time: 특정 월/일(+선택적 연도) + 시각.
  const { month, day, hour, minute } = extraction;
  const candidateYears =
    extraction.year !== undefined ? [extraction.year] : [now.getFullYear(), now.getFullYear() + 1];

  for (const year of candidateYears) {
    if (!isValidCalendarDate(year, month, day)) {
      // 이 month/day 조합 자체가 무효(예: 2월 30일)면 어떤 연도를 시도해도 무효이므로
      // 더 시도하지 않고 바로 실패시킨다.
      return new Date(NaN);
    }
    const candidate = new Date(year, month - 1, day, hour, minute, 0, 0);
    if (extraction.year !== undefined || candidate.getTime() > now.getTime()) {
      return candidate;
    }
    // 연도 미지정 + 올해 날짜가 이미 지났으면 다음 연도 후보로 넘어간다.
  }
  return new Date(NaN);
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: "past" | "too_far" | "invalid" };

/** 계산된 triggerAt이 실제로 리마인더로 등록할 만한 값인지 검증한다. */
export function validateTriggerTime(
  triggerAt: Date,
  now: Date = new Date()
): ValidationResult {
  if (Number.isNaN(triggerAt.getTime())) return { ok: false, reason: "invalid" };
  if (triggerAt.getTime() <= now.getTime()) return { ok: false, reason: "past" };
  if (triggerAt.getTime() - now.getTime() > MAX_FUTURE_MS) {
    return { ok: false, reason: "too_far" };
  }
  return { ok: true };
}

/** Claude tool_use의 raw input이 스키마상 유효한 값 범위인지 확인한다(자릿수/범위 sanity check). */
export function isValidExtractionShape(extraction: ReminderExtraction): boolean {
  if (extraction.kind === "relative_minutes") {
    return (
      Number.isFinite(extraction.relative_minutes) && extraction.relative_minutes > 0
    );
  }
  if (extraction.kind === "time_of_day") {
    return (
      Number.isInteger(extraction.hour) &&
      extraction.hour >= 0 &&
      extraction.hour <= 23 &&
      Number.isInteger(extraction.minute) &&
      extraction.minute >= 0 &&
      extraction.minute <= 59
    );
  }
  if (extraction.kind === "relative_days") {
    if (!Number.isInteger(extraction.relative_days) || extraction.relative_days < 1) {
      return false;
    }
    if (extraction.use_current_time) return true;
    return (
      extraction.hour !== undefined &&
      Number.isInteger(extraction.hour) &&
      extraction.hour >= 0 &&
      extraction.hour <= 23 &&
      extraction.minute !== undefined &&
      Number.isInteger(extraction.minute) &&
      extraction.minute >= 0 &&
      extraction.minute <= 59
    );
  }
  if (extraction.kind === "date_time") {
    if (extraction.year !== undefined && !Number.isInteger(extraction.year)) return false;
    // day는 1-31 범위만 본다 — 실제 월별 일수/윤년 검증은 연도가 정해져야 가능하므로
    // resolveTriggerTime의 isValidCalendarDate()가 담당한다.
    return (
      Number.isInteger(extraction.month) &&
      extraction.month >= 1 &&
      extraction.month <= 12 &&
      Number.isInteger(extraction.day) &&
      extraction.day >= 1 &&
      extraction.day <= 31 &&
      Number.isInteger(extraction.hour) &&
      extraction.hour >= 0 &&
      extraction.hour <= 23 &&
      Number.isInteger(extraction.minute) &&
      extraction.minute >= 0 &&
      extraction.minute <= 59
    );
  }
  return false;
}

/** "오후 1:35" 같은 한글 시간 표기로 변환. 리마인더 등록 배너/패널 표시용. */
export function formatKoreanTime(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours < 12 ? "오전" : "오후";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${period} ${hour12}:${String(minutes).padStart(2, "0")}`;
}

/**
 * 리마인더 표시 전용 포맷터. triggerAt이 오늘이면 formatKoreanTime()과 동일하게 시간만
 * 보여주고, 오늘이 아니면 "8월 15일 오후 2:00"처럼 날짜를 앞에 붙인다.
 * formatKoreanTime() 자체는 메시지 타임스탬프(항상 오늘) 표시에 계속 쓰이므로 건드리지 않는다.
 */
export function formatReminderTime(triggerAt: Date, now: Date = new Date()): string {
  const sameDay =
    triggerAt.getFullYear() === now.getFullYear() &&
    triggerAt.getMonth() === now.getMonth() &&
    triggerAt.getDate() === now.getDate();
  if (sameDay) return formatKoreanTime(triggerAt);
  return `${triggerAt.getMonth() + 1}월 ${triggerAt.getDate()}일 ${formatKoreanTime(triggerAt)}`;
}
