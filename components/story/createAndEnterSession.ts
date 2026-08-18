import { StorySessionSummary } from "@/types/story";

/**
 * "새로 시작" 행동을 하나로 묶은 클라이언트 헬퍼. `POST /api/story/sessions`를 호출해
 * 새 StorySession을 만들고, 그 sessionId로 진입할 URL을 반환한다.
 *
 * 세션 생성은 이 함수(→ POST /api/story/sessions)를 거치는 경우에만 일어난다.
 * components/story/StoryCard.tsx와 components/story/StorySessionMissing.tsx가 이
 * 함수 하나만 공유해서 쓴다 — "세션 생성 로직이 여러 곳에 흩어지지 않는다"는 원칙을
 * 지키기 위함이다.
 */
export async function createAndEnterSession(storyId: string): Promise<string> {
  const res = await fetch("/api/story/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storyId }),
  });
  const data: { session?: StorySessionSummary; error?: string } = await res.json();
  if (!res.ok || !data.session) {
    throw new Error(data.error || "세션을 시작하지 못했습니다.");
  }
  return `/story/${storyId}?sessionId=${data.session.sessionId}`;
}
