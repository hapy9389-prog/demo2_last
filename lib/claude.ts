import Anthropic from "@anthropic-ai/sdk";
import { Character, Message, Reminder, ReminderExtraction } from "@/types";
import { isValidExtractionShape } from "./time";

// 두 호출 지점(일반 채팅 / 리마인더 발화) 모두 기본적으로 같은 모델을 쓴다.
// 캐릭터 간 personality 차이가 뚜렷하게 느껴져야 한다는 요구사항 때문에 품질을 우선했다.
// 모델 ID가 계정/시점에 따라 다르면 코드 수정 없이 .env.local에서 바로 교체할 수 있다.
const CHAT_MODEL = process.env.ANTHROPIC_CHAT_MODEL || "claude-sonnet-5";
const REMINDER_MODEL = process.env.ANTHROPIC_REMINDER_MODEL || "claude-sonnet-5";
const CHAT_MAX_TOKENS = 600;
const REMINDER_MAX_TOKENS = 300;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY가 설정되지 않았습니다. .env.local에 키를 넣어주세요."
    );
  }
  client = new Anthropic({ apiKey });
  return client;
}

/**
 * 시간 계산은 절대 Claude에게 맡기지 않는다. Claude는 "언제(kind)"와
 * "얼마나/몇시몇분"에 해당하는 값, 그리고 원문/요약만 이 스키마로 추출한다.
 * 실제 절대 시각 계산은 lib/time.ts의 resolveTriggerTime()이 결정적으로 수행한다.
 */
const scheduleReminderTool: Anthropic.Tool = {
  name: "schedule_reminder",
  description: `사용자가 특정 미래 시점에 무언가를 알려달라고 요청하거나, 그 시점에 캐릭터가
특정 행동/말을 해달라고(예: "응원해줘", "잔소리 좀 해줘", "힘내라고 한마디 해줘", "깨워줘")
요청했을 때 호출하세요 — "알려줘"류 동사로 한정하지 마세요.
시간 계산은 하지 마세요 - 사용자가 말한 시간 표현을 그대로 구조화된 필드로만 옮기면 됩니다.
실제 절대 날짜/시각 계산(오늘 기준 며칠 뒤인지, 연도가 몇 년인지 등)은 전부 서버가 처리합니다.

가장 중요한 규칙 - 반드시 지키세요:
- 사용자 메시지 중 <current_user_message> 태그 안의 내용만 '지금' 들어온 메시지입니다. schedule_reminder 호출 여부는 오직 이 태그 안의 내용만 근거로 판단하세요. 태그 밖(위쪽)에 있는 대화 기록은 문맥 참고용일 뿐, 리마인더 등록 근거로 쓰면 안 됩니다.
- 이 도구는 오직 "방금 사용자가 보낸 메시지"(=<current_user_message> 태그 안) 자체가 새로운 리마인더 등록 요청을 명확히 담고 있을 때만 호출하세요.
- 대화 히스토리에 예전에 리마인더를 요청한 기록이 있다는 이유만으로 다시 호출하지 마세요. 이미 등록했거나 이미 발화(전달)된 리마인더를 재실행/재등록하지 마세요. 리마인더가 이미 발화된 뒤 사용자가 감사 인사·일반 답장·화제 전환을 하더라도 그 과거 요청을 다시 실행하지 마세요.
- "알려줘서 고마워", "이제 그만해", "다른 얘기하자", "아직 시간 안 지났거든" 같은, 과거 리마인더에 대한 반응/언급일 뿐 새로운 요청이 아닌 메시지에는 절대 호출하지 마세요.
- 단, 사용자가 "다시 알려줘"처럼 명시적으로 재요청하거나 새로운 시간을 지정하면 그건 진짜 새 요청이므로 정상적으로 호출하세요.
- "매일", "매주", "매달"처럼 반복되는 일정은 아직 지원하지 않습니다. 이런 요청이면 도구를 호출하지 말고, 반복 일정은 아직 지원하지 않는다고 캐릭터답게 자연스럽게 답하세요.
- "어제", "지난주"처럼 이미 지난 날짜/시각을 가리키는 요청에도 호출하지 마세요.
- 날짜만 있고 시각이 전혀 언급되지 않았다면("8월 20일에 알려줘", "내일 알려줘"처럼 시각도 "이 시간에"류 표현도 없는 경우) hour/minute을 임의로 추측해서 채우지 말고, 이 도구 자체를 호출하지 마세요. 대신 채팅 답변에서 몇 시에 알려주면 될지 캐릭터답게 되물어보세요.
- source_text에는 반드시 <current_user_message> 태그 안에서 실제로 그대로 복사한 문구만 넣으세요(의역/요약 금지). 대화 기록(태그 밖)에 있던 문구를 넣으면 안 됩니다 — 서버가 이 문자열이 실제로 현재 메시지에 포함돼 있는지 검증하며, 통과하지 못하면 리마인더가 생성되지 않습니다.

시간 표현 매핑 (계산은 절대 하지 말고 원문 그대로 아래 필드로 옮기세요):
- "1분 뒤", "10분 있다가"처럼 지금으로부터 상대적인 시간이면 kind="relative_minutes"와 relative_minutes를 채우세요.
- "오늘 오후 2시", "저녁 7시"처럼 오늘의 특정 시각이면 kind="time_of_day"와 hour(0-23)/minute(0-59)를 채우세요.
- "내일", "모레", "3일 뒤", "일주일 뒤"처럼 오늘로부터 며칠 뒤인지로 표현되면 kind="relative_days"를 쓰세요.
  - relative_days에는 오늘로부터 며칠 뒤인지 정수만 넣으세요(내일=1, 모레=2, "3일 뒤"=3, "일주일 뒤"=7). 요일 계산이나 실제 날짜 계산은 절대 하지 마세요.
  - "내일 오후 2시"처럼 구체적인 시각이 같이 있으면 use_current_time=false로 두고 hour/minute을 채우세요.
  - "내일 이 시간에", "3일 뒤 이맘때"처럼 시각을 말하지 않고 "지금과 같은 시각"을 뜻하면 use_current_time=true로 하고 hour/minute은 채우지 마세요 — 지금이 몇 시인지 당신은 정확히 모르니 추측해서 채우면 안 됩니다.
- "8월 20일 오후 2시", "2026년 8월 20일 오후 2시"처럼 구체적인 달/일이 언급되면 kind="date_time"을 쓰고 month(1-12)/day(1-31)/hour(0-23)/minute(0-59)를 채우세요.
  - "2026년 8월 20일"처럼 연도까지 명시됐으면 year도 채우세요. 연도가 없으면 year 필드는 아예 채우지 마세요 — 당신이 연도를 임의로 추측하면 안 됩니다. 서버가 올해/내년 중 더 가까운 미래 날짜를 자동으로 고릅니다.`,
  input_schema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["relative_minutes", "time_of_day", "relative_days", "date_time"],
        description: "시간 표현의 종류",
      },
      relative_minutes: {
        type: "number",
        description: "kind가 relative_minutes일 때만 채움: 지금으로부터 몇 분 뒤인지",
      },
      relative_days: {
        type: "integer",
        description:
          "kind가 relative_days일 때만 채움: 오늘로부터 며칠 뒤인지(내일=1, 모레=2, '3일 뒤'=3, '일주일 뒤'=7). 실제 날짜 계산은 서버가 하므로 이 정수만 넣는다.",
      },
      use_current_time: {
        type: "boolean",
        description:
          "kind가 relative_days일 때만 의미 있음: '이 시간에/이맘때'처럼 지금과 같은 시:분을 쓰고 싶다는 뜻이면 true(이때 hour/minute은 비워둔다). 특정 시:분을 말했다면 false.",
      },
      year: {
        type: "integer",
        description:
          "kind가 date_time이고 사용자가 연도를 명시했을 때만 채움. 명시하지 않았으면 이 필드 자체를 넣지 않는다 — 서버가 올해/내년 중 더 가까운 미래를 자동으로 고른다.",
      },
      month: {
        type: "integer",
        description: "kind가 date_time일 때만 채움: 1-12",
      },
      day: {
        type: "integer",
        description: "kind가 date_time일 때만 채움: 1-31",
      },
      hour: {
        type: "integer",
        description:
          "kind가 time_of_day/date_time일 때, 또는 relative_days이면서 use_current_time=false일 때 채움: 0-23시",
      },
      minute: {
        type: "integer",
        description:
          "kind가 time_of_day/date_time일 때, 또는 relative_days이면서 use_current_time=false일 때 채움: 0-59분",
      },
      original_phrase: {
        type: "string",
        description: "사용자가 말한 시간 표현 원문. 예: '오늘 오후 2시', '1분 뒤', '내일 오후 2시'",
      },
      content: {
        type: "string",
        description:
          "무엇을 해줘야 하는지(알림 내용이든, '응원하기'/'잔소리하기'처럼 캐릭터가 할 행동/말이든) 짧은 요약. 예: '물 마시기', '응원하기'",
      },
      source_text: {
        type: "string",
        description:
          "리마인더 요청의 근거가 된 현재 사용자 메시지(<current_user_message> 태그 안)의 정확한 원문을 그대로 복사하세요(의역/요약 금지). 서버가 이 문자열이 실제로 현재 메시지에 포함돼 있는지 검증합니다 — 대화 기록에서 가져온 문구를 넣으면 검증에 실패해 리마인더가 생성되지 않습니다.",
      },
    },
    required: ["kind", "original_phrase", "content", "source_text"],
  },
};

function parseExtraction(raw: unknown): ReminderExtraction | null {
  if (typeof raw !== "object" || raw === null) return null;
  const input = raw as Record<string, unknown>;

  const original_phrase =
    typeof input.original_phrase === "string" ? input.original_phrase : "";
  const content = typeof input.content === "string" ? input.content : "";
  const source_text = typeof input.source_text === "string" ? input.source_text : "";
  // source_text가 비어 있으면 애초에 extraction 전체를 무효 처리한다 — 서버가 현재
  // 메시지 근거를 검증할 수 없는 리마인더는 등록하지 않는다는 원칙(hard guard 1차 관문).
  if (!original_phrase || !content || !source_text) return null;

  if (input.kind === "relative_minutes") {
    const extraction: ReminderExtraction = {
      kind: "relative_minutes",
      relative_minutes: Number(input.relative_minutes),
      original_phrase,
      content,
      source_text,
    };
    return isValidExtractionShape(extraction) ? extraction : null;
  }

  if (input.kind === "time_of_day") {
    const extraction: ReminderExtraction = {
      kind: "time_of_day",
      hour: Number(input.hour),
      minute: Number(input.minute),
      original_phrase,
      content,
      source_text,
    };
    return isValidExtractionShape(extraction) ? extraction : null;
  }

  if (input.kind === "relative_days") {
    const hasHour = input.hour !== undefined && input.hour !== null;
    const hasMinute = input.minute !== undefined && input.minute !== null;
    const extraction: ReminderExtraction = {
      kind: "relative_days",
      relative_days: Number(input.relative_days),
      use_current_time: input.use_current_time === true,
      ...(hasHour ? { hour: Number(input.hour) } : {}),
      ...(hasMinute ? { minute: Number(input.minute) } : {}),
      original_phrase,
      content,
      source_text,
    };
    return isValidExtractionShape(extraction) ? extraction : null;
  }

  if (input.kind === "date_time") {
    // year가 없을 때 Number(undefined)(=NaN)를 그대로 넣으면 resolveTriggerTime의
    // "연도 미지정" 분기가 깨지므로, 조건부 스프레드로 필드 자체를 아예 생략해야 한다.
    const hasYear = input.year !== undefined && input.year !== null && input.year !== "";
    const extraction: ReminderExtraction = {
      kind: "date_time",
      month: Number(input.month),
      day: Number(input.day),
      hour: Number(input.hour),
      minute: Number(input.minute),
      ...(hasYear ? { year: Number(input.year) } : {}),
      original_phrase,
      content,
      source_text,
    };
    return isValidExtractionShape(extraction) ? extraction : null;
  }

  return null;
}

export interface ChatResult {
  replyText: string;
  extraction: ReminderExtraction | null;
}

// 일반 채팅 응답(chatWithCharacter)에만 적용하는 행동/상황 묘사 규칙. 캐릭터별
// systemPrompt(lib/characters.ts)의 COMMON_RULES에는 넣지 않는다 — COMMON_RULES는
// 각 캐릭터의 systemPrompt 문자열에 이미 포함돼 있어서, 거기 넣으면
// fireReminderMessage()(리마인더 발화, system: character.systemPrompt 그대로 사용)에도
// 자동으로 섞여 들어가기 때문이다. 이 규칙은 chatWithCharacter()의 system 조립
// 시점에만 별도로 붙여, 리마인더 발화 프롬프트는 기존과 완전히 동일하게 유지한다.
const ACTION_DESCRIPTION_RULES = `
행동/상황 묘사 규칙:
- 필요한 경우에만 표정, 몸짓, 행동, 분위기를 짧게 덧붙일 수 있습니다. 모든 응답에 넣을 필요는 없습니다.
- 사용한다면 반드시 **행동 또는 상황 묘사** 형식(별표 두 개로 감싸기)으로, 대사보다 앞에 둡니다.
- 한 응답에 보통 0~1개만 사용하고, 아주 특별한 경우에도 2개를 넘기지 않습니다. 같은 응답 안에서 여러 개를 나열하지 않습니다.
- 행동/상황 묘사는 대사보다 짧아야 하며, 눈을 깜빡인다/고개를 끄덕인다처럼 의미 없이 습관적인 동작은 피합니다. 감정이나 분위기를 보완할 때만 씁니다.
- ** ** 안에는 오직 행동/상황 묘사만 넣고, 대사나 감정을 설명하는 문장을 넣지 않습니다.

예:
**캐릭터가 잠시 시선을 피한다.**

별로 걱정한 건 아니거든.
`.trim();

/**
 * Claude API 호출 #1 — 일반 채팅 응답과 리마인더 intent 추출을 한 번의 호출로 합친다.
 * 별도의 "분류용 호출"을 두면 지연/비용이 배로 들기 때문.
 *
 * 히스토리는 우리 store의 Message{role, content} 텍스트만 재구성해서 보낸다 — 과거
 * tool_use/tool_result 블록은 재전송하지 않는다. Claude는 이번 턴의 사용자 메시지만
 * 보고 리마인더 여부를 판단하면 되므로 기능상 문제가 없고, tool_use/tool_result
 * 페어링을 관리해야 하는 복잡도를 통째로 없앨 수 있다.
 */
export async function chatWithCharacter(
  character: Character,
  history: Message[],
  userMessage: string,
  // 시간 인식(time awareness) 기능 전용, 옵션. app/api/chat/route.ts가
  // lib/interactionTime.ts의 buildTimeAwarenessForCharacter()로 만들어 전달한다.
  // 리마인더 관련 로직과는 완전히 무관 — 이 인자가 없어도(null) 기존 동작 그대로다.
  timeAwarenessContext: string | null = null,
  // Shared Memory 기능 전용, 옵션. app/api/chat/route.ts가 lib/memoryStore.ts의
  // selectMemoriesForPrompt() + lib/memoryPrompt.ts의 buildSharedMemoryBlock()으로 만들어
  // 전달한다. time_awareness와 달리 user 턴이 아니라 system prompt 끝에 이어붙인다 —
  // <current_user_message>/source_text 판정 경계와 절대 섞이지 않게 하기 위함이다. 이
  // 인자가 없으면(null) system은 오늘과 완전히 동일한 문자열이 된다(기존 동작 그대로).
  sharedMemoryContext: string | null = null,
  // Cross-Character Awareness 기능 전용, 옵션. app/api/chat/route.ts가
  // lib/crossCharacterAwareness.ts로 만들어 전달한다. sharedMemoryContext와 같은
  // 이유로 user 턴이 아니라 system에 둔다(다른 캐릭터에게서 간접적으로 들은 정보라는
  // 성격이 사용자 자신의 발화보다도 더 명백히 제3자성이므로). 이 인자가 없으면(null)
  // system은 오늘과 완전히 동일한 문자열이 된다. fireReminderMessage()는 이 인자를
  // 아예 받지 않는다 — proactive 리마인더 발화에는 Cross-Character Awareness를
  // 적용하지 않는다.
  crossCharacterAwarenessContext: string | null = null
): Promise<ChatResult> {
  const anthropic = getClient();

  // 마지막 user turn만 <current_user_message> 태그로 감싸 히스토리와 명확히 구분한다.
  // Claude가 리마인더 재등록 여부를 판단할 때 "지금 들어온 메시지"가 어디까지인지
  // 헷갈리지 않도록 하기 위함 — tool description에서도 이 태그를 근거로 판단하라고
  // 명시한다. 저장되는 Message.content(store/UI 표시용)는 원본 userMessage 그대로이며,
  // 이 태깅은 API 호출 시점에만 적용된다. <time_awareness>가 있으면 같은 턴 안에서
  // 그 앞에 붙인다 — history와는 구분되는 별도 블록이면서도, 연속된 user 역할 턴을
  // 새로 만들지는 않는다.
  const currentTurnContent = [
    timeAwarenessContext,
    `<current_user_message>${userMessage}</current_user_message>`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const messages: Anthropic.MessageParam[] = [
    ...history.map(
      (m): Anthropic.MessageParam => ({ role: m.role, content: m.content })
    ),
    { role: "user", content: currentTurnContent },
  ];

  // Shared Memory 블록은 반드시 system의 끝에 온다(CLAUDE.md §9 불변 조건). 순서:
  // 성격(persona) → 응답 형식 규칙(행동 묘사) → 이번 턴 한정 부가 컨텍스트
  // (Cross-Character Awareness) → 영구 기억(Shared Memory, 반드시 마지막).
  const system = [
    character.systemPrompt,
    ACTION_DESCRIPTION_RULES,
    crossCharacterAwarenessContext,
    sharedMemoryContext,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: CHAT_MODEL,
    max_tokens: CHAT_MAX_TOKENS,
    system,
    tools: [scheduleReminderTool],
    messages,
  });

  let replyText = "";
  let extraction: ReminderExtraction | null = null;

  for (const block of response.content) {
    if (block.type === "text") {
      replyText += block.text;
    } else if (
      block.type === "tool_use" &&
      block.name === "schedule_reminder" &&
      !extraction // 한 턴당 하나만 처리(중복 리마인더 방지)
    ) {
      extraction = parseExtraction(block.input);
    }
  }

  if (!replyText.trim()) {
    // 텍스트 없이 tool_use만 오는 드문 경우를 대비한 최소 fallback
    replyText = "응, 알겠어.";
  }

  return { replyText: replyText.trim(), extraction };
}

/**
 * Claude API 호출 #2 — 스케줄러가 due 리마인더를 발견했을 때, 사용자 요청과 무관하게
 * 서버가 스스로 트리거하는 호출. tool은 필요 없다(이미 시간은 정해졌으므로).
 */
export async function fireReminderMessage(
  character: Character,
  reminder: Reminder
): Promise<string> {
  const anthropic = getClient();

  const instruction = `[상황] 지금은 사용자가 예전에 부탁한 리마인더가 울리는 시점입니다.
사용자가 요청한 원래 시간 표현: "${reminder.originalPhrase}"
알려줘야 할 내용: "${reminder.content}"

사용자는 지금 아무 말도 하지 않았습니다. 당신이 캐릭터 성격에 맞게 먼저 말을 거는
상황입니다. 실제로 캐릭터가 할 법한 대사만 답하세요(설명이나 메타 코멘트 없이).`;

  try {
    const response = await anthropic.messages.create({
      model: REMINDER_MODEL,
      max_tokens: REMINDER_MAX_TOKENS,
      system: character.systemPrompt,
      messages: [{ role: "user", content: instruction }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join(" ")
      .trim();

    return text || fallbackReminderMessage(character, reminder);
  } catch (err) {
    console.error("[claude] 리마인더 발화 호출 실패:", err);
    throw err;
  }
}

function fallbackReminderMessage(character: Character, reminder: Reminder): string {
  return `(${character.name}) ${reminder.content} 시간이야!`;
}
