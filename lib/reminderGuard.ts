/**
 * "현재 user message 자체가 명시적인 새 리마인더 요청인지"를 서버가 결정적으로(non-LLM)
 * 재검증하는 hard guard 두 개. Claude가 conversation history 속 과거 리마인더 요청을
 * 잘못 재해석해 schedule_reminder tool을 호출하더라도, 아래 두 검사를 모두 통과하지
 * 못하면 app/api/chat/route.ts는 리마인더를 생성하지 않는다 — prompt 방어(tool
 * description/system prompt)만으로는 LLM의 확률적 오류를 100% 막을 수 없기 때문에
 * 존재하는 결정적 2차 방어선이다.
 *
 * 철학: false negative(진짜 요청을 놓치는 것)보다 false positive(요청하지 않은 리마인더가
 * 자동 생성되는 것)가 훨씬 나쁘다. 애매하면 등록하지 않는 방향으로 보수적으로 판단한다.
 */

// 정규화: 공백을 모두 제거해 "알려 줘"/"알려줘", "3분 뒤"/"3분뒤" 같은 띄어쓰기 편차를 흡수한다.
function normalize(message: string): string {
  return message.replace(/\s+/g, "");
}

const TIME_EXPRESSION_PATTERNS: RegExp[] = [
  /\d+분(뒤|후|있다가|이따가|이따)/, // "3분 뒤", "10분 있다가"
  /\d+시간(뒤|후|있다가|이따가|이따)/, // "1시간 뒤"
  /\d+일(뒤|후)/, // "3일 뒤"
  /\d+주(뒤|후)/, // "2주 뒤"
  /일주일(뒤|후)/, // "일주일 뒤"
  /(내일|모레|글피)/, // 상대 일수 단어(멀티데이 기능과 호환)
  /\d+월\d+일/, // "8월 20일" (연도 접두 여부 무관)
  /(오전|오후)\d+시/, // "오후 2시"
  /(아침|저녁|밤|낮|점심)\d*시/, // "저녁 7시"
  /이시간에|이맘때/, // "이 시간에" (use_current_time)
];

// 동사 stem + 흔한 요청형 어미 조합. "맞이해줄 수 있어?"처럼 완곡한 청유형도 잡도록
// 어미를 "줘" 외에 "줄래/줄수/주세요/달라" 등으로 넓혀둔다(원 버그 리포트의 실제 문장 기준).
const DIRECTIVE_STEMS = ["알려", "기억해", "말해", "깨워", "불러", "맞이해", "챙겨", "리마인드"];
const DIRECTIVE_ENDINGS = [
  "줘",
  "줄래",
  "줄수",
  "주라",
  "주세요",
  "주면",
  "달라",
  "달래",
  "줬으면",
  "줄게",
  "주었으면",
  "주실래",
  "주실수",
  "주시겠",
];
const DIRECTIVE_REGEX = new RegExp(
  `(?:${DIRECTIVE_STEMS.join("|")})(?:${DIRECTIVE_ENDINGS.join("|")})`
);

// "알림"/"리마인더" 같은 명사는 단독 등장만으로는 요청으로 인정하지 않는다("내일 알림
// 기능 이상하지 않아?" 같은 일반 대화를 걸러내기 위함). 명사 언급 뒤 가까운 거리(10자
// 이내)에 요청형 어미가 실제로 붙어 있을 때만("알림 설정해줘", "리마인더 좀 걸어줄래?")
// 요청으로 인정한다.
const STANDALONE_DIRECTIVE_NOUNS = ["알림", "리마인더"];
const NOUN_ENDING_WINDOW = 10;
const NOUN_DIRECTIVE_REGEX = new RegExp(
  `(?:${STANDALONE_DIRECTIVE_NOUNS.join("|")}).{0,${NOUN_ENDING_WINDOW}}(?:${DIRECTIVE_ENDINGS.join("|")})`
);

// "잔소리해줘"/"응원해줘"/"공부하라고 해줄래"처럼 특정 동사를 미리 열거하지 않고,
// "해"+요청형 어미가 결합하는 생산적인 한국어 패턴을 통째로 인정한다. DIRECTIVE_ENDINGS를
// 그대로 재사용하므로 "요청형 표현"의 정의 자체는 그대로 두고 "그 앞에 어떤 동사/명사가
// 와도 된다"로만 일반화한 것 — DIRECTIVE_STEMS 중 "기억해"/"말해"/"맞이해"도 이미 "…해"로
// 끝나므로 이 패턴의 부분집합이지만, 하위 호환을 위해 기존 DIRECTIVE_REGEX는 그대로 둔다.
const GENERIC_HAE_DIRECTIVE_REGEX = new RegExp(`해(?:${DIRECTIVE_ENDINGS.join("|")})`);

function hasReminderDirective(normalized: string): boolean {
  return (
    DIRECTIVE_REGEX.test(normalized) ||
    NOUN_DIRECTIVE_REGEX.test(normalized) ||
    GENERIC_HAE_DIRECTIVE_REGEX.test(normalized)
  );
}

/**
 * 현재 메시지 자체에 (A) 시간 표현과 (B) 알림/행동 요청 표현이 "모두" 있어야 true.
 * 하나만 있는 일반 대화(예: "고마워", "알려줘서 고마워")는 등록 대상이 아니다.
 */
export function isExplicitReminderRequest(currentUserMessage: string): boolean {
  const normalized = normalize(currentUserMessage);
  if (!normalized) return false;
  const hasTime = TIME_EXPRESSION_PATTERNS.some((pattern) => pattern.test(normalized));
  return hasTime && hasReminderDirective(normalized);
}

/**
 * Claude가 schedule_reminder tool 호출과 함께 반환한 source_text(리마인더 요청의 근거로
 * 삼은 원문)가 실제로 현재 사용자 메시지 안에 존재하는 문자열인지 확인한다. 포함되지
 * 않으면 Claude가 conversation history에서 문구를 가져왔을 가능성이 높으므로 호출부에서
 * 리마인더 생성을 차단해야 한다.
 */
export function isSourceTextFromCurrentMessage(
  sourceText: string,
  currentUserMessage: string
): boolean {
  const normalizedSource = normalize(sourceText);
  if (!normalizedSource) return false;
  return normalize(currentUserMessage).includes(normalizedSource);
}
