import { NextRequest, NextResponse } from "next/server";
import { getCharacterById } from "@/lib/characters";
import { addGuestCharacter, getStorySession, toStorySessionSummary } from "@/lib/storyStore";
import { StorySessionSummary } from "@/types/story";

// POST /api/story/sessions/:sessionId/guests { characterId }
// -> 해당 세션에 Chat Character를 Guest Character로 초대한다. Guest Character가 실제로
// 생성되는 유일한 서버 진입점이다. "characterId가 실제 존재하는가"는 여기서
// lib/characters.ts(@/lib/characters)를 참조해 검증한다 — Story Mode가 의도적으로 Chat
// Mode의 캐릭터 카탈로그를 참조하는 지점이다. 세션 상태(존재/archived/중복/정원) 검증은
// lib/storyStore.ts의 addGuestCharacter()가 담당한다.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  let body: { characterId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문입니다." }, { status: 400 });
  }

  const { characterId } = body;
  if (!characterId) {
    return NextResponse.json({ error: "characterId는 필수입니다." }, { status: 400 });
  }

  const character = getCharacterById(characterId);
  if (!character) {
    return NextResponse.json({ error: "존재하지 않는 캐릭터입니다." }, { status: 404 });
  }

  const result = addGuestCharacter(sessionId, characterId);
  if (!result.ok) {
    if (result.reason === "session_not_found") {
      return NextResponse.json({ error: "존재하지 않는 세션입니다." }, { status: 404 });
    }
    if (result.reason === "archived") {
      return NextResponse.json(
        { error: "종료된 세션에는 게스트를 초대할 수 없습니다." },
        { status: 409 }
      );
    }
    if (result.reason === "already_invited") {
      return NextResponse.json(
        { error: "이미 초대된 캐릭터입니다." },
        { status: 409 }
      );
    }
    // guest_limit_reached
    return NextResponse.json(
      { error: "이 세션에는 이미 게스트가 초대돼 있습니다. 먼저 제거한 뒤 다시 초대해주세요." },
      { status: 409 }
    );
  }

  const session = getStorySession(sessionId)!;
  const summary: StorySessionSummary = toStorySessionSummary(session);
  return NextResponse.json({ session: summary });
}
