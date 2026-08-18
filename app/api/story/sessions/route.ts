import { NextRequest, NextResponse } from "next/server";
import { getStoryById } from "@/lib/stories";
import {
  createStorySession,
  listStorySessionSummaries,
  toStorySessionSummary,
} from "@/lib/storyStore";
import { StorySessionSummary } from "@/types/story";

// GET  /api/story/sessions -> 전체 StorySession 요약 목록, updatedAt 내림차순.
//      "이어서 하기"/"내 스토리 기록" 홈 섹션이 쓰는 것과 동일한 데이터를 클라이언트에서도
//      다시 조회할 수 있게 하는 조회 API(현재 홈 화면 자체는 서버 컴포넌트라 이 API를
//      거치지 않고 lib/storyStore.ts를 직접 호출한다 — 이 라우트는 순수 조회, 부작용 없음).
// POST /api/story/sessions { storyId } -> 새 StorySession을 생성한다. 세션 생성이
//      일어나는 유일한 서버 진입점이며, 클라이언트에서는 사용자가 "새로 시작"을 눌렀을
//      때만(components/story/createAndEnterSession.ts) 호출한다.
export async function GET() {
  const sessions: StorySessionSummary[] = listStorySessionSummaries();
  return NextResponse.json({ sessions });
}

export async function POST(req: NextRequest) {
  let body: { storyId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문입니다." }, { status: 400 });
  }

  const { storyId } = body;
  if (!storyId) {
    return NextResponse.json({ error: "storyId는 필수입니다." }, { status: 400 });
  }

  const story = getStoryById(storyId);
  if (!story) {
    return NextResponse.json({ error: "존재하지 않는 스토리입니다." }, { status: 404 });
  }

  const session = createStorySession(storyId);
  const summary: StorySessionSummary = toStorySessionSummary(session);

  return NextResponse.json({ session: summary });
}
