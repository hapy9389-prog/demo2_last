import Link from "next/link";
import { Story, StorySessionSummary } from "@/types/story";
import { ContinueSessionCard } from "./ContinueSessionCard";
import { StoryCard } from "./StoryCard";
import { StoryHistoryList } from "./StoryHistoryList";

// 홈 화면에는 기록을 미리보기 몇 개만 보여주고, 전체 목록은 /story/history로 분리한다 —
// 기록이 쌓일수록 "새로운 Story 시작" 그리드가 아래로 밀려나는 문제를 막기 위함.
const HISTORY_PREVIEW_COUNT = 3;

/**
 * Story Mode 홈 화면. 목적을 셋으로 좁힌다: 최근 세션 이어서 하기, 새로운 Story 시작,
 * 과거 기록 화면(/story/history)으로의 진입. 전체 기록 목록 자체는 여기서 렌더링하지
 * 않는다(길어질수록 새 스토리 선택을 방해했기 때문). lib/stories.ts의 STORIES와
 * lib/storyStore.ts의 세션 요약을 그대로 렌더링한다(app/story/page.tsx가 서버 컴포넌트로
 * 직접 조회해서 넘겨준다). Chat Mode의 HomeScreen.tsx(폴링/리마인더 벨/스포트라이트)와
 * 달리 폴링이나 proactive 알림이 없어 훨씬 단순하다.
 */
export function StoryHomeScreen({
  stories,
  sessions,
}: {
  stories: Story[];
  sessions: StorySessionSummary[];
}) {
  // sessions는 이미 updatedAt 내림차순(lib/storyStore.ts). 맨 앞이 "이어서 하기" 대상이고,
  // "내 스토리 기록" 미리보기에서는 중복 표시를 피하기 위해 그 뒤부터 최대
  // HISTORY_PREVIEW_COUNT개만 보여준다. 전체 목록은 /story/history에서 확인한다.
  const [latestSession, ...restSessions] = sessions;
  const previewSessions = restSessions.slice(0, HISTORY_PREVIEW_COUNT);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-story-lobby-bg">
      <header className="flex items-center gap-3 border-b border-white/8 px-4 py-4">
        <Link
          href="/"
          aria-label="채팅 모드로 돌아가기"
          className="flex h-9 w-9 shrink-0 items-center justify-center text-xl text-white/55 transition-colors hover:text-story-ink"
        >
          ‹
        </Link>
        <h1 className="text-lg font-bold text-story-ink">스토리</h1>
      </header>

      <div className="no-scrollbar flex-1 overflow-y-auto p-4">
        {latestSession && (
          <div className="mb-6">
            <ContinueSessionCard session={latestSession} />
          </div>
        )}

        {/* 세 섹션의 위계: Continue(위, 가장 큼) → Discover(중간, 라벨을 좀 더 힘있게)
           → History(가장 조용함). 한글에는 uppercase가 아무 시각 효과가 없어서 대신
           크기/굵기로 구분한다. */}
        <p className="pb-2 text-sm font-semibold text-story-ink">새로운 Story 시작</p>
        <div className="mb-6 grid grid-cols-2 gap-3">
          {stories.map((story) => (
            <StoryCard key={story.id} story={story} />
          ))}
        </div>

        {restSessions.length > 0 && (
          <div>
            <div className="flex items-center justify-between pb-2">
              <p className="text-sm font-medium text-white/55">내 스토리 기록</p>
              <Link
                href="/story/history"
                className="text-xs font-medium text-white/55 hover:text-story-ink"
              >
                전체 기록 보기 ›
              </Link>
            </div>
            <StoryHistoryList sessions={previewSessions} />
          </div>
        )}
      </div>
    </div>
  );
}
