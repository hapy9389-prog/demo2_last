import { NextResponse } from "next/server";
import { getCharacterById } from "@/lib/characters";
import { extractMemoryFromStorySegment } from "@/lib/memoryClaude";
import { upsertMemory } from "@/lib/memoryStore";
import {
  getSessionMessages,
  getStorySession,
  removeGuestCharacter,
  toStorySessionSummary,
} from "@/lib/storyStore";
import { StorySessionSummary } from "@/types/story";

const isDev = process.env.NODE_ENV !== "production";

// DELETE /api/story/sessions/:sessionId/guests/:characterId -> 세션에서 Guest Character를
// 제거한다. app/api/reminders/[id]/route.ts와 동일한 Promise<{ ... }> params 관례를 쓴다.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string; characterId: string }> }
) {
  const { sessionId, characterId } = await params;

  const result = removeGuestCharacter(sessionId, characterId);
  if (!result.ok) {
    if (result.reason === "session_not_found") {
      return NextResponse.json({ error: "존재하지 않는 세션입니다." }, { status: 404 });
    }
    return NextResponse.json(
      { error: "초대된 게스트를 찾을 수 없습니다." },
      { status: 404 }
    );
  }

  // Shared Memory 최종 추출 — 게스트가 제거되기 전까지 증분 추출(8턴 단위)로 처리되지 않고
  // 남아 있던 마지막 구간을 여기서 한 번 더 추출한다. 게스트 제거 자체는 이미 위에서 성공했고
  // 되돌리지 않는다 — 이 블록이 실패해도 제거 응답에는 영향이 없도록 try/catch로 감싼다.
  try {
    const character = getCharacterById(characterId);
    if (character) {
      const cursor = result.slot.lastMemoryExtractedAt ?? result.slot.invitedAt;
      const allMessages = getSessionMessages(sessionId);
      const segment = allMessages.filter((m) => m.createdAt > cursor);
      if (segment.length > 0) {
        const { memories: extracted, rawCount, droppedCount } =
          await extractMemoryFromStorySegment(character, segment);
        const saved = extracted.map((item) =>
          upsertMemory({
            characterId: character.id,
            content: item.content,
            importance: item.importance,
            source: { type: "story", refId: sessionId },
          })
        );
        if (isDev) {
          console.log(
            "[story-memory][debug]",
            "sessionId:", sessionId,
            "characterId:", character.id,
            "guestName:", character.name,
            "context: guest-removal-final-extraction",
            "segmentMessages:", segment.length,
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
      }
    }
  } catch (err) {
    console.error("[api/story/guests] 게스트 제거 시 memory 최종 추출 실패(무시):", err);
  }

  const session = getStorySession(sessionId)!;
  const summary: StorySessionSummary = toStorySessionSummary(session);
  return NextResponse.json({ session: summary });
}
