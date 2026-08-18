"use client";

import { useState } from "react";
import Link from "next/link";
import { STORIES } from "@/lib/stories";
import { Story } from "@/types/story";

/**
 * Story cover 이미지 한 칸. 파일이 없거나 로드에 실패하면(onError) story-bg 배경 +
 * 이모지로 폴백한다 — components/story/StoryCard.tsx의 showImage/onError 패턴과 동일.
 * 커버가 여러 장이라 imageFailed state를 각 타일이 독립적으로 가져야 해서 별도
 * 서브컴포넌트로 뺐다.
 */
function StoryCoverTile({ story }: { story: Story }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(story.coverImage) && !imageFailed;

  return (
    <div className="relative h-full flex-1">
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={story.coverImage}
          alt=""
          aria-hidden
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-story-bg text-2xl">
          📖
        </div>
      )}
    </div>
  );
}

/**
 * 홈 화면에서 Story Mode(/story)로 진입하는 티저 — "Modern Character Entertainment App"
 * 2차 리디자인에서 검정 버튼형 카드를 버리고, 실제 Story cover 이미지를 크게 쓴
 * cinematic preview로 바꿨다. lib/stories.ts의 STORIES를 읽기 전용으로 참조한다
 * (components/story/GuestInvitePanel.tsx가 CHARACTERS를 직접 import하는 것과 같은
 * 선례 — Story 데이터/로직 자체는 건드리지 않는다).
 *
 * 특정 story로 딥링크하지 않고 항상 /story로 보내는 단일 진입점이라는 점은 이전과
 * 동일하다. 캐릭터 레일 아래(화면 하단)로 옮기고, rounded 없이 화면 끝까지 채워서
 * "다른 세계로 넘어가는 문"처럼 다른 섹션들과 확실히 다른 톤을 예고한다 — Story 화면
 * 본체 리디자인은 아직 다음 단계.
 */
export function StoryModeEntry() {
  const covers = STORIES.slice(0, 2);

  return (
    <Link href="/story" className="group relative block h-44 overflow-hidden sm:h-48">
      <div className="absolute inset-0 flex">
        {covers.map((story) => (
          <StoryCoverTile key={story.id} story={story} />
        ))}
      </div>
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-story-bg via-story-bg/50 to-transparent"
      />
      <div className="absolute inset-x-0 bottom-0 p-5">
        <p className="font-display text-xl font-bold text-story-ink">스토리 모드</p>
        <p className="mt-0.5 text-xs text-story-ink/70">인터랙티브 소설을 플레이해보세요</p>
      </div>
      <span
        className="absolute right-5 top-5 text-story-ink/50 transition-transform group-active:translate-x-0.5"
        aria-hidden
      >
        ›
      </span>
    </Link>
  );
}
