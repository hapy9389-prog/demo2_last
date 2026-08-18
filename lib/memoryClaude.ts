import Anthropic from "@anthropic-ai/sdk";
import { Character, Message } from "@/types";
import { StoryMessage } from "@/types/story";

// Shared Memory 추출 전용 Claude 호출. lib/claude.ts(schedule_reminder tool이 걸려 있는
// Chat Mode 파일)를 import하지 않고, lib/storyClaude.ts와 동일한 방식으로 Anthropic 클라이언트
// 초기화를 독립적으로 복제한다 — 이 추출 호출이 기존 Reminder/Chat 응답 호출·응답 루프와
// 물리적으로 완전히 분리된 별도 코드 경로임을 보장하기 위한 의도적 선택이다.

const MEMORY_MODEL = process.env.ANTHROPIC_MEMORY_MODEL || "claude-sonnet-5";
// 강제 tool_choice로 extract_memories만 호출하게 해도, 최대 5개 항목(각각 최대 300자 한국어
// 문장 + importance)을 JSON으로 구성하려면 500 토큰으로는 실제로 잘릴 수 있음을 실측으로
// 확인했다(stop_reason: "max_tokens", input: {}). 여유 있게 잡는다.
const MEMORY_MAX_TOKENS = 1024;

/** Chat 쪽 extraction 트리거 주기 — 해당 캐릭터의 user 메시지 개수가 이 배수일 때만 실행한다. */
export const CHAT_MEMORY_EXTRACTION_INTERVAL = 4;
/** Story 쪽 증분 extraction 트리거 주기 — guest slot당 미처리 구간의 user 메시지 개수 기준. */
export const STORY_MEMORY_TURN_INTERVAL = 8;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY가 설정되지 않았습니다. .env.local에 키를 넣어주세요.");
  }
  client = new Anthropic({ apiKey });
  return client;
}

// Chat/Story 양쪽 tool의 input_schema는 완전히 동일(content/importance, 최대 5개)하므로
// 공유 상수로 뺀다. description만 도메인별로 달라진다(아래 두 Tool 상수 참고) — "무엇을
// 중요하다고 볼지"의 기준 자체가 Chat과 Story에서 다르기 때문이다.
const memoryExtractionInputSchema: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    memories: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description:
              "한국어 한 문장, 자기완결적으로(대명사만으로는 무슨 뜻인지 알 수 없게 쓰지 않는다).",
          },
          importance: {
            type: "integer",
            description: "1(사소함)~5(매우 중요함) 정수.",
          },
        },
        required: ["content", "importance"],
      },
    },
  },
  required: ["memories"],
};

// Chat 전용. Story와 name/input_schema는 같지만(강제 tool_choice가 이름으로 매칭되므로
// name은 반드시 동일해야 한다) description은 다르다 — Chat은 "지속적 사실/뚜렷한 사건"
// 중심으로 상대적으로 더 엄격한 기준을 유지한다. 이 상수는 Story 쪽 변경과 무관하게
// 그대로 유지된다.
const extractMemoriesTool: Anthropic.Tool = {
  name: "extract_memories",
  description:
    "주어진 대화/이야기 구간에서, 나중에 다시 참고할 가치가 있는 중요한 사실이나 사건만 " +
    "뽑아낸다. 사소한 인사말, 감탄사, 일상적인 맞장구는 절대 포함하지 않는다. 최대 5개까지만 " +
    "뽑고, 정말 중요한 것이 없으면 빈 배열을 반환해도 된다.",
  input_schema: memoryExtractionInputSchema,
};

// Story 전용(extractMemoryFromStorySegment에서만 사용). Chat과 달리 "거대한 사건"이
// 아니어도, 관계의 연속성을 느끼게 하는 작은 공동 경험까지 후보로 인정하도록 description
// 자체를 완화한다 — system prompt와 이중으로 상충하는 신호를 주지 않기 위해 tool
// description 수준에서부터 Story 취지를 명확히 한다.
const extractMemoriesToolForStory: Anthropic.Tool = {
  name: "extract_memories",
  description:
    "주어진 Story 진행 구간에서, 사용자와 게스트 등장인물이 함께 겪은 경험 중 나중에 " +
    "다시 언급됐을 때 관계와 경험의 연속성을 느낄 수 있는 순간을 뽑아낸다. 반드시 " +
    "극적인 사건일 필요는 없다 — 함께 무언가를 나누거나, 서로 새로운 사실을 알게 " +
    "되거나, 작은 약속을 하거나, 인상적인 감정 교류가 있었다면 후보가 될 수 있다. " +
    "다만 인사/사소한 행동/의미 없는 이동처럼 반복적이고 특징 없는 순간은 포함하지 " +
    "않는다. 최대 5개까지만 뽑고, 그런 순간이 정말 없었다면 빈 배열을 반환해도 된다.",
  input_schema: memoryExtractionInputSchema,
};

interface ExtractedMemoryItem {
  content: string;
  importance: number;
}

/**
 * 응답이 max_tokens에 걸려 잘렸으면 tool_use.input이 불완전(최악의 경우 완전히 빈 객체
 * {})할 수 있다 — 이걸 "정말 중요한 게 없어서 빈 배열을 반환했다"와 구분하지 않고 그대로
 * 파싱하면, 실제로는 잘려서 유실된 응답을 "성공적으로 처리했지만 0개"로 착각하게 된다.
 * Story 쪽에서는 이 착각이 "커서를 전진시켜 그 구간을 영영 재시도하지 않는" 실질적 데이터
 * 유실로 이어지므로, 잘린 응답은 실패로 취급해 호출부의 try/catch가 재시도하게 한다.
 */
function assertNotTruncated(response: Anthropic.Message): void {
  if (response.stop_reason === "max_tokens") {
    throw new Error("[memoryClaude] extraction 응답이 max_tokens로 잘렸습니다(재시도 필요)");
  }
}

function parseExtractedMemories(response: Anthropic.Message): ExtractedMemoryItem[] {
  assertNotTruncated(response);
  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === "extract_memories"
  );
  if (!toolUse) return [];

  const input = toolUse.input as { memories?: unknown };
  if (!Array.isArray(input.memories)) return [];

  const items: ExtractedMemoryItem[] = [];
  for (const raw of input.memories) {
    if (typeof raw !== "object" || raw === null) continue;
    const { content, importance } = raw as Record<string, unknown>;
    if (typeof content !== "string") continue;
    const trimmed = content.trim();
    if (!trimmed) continue;
    const clampedImportance = Math.min(5, Math.max(1, Math.round(Number(importance) || 1)));
    items.push({ content: trimmed.slice(0, 300), importance: clampedImportance });
  }
  return items.slice(0, 5);
}

// 두 추출 프롬프트(Chat/Story) 공통으로 반드시 지켜야 하는 안전 지시. "기억하지 마" 같은
// 명시적 요청 존중과 민감정보 제외는 이번 MVP에서도 프롬프트 지시 수준으로 강하게 넣는다
// (별도 정규식 감지기나 실시간 forget UI는 만들지 않음 — 리마인더처럼 실제 부작용이 없는
// 콘텐츠 특성상 수용 가능한 트레이드오프로 취급한다).
const MEMORY_SAFETY_RULES = `
- 사용자가 "기억하지 마", "잊어줘", "저장하지 마", "이건 비밀로 해줘" 등으로 명시적으로 요청한
  내용은 그 표현이 붙은 문장이든 그 근처 맥락이든 절대 memory로 추출하지 않는다.
- 건강, 금융/자산, 주소, 연락처 같은 민감정보는 사용자가 별도로 막지 않아도 추출하지 않는다.
`.trim();

/**
 * Chat 전용 추출. app/api/chat/route.ts에서 기존 Reminder 파이프라인이 전부 끝나고
 * responseBody가 확정된 뒤에만 호출해야 한다(트리거 판정 위치는 route.ts, 실제 호출은 여기).
 */
export async function extractMemoryFromChat(
  character: Character,
  recentMessages: Message[]
): Promise<ExtractedMemoryItem[]> {
  if (recentMessages.length === 0) return [];
  const anthropic = getClient();

  const transcript = recentMessages
    .map((m) => `${m.role === "user" ? "사용자" : character.name}: ${m.content}`)
    .join("\n");

  const system = `당신은 채팅 대화 로그에서 "${character.name}"가 사용자에 대해 나중에도 기억해 둘 만한
중요한 사실이나 사건만 골라내는 보조 작업을 합니다. 응답 텍스트를 생성하는 게 아니라
extract_memories 도구만 호출하면 됩니다.

무엇을 뽑을지:
- 사용자의 취향/취미/직업/상황 같은 지속적인 사실, 캐릭터와 사용자 사이에 있었던 의미 있는
  사건이나 약속처럼 나중에 다시 언급될 가치가 있는 내용만 뽑는다.
- "안녕", "ㅋㅋㅋ", "고마워", "뭐해" 같은 인사/맞장구/일상적 잡담은 뽑지 않는다.

${MEMORY_SAFETY_RULES}`;

  const response = await anthropic.messages.create({
    model: MEMORY_MODEL,
    max_tokens: MEMORY_MAX_TOKENS,
    system,
    tools: [extractMemoriesTool],
    tool_choice: { type: "tool", name: "extract_memories" },
    messages: [
      {
        role: "user",
        content: `다음은 "${character.name}"와 사용자 사이의 최근 대화입니다.\n\n${transcript}`,
      },
    ],
  });

  return parseExtractedMemories(response);
}

/**
 * extractMemoryFromStorySegment()의 반환 타입. 호출부(app/api/story/turn/route.ts,
 * guests/[characterId]/route.ts DELETE)가 raw/validated/dropped 개수를 알아야
 * "Claude가 애초에 0개를 반환했는지" vs "추출은 됐지만 이름 validation에서 drop됐는지"를
 * debug 로그로 구분할 수 있다 — 이 두 원인은 실패 시 취해야 할 조치가 다르므로
 * (전자는 판단 기준/prompt 문제, 후자는 이름 표기 문제) 구분 가능해야 한다.
 */
export interface StoryExtractionResult {
  memories: ExtractedMemoryItem[];
  rawCount: number;
  droppedCount: number;
}

/**
 * Story 전용 추출. app/api/story/turn/route.ts(증분, 사용자 턴 8개마다)와
 * app/api/story/sessions/[sessionId]/guests/[characterId]/route.ts DELETE(게스트 제거 시
 * 마지막 구간)에서 호출한다.
 *
 * Chat과 판단 기준이 다르다 — extractMemoriesToolForStory(위)를 쓰며, "거대한 사건"이
 * 아니라 "관계와 경험의 연속성을 느낄 수 있는 작지만 특징적인 공동 경험"까지 후보로
 * 인정한다. Chat 전용 extractMemoriesTool/extractMemoryFromChat()은 이 변경과 무관하게
 * 그대로 유지된다.
 *
 * 이름 포함 여부로 입력 메시지를 사전 필터링하지 않는다 — 한국어 Story에서는 게스트가
 * 등장 이후 "그녀/그/아이" 등 대명사로만 지칭될 수 있어, 사전 필터링하면 실제 참여 장면이
 * 누락될 수 있다. 대신 구간 전체를 그대로 전달하고, 저장 직전 이 함수 안에서 "추출된 문장에
 * 게스트 이름이 실제로 포함되는가"를 결정론적으로 재검증하는 것을 유일한 하드 게이트로
 * 둔다(lib/reminderGuard.ts의 isSourceTextFromCurrentMessage()와 같은 "Claude 출력에 대한
 * 사후 대조" 원칙) — 이 하드 게이트는 이번 변경에서도 약화시키지 않는다.
 */
export async function extractMemoryFromStorySegment(
  character: Character,
  segmentMessages: StoryMessage[]
): Promise<StoryExtractionResult> {
  if (segmentMessages.length === 0) return { memories: [], rawCount: 0, droppedCount: 0 };
  const anthropic = getClient();

  const transcript = segmentMessages
    .map((m) => (m.role === "user" ? `사용자: ${m.content}` : `[이야기]: ${m.content}`))
    .join("\n\n");

  const guestName = character.name;
  const system = `당신은 인터랙티브 스토리 진행 기록에서 "${guestName}"라는 게스트
등장인물과 사용자가 함께 겪은, 나중에 다시 언급됐을 때 관계와 경험의 연속성을 느낄 수
있는 순간을 골라내는 보조 작업을 합니다. 응답 텍스트를 생성하는 게 아니라
extract_memories 도구만 호출하면 됩니다.

무엇을 뽑을지(반드시 거대한 사건일 필요는 없습니다 — 아래처럼 작지만 특징적인 공동
경험도 좋은 후보입니다):
- 함께 먹거나 나눈 것
- 함께 탐색하거나 해결한 문제
- 위험하거나 곤란한 상황에서 서로 도운 일
- 서로 나눈 약속
- 감정적으로 인상적이었던 대화나 순간
- ${guestName}가 사용자에 대해 새롭게 알게 된 사실(취향/습관/성향 등)
- 함께 내린 결정
- 갈등이나 화해
- 나중에 반복해서 떠올릴 만한 작은 추억이 될 수 있는 장면

무엇을 뽑지 않을지:
- 단순 인사, 감탄사, 의미 없는 잡담
- ${guestName}와 무관하게 다른 등장인물끼리만 겪은 사건
- 세계관/배경 설명만 나온 장면
- "문을 열었다", "의자에 앉았다"처럼 특징 없이 반복되는 사소한 행동

판단 기준: "사소하지는 않지만 반드시 대사건일 필요도 없다"는 중간 기준으로
판단하세요. 이 구간에 그런 순간이 정말 하나도 없었다면 빈 배열을 반환해도 됩니다 —
다만 매 구간마다 억지로 뭔가를 만들어내려 하지 마세요.

- 아래 구간은 "${guestName}"가 이 이야기에 초대된 이후의 진행 기록이다. ${guestName}가
  이름으로 직접 언급되지 않아도 대명사나 문맥으로 ${guestName}임을 알 수 있는 장면을
  포함해서 판단하라.
- 뽑아낸 각 memory 문장에는 대명사가 아니라 반드시 "${guestName}"라는 이름을
  명시적으로 써서, 그 문장만 봐도 누구에 대한 이야기인지 알 수 있게 써라(예:
  "그녀는" 대신 "${guestName}는").

importance(1~5) 기준:
1: 작지만 특징적인 공동 경험(예: 같이 간식을 나눔)
2: 나중에 다시 언급할 만한 작은 추억
3: 명확히 의미 있는 사건(약속, 새로 알게 된 중요한 사실 등)
4: 중요한 도움/갈등/화해
5: 이 Story 전체를 대표할 만한 핵심 사건

${MEMORY_SAFETY_RULES}`;

  const response = await anthropic.messages.create({
    model: MEMORY_MODEL,
    max_tokens: MEMORY_MAX_TOKENS,
    system,
    tools: [extractMemoriesToolForStory],
    tool_choice: { type: "tool", name: "extract_memories" },
    messages: [
      {
        role: "user",
        content: `다음은 "${guestName}"가 이 이야기에 등장한 이후의 진행 구간입니다.\n\n${transcript}`,
      },
    ],
  });

  const extracted = parseExtractedMemories(response);

  // 사후 재검증(필수 관문, 완화하지 않음) — 게스트 이름이 실제로 포함되지 않은 항목은
  // 저장을 거부한다.
  const validated = extracted.filter((item) => item.content.includes(guestName));
  const dropped = extracted.length - validated.length;
  if (dropped > 0) {
    console.warn(
      `[memoryClaude] Story extraction: 게스트 이름("${guestName}") 미포함으로 ${dropped}건 드롭`
    );
  }
  return { memories: validated, rawCount: extracted.length, droppedCount: dropped };
}
