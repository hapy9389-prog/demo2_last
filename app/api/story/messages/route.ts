import { NextRequest, NextResponse } from "next/server";
import { getMessagesForStory, getSessionMessages, getStorySession } from "@/lib/storyStore";

// GET /api/story/messages?sessionId=xxx -> 그 세션의 전체 메시지 이력(정확한 세션을
// 다시 여는 주 경로). ?storyId=xxx만 있으면(레거시 호환) 그 스토리의 가장 최근 세션의
// 이력을 반환한다. 어느 쪽이든 조회만으로는 세션을 생성하지 않는다 — sessionId가
// 존재하지 않거나, storyId에 세션이 하나도 없으면 빈 배열을 반환한다.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId");
  const storyId = searchParams.get("storyId");

  if (sessionId) {
    const session = getStorySession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "존재하지 않는 세션입니다." }, { status: 404 });
    }
    return NextResponse.json({ messages: getSessionMessages(sessionId) });
  }

  if (storyId) {
    return NextResponse.json({ messages: getMessagesForStory(storyId) });
  }

  return NextResponse.json({ error: "sessionId 또는 storyId는 필수입니다." }, { status: 400 });
}
