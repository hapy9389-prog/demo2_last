import { NextRequest, NextResponse } from "next/server";
import { getCharacterById } from "@/lib/characters";
import { STORY_MEMORY_TURN_INTERVAL, extractMemoryFromStorySegment } from "@/lib/memoryClaude";
import { markMemoriesUsed, selectMemoriesForPrompt, upsertMemory } from "@/lib/memoryStore";
import { getStoryById } from "@/lib/stories";
import { chatInStory } from "@/lib/storyClaude";
import {
  addStoryMessage,
  getOrCreateLatestActiveSession,
  getSessionMessages,
  getStorySession,
  markGuestMemoryExtracted,
} from "@/lib/storyStore";
import { CharacterMemory } from "@/types";
import { Story, StoryChatResponse, StoryMessage, StorySession } from "@/types/story";

const isDev = process.env.NODE_ENV !== "production";

// Story Mode의 유일한 진행 API. Reminder/Time Awareness/scheduler/Chat store/Chat API
// (lib/store.ts, lib/scheduler.ts, lib/reminderGuard.ts, lib/time.ts,
// lib/interactionTime.ts, app/api/chat/route.ts)를 전혀 import하지 않는다 — Story Mode는
// 이 파이프라인들과 완전히 독립적으로 동작한다. Shared Memory 조회/추출(lib/memoryStore.ts,
// lib/memoryClaude.ts)만 예외적으로 Chat과 공유하는 제3의 독립 계층이다(계획 문서 §C 참고).
export async function POST(req: NextRequest) {
  let body: { sessionId?: string; storyId?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문입니다." }, { status: 400 });
  }

  const { sessionId, storyId, message } = body;
  if ((!sessionId && !storyId) || !message || !message.trim()) {
    return NextResponse.json(
      { error: "sessionId(또는 storyId)와 message는 필수입니다." },
      { status: 400 }
    );
  }

  const trimmedMessage = message.trim();

  let story: Story | undefined;
  let session: StorySession;

  if (sessionId) {
    // 정상 경로: 클라이언트가 URL에서 얻은 구체적인 sessionId를 명시적으로 전달한다.
    const found = getStorySession(sessionId);
    if (!found) {
      return NextResponse.json({ error: "존재하지 않는 세션입니다." }, { status: 404 });
    }
    session = found;
    story = getStoryById(session.storyId);
    if (!story) {
      return NextResponse.json({ error: "존재하지 않는 스토리입니다." }, { status: 404 });
    }
  } else {
    // 레거시 fallback: storyId만 받은 구버전 호출. 이 경로는 "실제 진행 요청"이므로
    // 활성 세션이 없으면 여기서 새로 만든다(POST이기 때문에 허용됨 — GET 조회 경로와는 다르다).
    story = getStoryById(storyId!);
    if (!story) {
      return NextResponse.json({ error: "존재하지 않는 스토리입니다." }, { status: 404 });
    }
    session = getOrCreateLatestActiveSession(storyId!);
  }

  const history = getSessionMessages(session.id);

  // Shared Memory 조회(부작용 없음). 게스트가 없거나 memory가 하나도 없으면 guestMemories는
  // 빈 Map이 되어 buildStorySystemPrompt()의 출력이 이 기능 도입 전과 완전히 동일해진다.
  const memoryNow = new Date();
  const guestMemories = new Map<string, CharacterMemory[]>();
  for (const slot of session.guestCharacters) {
    const selected = selectMemoriesForPrompt(slot.sourceCharacterId, memoryNow);
    if (selected.length > 0) guestMemories.set(slot.sourceCharacterId, selected);
  }

  const userMsg = addStoryMessage(session.id, "user", trimmedMessage);

  let replyText: string;
  try {
    replyText = await chatInStory(story, session, history, trimmedMessage, guestMemories);
  } catch (err) {
    console.error("[api/story/turn] Claude 호출 실패:", err);
    return NextResponse.json(
      { error: "스토리 응답 생성에 실패했습니다. API 키/네트워크를 확인해주세요." },
      { status: 502 }
    );
  }

  // Claude 호출이 실제로 성공했을 때만 "사용됨"을 기록한다(조회 자체는 mutation하지 않음).
  try {
    for (const memories of guestMemories.values()) {
      markMemoriesUsed(
        memories.map((m) => m.id),
        memoryNow
      );
    }
  } catch (err) {
    console.error("[api/story/turn] memory markMemoriesUsed 실패(무시):", err);
  }

  const assistantMsg = addStoryMessage(session.id, "assistant", replyText);

  const responseBody: StoryChatResponse = {
    userMessage: userMsg,
    reply: assistantMsg,
    sessionId: session.id,
  };

  // Shared Memory 증분 추출(쓰기 경로) — 응답이 이미 저장된 뒤, guest slot마다 미처리 구간의
  // user 메시지가 STORY_MEMORY_TURN_INTERVAL개 이상이면 그 구간을 추출한다. 실패해도 이미
  // 완성된 응답에는 영향 없도록 try/catch로 감싼다. 커서는 "지금 시각"이 아니라 실제로 처리한
  // 구간의 마지막 StoryMessage.createdAt으로 전진시킨다(정확도 우선 — 동시성 상황에서도
  // 메시지 누락 없게). 추출이 memory 0개를 반환해도 호출 자체가 성공했다면 커서는 전진시켜
  // 같은 구간이 매 턴 반복 재추출되지 않게 한다. 호출 자체가 실패하면 커서를 전진시키지 않고
  // 다음 턴에 같은 구간으로 재시도한다.
  try {
    const allMessages: StoryMessage[] = getSessionMessages(session.id);
    for (const slot of session.guestCharacters) {
      try {
        const cursor = slot.lastMemoryExtractedAt ?? slot.invitedAt;
        const segment = allMessages.filter((m) => m.createdAt > cursor);
        const userTurnsInSegment = segment.filter((m) => m.role === "user").length;
        if (userTurnsInSegment < STORY_MEMORY_TURN_INTERVAL) {
          if (isDev) {
            console.log(
              "[story-memory][debug]",
              "sessionId:", session.id,
              "characterId:", slot.sourceCharacterId,
              "cursor:", cursor,
              "segmentMessages:", segment.length,
              "userTurns:", userTurnsInSegment,
              "interval:", STORY_MEMORY_TURN_INTERVAL,
              "triggered: false"
            );
          }
          continue;
        }

        const character = getCharacterById(slot.sourceCharacterId);
        if (!character) continue;

        const { memories: extracted, rawCount, droppedCount } =
          await extractMemoryFromStorySegment(character, segment);
        const saved = extracted.map((item) =>
          upsertMemory({
            characterId: character.id,
            content: item.content,
            importance: item.importance,
            source: { type: "story", refId: session.id },
          })
        );
        const lastMessage = segment[segment.length - 1];
        markGuestMemoryExtracted(session.id, character.id, lastMessage.createdAt);

        if (isDev) {
          console.log(
            "[story-memory][debug]",
            "sessionId:", session.id,
            "characterId:", character.id,
            "guestName:", character.name,
            "cursor:", cursor, "->", lastMessage.createdAt,
            "segmentMessages:", segment.length,
            "userTurns:", userTurnsInSegment,
            "interval:", STORY_MEMORY_TURN_INTERVAL,
            "triggered: true",
            "rawExtracted:", rawCount,
            "validated:", extracted.length,
            "dropped:", droppedCount,
            "saved:",
            JSON.stringify(
              saved.map((s) => ({
                id: s.memory.id,
                content: s.memory.content,
                importance: s.memory.importance,
                wasMerged: s.wasMerged,
              }))
            )
          );
        }
      } catch (err) {
        console.error(
          "[api/story/turn] guest memory extraction 실패(무시):",
          slot.sourceCharacterId,
          err
        );
      }
    }
  } catch (err) {
    console.error("[api/story/turn] memory extraction 준비 실패(무시):", err);
  }

  return NextResponse.json(responseBody);
}
