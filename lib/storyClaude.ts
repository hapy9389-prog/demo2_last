import Anthropic from "@anthropic-ai/sdk";
import { CharacterMemory } from "@/types";
import { Story, StoryMessage, StorySession } from "@/types/story";
import { buildStorySystemPrompt } from "./storyPrompt";

// lib/claude.ts(Chat Mode의 Claude 연동)를 import하지 않고 Anthropic 클라이언트
// 초기화만 동일한 패턴으로 별도 복제한다. Reminder tool(schedule_reminder) 파이프라인이
// 걸려 있는 파일을 Story Mode가 절대 건드리지 않기 위한 의도적 선택이다.
const STORY_MODEL = process.env.ANTHROPIC_STORY_MODEL || "claude-sonnet-5";
// 여러 문단으로 상황/행동/대사를 서술해야 하므로 Chat Mode(600)보다 여유 있게 잡는다.
const STORY_MAX_TOKENS = 1200;

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
 * Story Mode의 유일한 Claude 호출 지점. Chat Mode의 chatWithCharacter()와 달리
 * schedule_reminder tool을 포함하지 않고, <time_awareness>/<current_user_message>
 * 래핑도 하지 않는다 — Reminder/Time Awareness는 Story Mode에 존재하지 않는 기능이다.
 *
 * 히스토리는 store의 StoryMessage{role, content} 텍스트만 재구성해서 보낸다(Chat Mode와
 * 동일한 방식).
 *
 * guestMemories(Shared Memory 조회 결과, sourceCharacterId → CharacterMemory[])는 옵션이며
 * 그대로 buildStorySystemPrompt()에 전달만 한다 — 기본값 빈 Map이므로 안 넘겨도 기존 동작
 * 그대로다.
 */
export async function chatInStory(
  story: Story,
  session: StorySession,
  history: StoryMessage[],
  userMessage: string,
  guestMemories: Map<string, CharacterMemory[]> = new Map()
): Promise<string> {
  const anthropic = getClient();

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m): Anthropic.MessageParam => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  const response = await anthropic.messages.create({
    model: STORY_MODEL,
    max_tokens: STORY_MAX_TOKENS,
    system: buildStorySystemPrompt(story, session, history, guestMemories),
    messages,
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  return text || "(정적이 흐른다...)";
}
