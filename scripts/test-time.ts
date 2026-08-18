/**
 * lib/time.ts의 순수 함수(resolveTriggerTime/validateTriggerTime/isValidExtractionShape/
 * formatReminderTime)를 실제 시스템 시계와 무관하게, 고정된 now 값으로 검증하는 스크립트.
 *
 * 프로젝트에 별도 테스트 프레임워크가 없어(jest/vitest 미설치) tsx로 직접 실행한다:
 *   npm run test:time
 *
 * AGENTS.md 스펙의 테스트 케이스 A~H(+연말 날짜 이동, 초/밀리초 정규화, MAX_REMINDER_DAYS
 * 경계값, formatReminderTime 분기)를 다룬다. I(어제)/J(매일)/시각 미언급 시 되묻기/K(캐릭터
 * 전환)는 프롬프트·UI·엔드투엔드 영역이라 이 스크립트로 커버할 수 없다 — 실제 앱에서 수동 확인.
 */
import {
  MAX_REMINDER_DAYS,
  formatReminderTime,
  isValidExtractionShape,
  resolveTriggerTime,
  validateTriggerTime,
} from "../lib/time";
import { ReminderExtraction } from "../types";

let passCount = 0;
let failCount = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passCount++;
    console.log(`  ok  - ${name}`);
  } catch (err) {
    failCount++;
    console.error(`FAIL  - ${name}`);
    console.error(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertDate(actual: Date, expected: Date, label: string) {
  assertEqual(actual.getTime(), expected.getTime(), `${label} (ISO: ${actual.toISOString()} vs ${expected.toISOString()})`);
}

function assertInvalid(actual: Date, label: string) {
  if (!Number.isNaN(actual.getTime())) {
    throw new Error(`${label}: expected invalid (NaN) date, got ${actual.toISOString()}`);
  }
}

// 스펙의 시나리오와 동일한 고정 현재 시각들.
const NOW_2026_08_14 = new Date(2026, 7, 14, 10, 0, 0, 0); // 2026-08-14 10:00:00.000
const NOW_2026_12_30 = new Date(2026, 11, 30, 10, 0, 0, 0); // 2026-12-30 10:00:00.000
const NOW_2026_12_31 = new Date(2026, 11, 31, 22, 0, 0, 0); // 2026-12-31 22:00:00.000

console.log("=== lib/time.ts 단위 테스트 ===\n");

// A. "1분 뒤" — 기존 relative_minutes 회귀 확인
check("A. 1분 뒤 → now + 1분 (기존 동작 회귀 없음)", () => {
  const extraction: ReminderExtraction = {
    kind: "relative_minutes",
    relative_minutes: 1,
    original_phrase: "1분 뒤",
    content: "테스트",
    source_text: "테스트",
  };
  const result = resolveTriggerTime(extraction, NOW_2026_08_14);
  assertDate(result, new Date(NOW_2026_08_14.getTime() + 60_000), "1분 뒤 결과");
  assertEqual(validateTriggerTime(result, NOW_2026_08_14).ok, true, "검증 통과 여부");
});

// B. "내일 오후 2시" → 다음 날 14:00
check("B. 내일 오후 2시 → +1일 14:00", () => {
  const extraction: ReminderExtraction = {
    kind: "relative_days",
    relative_days: 1,
    use_current_time: false,
    hour: 14,
    minute: 0,
    original_phrase: "내일 오후 2시",
    content: "테스트",
    source_text: "테스트",
  };
  const result = resolveTriggerTime(extraction, NOW_2026_08_14);
  assertDate(result, new Date(2026, 7, 15, 14, 0, 0, 0), "내일 오후 2시 결과");
});

// C. "모레 오전 9시" → +2일 09:00
check("C. 모레 오전 9시 → +2일 09:00", () => {
  const extraction: ReminderExtraction = {
    kind: "relative_days",
    relative_days: 2,
    use_current_time: false,
    hour: 9,
    minute: 0,
    original_phrase: "모레 오전 9시",
    content: "테스트",
    source_text: "테스트",
  };
  const result = resolveTriggerTime(extraction, NOW_2026_08_14);
  assertDate(result, new Date(2026, 7, 16, 9, 0, 0, 0), "모레 오전 9시 결과");
});

// D. "3일 뒤 오후 5시" → +3일 17:00
check("D. 3일 뒤 오후 5시 → +3일 17:00", () => {
  const extraction: ReminderExtraction = {
    kind: "relative_days",
    relative_days: 3,
    use_current_time: false,
    hour: 17,
    minute: 0,
    original_phrase: "3일 뒤 오후 5시",
    content: "테스트",
    source_text: "테스트",
  };
  const result = resolveTriggerTime(extraction, NOW_2026_08_14);
  assertDate(result, new Date(2026, 7, 17, 17, 0, 0, 0), "3일 뒤 오후 5시 결과");
});

// E. "내일 이 시간에" → 정확히 +1일, 현재 시:분 유지
check("E. 내일 이 시간에 → +1일, 현재 시:분 유지", () => {
  const now = new Date(2026, 7, 14, 10, 23, 0, 0);
  const extraction: ReminderExtraction = {
    kind: "relative_days",
    relative_days: 1,
    use_current_time: true,
    original_phrase: "내일 이 시간에",
    content: "테스트",
    source_text: "테스트",
  };
  const result = resolveTriggerTime(extraction, now);
  assertDate(result, new Date(2026, 7, 15, 10, 23, 0, 0), "내일 이 시간 결과");
});

// F. now=2026-08-14, "8월 20일 오후 2시"(연도 없음) → 2026-08-20 14:00
check("F. 8월 20일 오후 2시(연도 없음, now=2026-08-14) → 2026-08-20 14:00", () => {
  const extraction: ReminderExtraction = {
    kind: "date_time",
    month: 8,
    day: 20,
    hour: 14,
    minute: 0,
    original_phrase: "8월 20일 오후 2시",
    content: "테스트",
    source_text: "테스트",
  };
  const result = resolveTriggerTime(extraction, NOW_2026_08_14);
  assertDate(result, new Date(2026, 7, 20, 14, 0, 0, 0), "8월 20일 결과");
});

// G. now=2026-12-30, "1월 3일 오후 2시"(연도 없음) → 2027-01-03 14:00 (이미 지난 올해 날짜 → 내년)
check("G. 1월 3일 오후 2시(연도 없음, now=2026-12-30) → 2027-01-03 14:00", () => {
  const extraction: ReminderExtraction = {
    kind: "date_time",
    month: 1,
    day: 3,
    hour: 14,
    minute: 0,
    original_phrase: "1월 3일 오후 2시",
    content: "테스트",
    source_text: "테스트",
  };
  const result = resolveTriggerTime(extraction, NOW_2026_12_30);
  assertDate(result, new Date(2027, 0, 3, 14, 0, 0, 0), "1월 3일 결과");
});

// H. "2월 30일 오후 2시" → 등록 실패(무효 날짜)
check("H. 2월 30일 오후 2시 → 무효(NaN)", () => {
  const extraction: ReminderExtraction = {
    kind: "date_time",
    month: 2,
    day: 30,
    hour: 14,
    minute: 0,
    original_phrase: "2월 30일 오후 2시",
    content: "테스트",
    source_text: "테스트",
  };
  const result = resolveTriggerTime(extraction, NOW_2026_08_14);
  assertInvalid(result, "2월 30일 결과");
  assertEqual(validateTriggerTime(result, NOW_2026_08_14).ok, false, "검증 실패 여부");
});

// 연말 날짜 이동: relative_days가 연도 경계를 넘어가는지
check("연말 날짜 이동: relative_days=1이 12/31→1/1(다음 해)로 롤오버", () => {
  const extraction: ReminderExtraction = {
    kind: "relative_days",
    relative_days: 1,
    use_current_time: false,
    hour: 9,
    minute: 0,
    original_phrase: "내일 오전 9시",
    content: "테스트",
    source_text: "테스트",
  };
  const result = resolveTriggerTime(extraction, NOW_2026_12_31);
  assertDate(result, new Date(2027, 0, 1, 9, 0, 0, 0), "연말 롤오버 결과");
});

// 연말 날짜 이동: date_time이 연도 미지정 + 아직 안 지난 올해 날짜 → 올해로 해석
check("연말 날짜 이동: 12월 31일 23시(연도 없음, now=12/31 22:00) → 올해 그대로", () => {
  const extraction: ReminderExtraction = {
    kind: "date_time",
    month: 12,
    day: 31,
    hour: 23,
    minute: 0,
    original_phrase: "12월 31일 밤 11시",
    content: "테스트",
    source_text: "테스트",
  };
  const result = resolveTriggerTime(extraction, NOW_2026_12_31);
  assertDate(result, new Date(2026, 11, 31, 23, 0, 0, 0), "올해 12/31 결과");
});

// 연말 날짜 이동: date_time이 연도 미지정 + 이미 지난 올해 날짜 → 내년으로 롤오버
check("연말 날짜 이동: 12월 31일 21시(연도 없음, now=12/31 22:00, 이미 지남) → 내년", () => {
  const extraction: ReminderExtraction = {
    kind: "date_time",
    month: 12,
    day: 31,
    hour: 21,
    minute: 0,
    original_phrase: "12월 31일 밤 9시",
    content: "테스트",
    source_text: "테스트",
  };
  const result = resolveTriggerTime(extraction, NOW_2026_12_31);
  assertDate(result, new Date(2027, 11, 31, 21, 0, 0, 0), "내년 12/31 결과");
});

// "내일 이 시간" 초/밀리초 정규화
check("내일 이 시간: now의 초/밀리초를 0으로 정규화", () => {
  const now = new Date(2026, 7, 14, 10, 23, 47, 512); // 초=47, 밀리초=512
  const extraction: ReminderExtraction = {
    kind: "relative_days",
    relative_days: 1,
    use_current_time: true,
    original_phrase: "내일 이 시간에",
    content: "테스트",
    source_text: "테스트",
  };
  const result = resolveTriggerTime(extraction, now);
  assertDate(result, new Date(2026, 7, 15, 10, 23, 0, 0), "초/밀리초 정규화 결과");
  assertEqual(result.getSeconds(), 0, "초가 0으로 정규화됐는지");
  assertEqual(result.getMilliseconds(), 0, "밀리초가 0으로 정규화됐는지");
});

// MAX_REMINDER_DAYS 경계값
check(`MAX_REMINDER_DAYS(${MAX_REMINDER_DAYS}일) 경계값: 딱 1년 후는 통과, 그보다 하루 더 뒤는 실패`, () => {
  const now = NOW_2026_08_14;
  const withinLimit = new Date(now.getTime() + MAX_REMINDER_DAYS * 24 * 60 * 60 * 1000);
  const overLimit = new Date(now.getTime() + (MAX_REMINDER_DAYS + 1) * 24 * 60 * 60 * 1000);
  assertEqual(validateTriggerTime(withinLimit, now).ok, true, "경계값 이내는 통과해야 함");
  const overResult = validateTriggerTime(overLimit, now);
  assertEqual(overResult.ok, false, "경계값 초과는 실패해야 함");
  if (overResult.ok === false) {
    assertEqual(overResult.reason, "too_far", "실패 사유는 too_far여야 함");
  }
});

// isValidExtractionShape: relative_days/date_time shape 검증
check("isValidExtractionShape: relative_days without hour/minute/use_current_time → invalid", () => {
  const extraction: ReminderExtraction = {
    kind: "relative_days",
    relative_days: 1,
    use_current_time: false,
    original_phrase: "내일",
    content: "테스트",
    source_text: "테스트",
  };
  assertEqual(isValidExtractionShape(extraction), false, "hour/minute 없는 relative_days는 무효여야 함");
});

check("isValidExtractionShape: date_time의 month 범위 밖(13월) → invalid", () => {
  const extraction: ReminderExtraction = {
    kind: "date_time",
    month: 13,
    day: 2,
    hour: 10,
    minute: 0,
    original_phrase: "13월 2일",
    content: "테스트",
    source_text: "테스트",
  };
  assertEqual(isValidExtractionShape(extraction), false, "13월은 무효여야 함");
});

// formatReminderTime: 같은 날 / 다른 날 분기
check("formatReminderTime: 같은 날이면 시간만 표시", () => {
  const now = new Date(2026, 7, 14, 9, 0, 0, 0);
  const triggerAt = new Date(2026, 7, 14, 14, 0, 0, 0);
  assertEqual(formatReminderTime(triggerAt, now), "오후 2:00", "같은 날 포맷");
});

check("formatReminderTime: 다른 날이면 'M월 D일 ' 접두", () => {
  const now = new Date(2026, 7, 14, 9, 0, 0, 0);
  const triggerAt = new Date(2026, 7, 15, 14, 0, 0, 0);
  assertEqual(formatReminderTime(triggerAt, now), "8월 15일 오후 2:00", "다른 날 포맷");
});

console.log(`\n=== 결과: ${passCount}개 통과 / ${failCount}개 실패 ===`);
if (failCount > 0) {
  process.exit(1);
}
