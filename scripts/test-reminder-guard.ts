/**
 * lib/reminderGuard.ts의 isExplicitReminderRequest()/isSourceTextFromCurrentMessage()를
 * 검증하는 스크립트. tsx로 직접 실행한다: npm run test:guard
 *
 * "리마인더 재등록 버그" 수정의 핵심 방어선이므로, 등록 가능/금지 문장 목록과 원본 버그
 * 재현 문장을 전수 검증한다.
 */
import { isExplicitReminderRequest, isSourceTextFromCurrentMessage } from "../lib/reminderGuard";

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

console.log("=== lib/reminderGuard.ts 단위 테스트 ===\n");

console.log("--- isExplicitReminderRequest: 등록 가능(true) ---");
const allowCases = [
  "3분 뒤 알려줘",
  "내일 오후 2시에 알려줘",
  "2분 뒤에 다시 알려줘",
  "8월 20일 오후 3시에 알려줘",
  "혹시 3분 뒤에 나 좀 반갑게 맞이해줄 수 있어? 부탁할게", // 원본 버그 재현 문장
  "1분 뒤 물 마시라고 알려줘",
  "1분 뒤 공부하라고 알려줘",
  "모레 오전 9시에 알려줘",
  "3일 뒤 오후 5시에 알려줘",
  "일주일 뒤 오후 3시에 알려줘",
  "내일 이 시간에 알려줘",
  "2026년 8월 20일 오후 2시에 알려줘",
  "30분 뒤에 깨워줘",
  "저녁 7시에 기억해줘",
  "내일 오후 2시에 리마인더 좀 걸어줄래?",
  "8월 20일에 알림 설정해줘",
  // "해줘" 앞 동사를 열거하지 않는 일반화(GENERIC_HAE_DIRECTIVE_REGEX) 케이스
  "1분 뒤에 잔소리 좀 해줘",
  "1분 뒤에 응원해줘",
  "10분 뒤 힘내라고 한마디 해줘",
  "내일 오후 2시에 잘 보라고 응원해줘",
  "5분 뒤 공부하라고 해줄래?",
  "3분 뒤 반갑게 맞이해줄 수 있어?",
  "나 공부하게 1분 뒤에 잔소리 좀 해줘",
  "내일 아침에 좋은 아침이라고 말해줘",
  "30분 뒤에 나 좀 깨워줘",
  "3분 뒤 반갑게 맞이해줘",
];
for (const s of allowCases) {
  check(`"${s}" → true`, () => {
    assertEqual(isExplicitReminderRequest(s), true, "isExplicitReminderRequest");
  });
}

console.log("\n--- isExplicitReminderRequest: 등록 금지(false) ---");
const denyCases = [
  "고마워",
  "알려줘서 고마워",
  "됐어",
  "이제 그만해",
  "응",
  "다른 얘기하자",
  "알겠어",
  "왜 이렇게 늦었어?",
  "그랬구나",
  "오늘 기분 어때?",
  "3시간 동안 공부했어",
  "내일 알림 기능 이상하지 않아?", // standalone noun만으로는 인정하지 않아야 함
  "알림 설정해줘", // 시간 표현이 없음
  // "해" 일반화 이후에도 여전히 차단돼야 하는 케이스
  "응원해줘", // 시간 표현 없음
  "잔소리해줘", // 시간 표현 없음
  "잔소리 좀 해줘", // 시간 표현 없음
  "내일 응원 기능도 만들까?", // 질문형, 요청 아님
  "내일 응원이라는 기능 넣으면 어때?", // 질문형, 요청 아님
  // 과거 언급 — TIME_EXPRESSION_PATTERNS가 미래형 어미만 인식하므로 "해달라"가 directive를
  // true로 만들어도 hasTime이 false라 최종적으로 차단돼야 하는 핵심 회귀 방지 케이스
  "1분 전에 응원해달라고 했잖아",
];
for (const s of denyCases) {
  check(`"${s}" → false`, () => {
    assertEqual(isExplicitReminderRequest(s), false, "isExplicitReminderRequest");
  });
}

console.log("\n--- isSourceTextFromCurrentMessage ---");
check('동일 문구 포함 → true', () => {
  assertEqual(
    isSourceTextFromCurrentMessage("3분 뒤 알려줘", "3분 뒤 알려줘"),
    true,
    "동일 문구"
  );
});
check('history에서 가져온 문구(현재 메시지엔 없음) → false', () => {
  assertEqual(isSourceTextFromCurrentMessage("3분 뒤 알려줘", "고마워"), false, "history 유래");
});
check("빈 source_text → false", () => {
  assertEqual(isSourceTextFromCurrentMessage("", "3분 뒤 알려줘"), false, "빈 문자열");
});
check("현재 메시지 일부로 실제 포함된 경우 → true", () => {
  assertEqual(
    isSourceTextFromCurrentMessage(
      "내일 오후 2시에 알려줘",
      "음.. 내일 오후 2시에 알려줘 고마워"
    ),
    true,
    "부분 포함"
  );
});

console.log(`\n=== 결과: ${passCount}개 통과 / ${failCount}개 실패 ===`);
if (failCount > 0) {
  process.exit(1);
}
