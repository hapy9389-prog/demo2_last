import { StoryHomeScreen } from "@/components/story/StoryHomeScreen";
import { StoryPhoneFrame } from "@/components/story/StoryPhoneFrame";
import { STORIES } from "@/lib/stories";
import { listStorySessionSummaries } from "@/lib/storyStore";

// 서버 컴포넌트에서 직접 storyStore를 호출한다(STORIES를 직접 import하던 기존 방식과
// 동일) — 자체 GET /api/story/sessions를 fetch하지 않는다. 순수 조회이므로 세션을
// 생성하지 않는다.
export default async function StoryHomePage() {
  const sessions = listStorySessionSummaries();

  return (
    <StoryPhoneFrame>
      <StoryHomeScreen stories={STORIES} sessions={sessions} />
    </StoryPhoneFrame>
  );
}
