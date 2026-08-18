import Link from "next/link";
import { StorySessionSummary } from "@/types/story";
import { StoryHistoryList } from "./StoryHistoryList";

/**
 * `/story/history` — 전체 StorySession을 최신순으로 보여주는 화면.
 * `components/story/StoryHomeScreen.tsx`와 동일한 header + 스크롤 영역 셸이며,
 * 목록 렌더링은 기존 `StoryHistoryList`(수정 없이 재사용)에 그대로 맡긴다.
 */
export function StoryHistoryScreen({ sessions }: { sessions: StorySessionSummary[] }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-story-lobby-bg">
      <header className="flex items-center gap-3 border-b border-white/8 px-4 py-4">
        <Link
          href="/story"
          aria-label="스토리 홈으로"
          className="flex h-9 w-9 shrink-0 items-center justify-center text-xl text-white/55 transition-colors hover:text-story-ink"
        >
          ‹
        </Link>
        <h1 className="text-lg font-bold text-story-ink">내 스토리 기록</h1>
      </header>

      <div className="no-scrollbar flex-1 overflow-y-auto p-4">
        {sessions.length === 0 ? (
          <p className="mt-10 text-center text-sm text-white/55">
            아직 플레이한 기록이 없어요.
          </p>
        ) : (
          <StoryHistoryList sessions={sessions} />
        )}
      </div>
    </div>
  );
}
