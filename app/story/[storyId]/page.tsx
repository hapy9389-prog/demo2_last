import { notFound } from "next/navigation";
import { StoryPhoneFrame } from "@/components/story/StoryPhoneFrame";
import { StoryScreen } from "@/components/story/StoryScreen";
import { StorySessionMissing } from "@/components/story/StorySessionMissing";
import { getStoryById } from "@/lib/stories";
import { getStorySession } from "@/lib/storyStore";

// app/api/reminders/[id]/route.ts와 동일한 명시적 Promise<{ ... }> 타입을 쓴다(Next 16의
// PageProps<'/...'> 헬퍼는 타입 생성(next dev/build) 이후에만 전역으로 쓸 수 있어,
// 새로 추가한 라우트에서는 생성 시점에 의존하지 않는 이 방식이 더 안전하다). searchParams
// 타입은 node_modules/next/dist/docs의 관례를 그대로 따른다.
export default async function StoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ storyId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { storyId } = await params;
  const story = getStoryById(storyId);
  if (!story) notFound();

  const resolvedSearchParams = await searchParams;
  const rawSessionId = resolvedSearchParams.sessionId;
  const sessionId = typeof rawSessionId === "string" ? rawSessionId : undefined;

  // GET 렌더링 경로는 세션을 생성하지 않는다 — sessionId가 없거나, 존재하지 않거나,
  // 다른 스토리의 세션이면 안내 화면만 보여준다. 세션은 오직 사용자가 그 화면에서
  // "새로 시작"을 눌렀을 때(POST /api/story/sessions)만 만들어진다.
  const session = sessionId ? getStorySession(sessionId) : undefined;
  const sessionValid = session && session.storyId === storyId && session.status !== "archived";

  return (
    <StoryPhoneFrame>
      {sessionValid ? (
        <StoryScreen
          story={story}
          sessionId={session.id}
          initialGuestCharacters={session.guestCharacters}
        />
      ) : (
        <StorySessionMissing story={story} />
      )}
    </StoryPhoneFrame>
  );
}
