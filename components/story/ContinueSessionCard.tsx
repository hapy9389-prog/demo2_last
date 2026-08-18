import Link from "next/link";
import { StorySessionSummary } from "@/types/story";
import { formatRelativeKorean } from "@/lib/storyFormat";
import { getStoryById } from "@/lib/stories";

/**
 * 홈 화면 "이어서 하기" 섹션 — 전체 세션 중 updatedAt이 가장 최신인 것 하나만 보여준다.
 * 이미 존재하는 세션으로 이동만 하는 단순 링크라 세션을 새로 만들지 않는다
 * (StoryCard/StorySessionMissing의 "새로 시작"과는 다른 경로).
 *
 * StorySessionSummary에는 coverImage가 없어서(요약 DTO), lib/stories.ts의 정적
 * 카탈로그를 getStoryById로 직접 조회한다(StoryScreen.tsx의 getCharacterById와 동일한
 * 패턴 — 별도 API 없이 정적 모듈을 그대로 읽는다). 이미지는 <img onError> 대신
 * StoryScreen.tsx의 배경 처리와 동일하게 CSS background-image로 얹는다 — 로드에
 * 실패해도 그냥 안 보일 뿐 깨진 이미지 아이콘이 뜨지 않아 별도 폴백 상태가 필요 없다.
 * 덕분에 이 컴포넌트를 client component로 넓히지 않고 서버 컴포넌트로 유지한다
 * (StoryHomeScreen.tsx와 동일하게 "use client" 없음).
 */
export function ContinueSessionCard({ session }: { session: StorySessionSummary }) {
  const story = getStoryById(session.storyId);

  return (
    <Link
      href={`/story/${session.storyId}?sessionId=${session.sessionId}`}
      className="relative flex aspect-[3/2] w-full items-end overflow-hidden bg-story-bg transition-opacity active:opacity-90"
    >
      {story?.coverImage && (
        <div
          aria-hidden
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${story.coverImage})` }}
        />
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-story-bg via-story-bg/30 to-transparent" />
      <div className="relative flex w-full items-end justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium tracking-wide text-story-ink/70">이어서 하기</p>
          <p className="truncate font-display text-lg font-bold text-story-ink">
            {session.storyTitle}
          </p>
          <p className="truncate text-xs text-story-ink/70">
            {formatRelativeKorean(session.updatedAt)} · {session.messageCount}개 메시지
          </p>
        </div>
        <span className="shrink-0 text-sm font-semibold text-story-ink">계속하기 →</span>
      </div>
    </Link>
  );
}
