import Link from "next/link";
import { StorySessionSummary } from "@/types/story";
import { formatRelativeKorean } from "@/lib/storyFormat";

/**
 * 홈 화면 "내 스토리 기록" 섹션 — 과거 StorySession을 최신순으로 나열한다. 박스 반복
 * 대신 divider로만 구분되는 flowing list(MemoryPanel/ReminderPanel과 같은 문법).
 * 자동 생성된 session.title(사실상 storyTitle+날짜라 정보가 겹침)은 압축된 뷰에서
 * 빼고 storyTitle + 상대시각 + 메시지 수 한 줄로만 보여준다 — 데이터 자체는 그대로다.
 */
export function StoryHistoryList({ sessions }: { sessions: StorySessionSummary[] }) {
  if (sessions.length === 0) return null;

  return (
    <div className="divide-y divide-white/8">
      {sessions.map((session) => (
        <Link
          key={session.sessionId}
          href={`/story/${session.storyId}?sessionId=${session.sessionId}`}
          className="flex items-center justify-between gap-3 py-2.5 transition-opacity hover:opacity-70"
        >
          <p className="truncate text-sm font-medium text-story-ink">{session.storyTitle}</p>
          <p className="shrink-0 text-xs text-white/55">
            {formatRelativeKorean(session.updatedAt)} · {session.messageCount}개 메시지
          </p>
        </Link>
      ))}
    </div>
  );
}
