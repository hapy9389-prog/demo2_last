"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Story } from "@/types/story";
import { createAndEnterSession } from "./createAndEnterSession";

/**
 * 홈 스토리 목록의 카드 한 칸 — 포스터 형태. 흰 카드 안에 썸네일+텍스트 블록을 분리하지
 * 않고, cover 이미지 자체가 카드의 표면이다(genre/title/description을 이미지 하단
 * gradient 위에 직접 얹는다 — components/StoryModeEntry.tsx 티저와 같은 문법).
 * 클릭하면 항상 새 StorySession을 만들고(기존 세션 자동 재사용 안 함) 그 세션으로
 * 이동한다 — "새로운 Story 시작"의 유일한 진입점.
 */
export function StoryCard({ story }: { story: Story }) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 이미지 로드 실패 시 이모지로 폴백한다 — 세션 생성 클릭 핸들러가 필요해 이 컴포넌트는
  // 어차피 client component이므로(ContinueSessionCard.tsx와 달리 서버 컴포넌트로 뺄
  // 이유가 없다), <img onError>를 그대로 쓴다.
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(story.coverImage) && !imageFailed;

  const handleClick = async () => {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const url = await createAndEnterSession(story.id);
      router.push(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.");
      setStarting(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={starting}
      className="relative flex aspect-[3/4] w-full flex-col justify-end overflow-hidden bg-story-bg text-left transition-opacity active:opacity-90 disabled:opacity-60"
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={story.coverImage}
          alt={story.title}
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center text-3xl text-story-ink/50"
        >
          {starting ? "…" : "📖"}
        </span>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-story-bg via-story-bg/15 to-transparent" />
      <div className="relative flex flex-col gap-0.5 p-2.5">
        <span className="truncate text-[10px] font-medium tracking-wide text-story-ink/70">
          {story.genre}
        </span>
        <p className="truncate font-display text-sm font-bold text-story-ink">{story.title}</p>
        {/* 선택에 필요한 최소 정보는 남긴다 — 완전히 빼지 않고 1줄로 clamp. */}
        <p className="line-clamp-1 text-[11px] text-story-ink/60">{story.description}</p>
        {error && <p className="text-[11px] text-red-400">{error}</p>}
      </div>
    </button>
  );
}
