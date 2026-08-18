import { StoryHistoryScreen } from "@/components/story/StoryHistoryScreen";
import { StoryPhoneFrame } from "@/components/story/StoryPhoneFrame";
import { listStorySessionSummaries } from "@/lib/storyStore";

// app/story/page.tsx와 동일한 패턴 — 서버 컴포넌트에서 lib/storyStore.ts를 직접 호출한다
// (자체 API를 fetch하지 않는다). 순수 조회이므로 세션을 생성하지 않는다. 같은 레벨에
// 정적 세그먼트(history)가 있으면 Next.js가 동적 세그먼트([storyId])보다 우선
// 매칭하므로 app/story/[storyId]/page.tsx와 라우트가 충돌하지 않는다.
export default async function StoryHistoryPage() {
  const sessions = listStorySessionSummaries();

  return (
    <StoryPhoneFrame>
      <StoryHistoryScreen sessions={sessions} />
    </StoryPhoneFrame>
  );
}
