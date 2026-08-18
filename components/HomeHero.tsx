"use client";

import { useState } from "react";
import { calculateInteractionGap, formatElapsedKorean } from "@/lib/interactionTime";
import { SpotlightPick, describeCharacterStatus, getCharacterStatus } from "@/lib/homeStatus";

const REASON_LABEL: Record<SpotlightPick["reason"], string> = {
  long_absence: "오랜만이에요",
  recent: "이어서 대화해요",
  first_time: "새로운 만남",
};

/**
 * 홈 화면 최상단 Hero — "Modern Character Entertainment App" 2차 리디자인의 핵심.
 *
 * 이전(HomeSpotlight)에는 accent 색 박스 안에 원형 Avatar를 넣은 boxed 카드였다. 지금은
 * 박스/배경/그림자를 전부 없애고, 일러스트와 텍스트만으로 영역을 구분한다. 텍스트를
 * 가운데 정렬해 쌓는 "랜딩페이지"형 구성도 의도적으로 피했다 — 텍스트는 왼쪽, 일러스트는
 * 오른쪽에 비대칭으로 배치하고, 일러스트 무대를 텍스트 컬럼보다 명시적으로 크게 잡아
 * `items-end`(바닥 정렬)만으로 이미지가 자연히 텍스트보다 위로 솟게 만든다 — 별도
 * absolute/음수마진 트릭 없이 두 flex 컬럼의 높이 차이만으로 비대칭이 생긴다.
 *
 * 어떤 캐릭터를 보여줄지는 lib/homeStatus.ts의 pickSpotlightCharacter()가 이미 결정해서
 * 넘겨준다 — 이 컴포넌트는 그 결과를 렌더링만 한다(선정 로직을 갖지 않음).
 */
export function HomeHero({
  pick,
  onSelect,
}: {
  pick: SpotlightPick;
  onSelect: (characterId: string) => void;
}) {
  const { row, reason } = pick;
  const { character, lastUserMessageAt } = row;

  const status = getCharacterStatus(row);
  // 지금 당장 챙길 게 있으면(새 메시지/리마인더) 그 문구를, 아니면 캐릭터다운 한마디로
  // tagline을 보여준다 — REASON_LABEL의 "오랜만이에요"류 문구와 내용이 겹치던 문제도
  // 자연히 해소된다.
  const showsActionable = status.kind === "unread" || status.kind === "reminder";
  const line = showsActionable ? describeCharacterStatus(status) : character.tagline;

  const elapsedText = lastUserMessageAt
    ? `${formatElapsedKorean(calculateInteractionGap(new Date(lastUserMessageAt)))} 전 대화`
    : "아직 대화한 적 없어요";

  // CharacterCard.tsx와 동일한 이유로 Avatar를 쓰지 않고 자체 폴백을 둔다 — Avatar는
  // overflow-hidden 크롭을 전제해서 이 "박스 밖으로 솟는" 연출과 맞지 않는다.
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(character.image) && !imageFailed;

  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-seal">
          {REASON_LABEL[reason]}
        </p>
        <p className="mt-1 truncate font-display text-3xl font-bold text-ink sm:text-4xl">
          {character.name}
        </p>
        <p className="mt-1.5 line-clamp-2 text-sm text-ink">{line}</p>
        <p className="mt-1 text-xs text-ink-soft">{elapsedText}</p>
        <button
          onClick={() => onSelect(character.id)}
          className="group mt-4 inline-flex items-center gap-1 rounded text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seal/40"
        >
          이어서 대화하기
          <span
            className="text-seal transition-transform group-active:translate-x-0.5"
            aria-hidden
          >
            →
          </span>
        </button>
      </div>

      {/* 일러스트 컬럼. 텍스트 컬럼보다 키가 커서(h-64) 바닥 정렬 시 위로 솟는다.
          오른쪽 여백을 두지 않아 화면 가장자리 쪽으로 밀착시킨다. */}
      <div className="relative flex h-64 shrink-0 items-end justify-center sm:h-72">
        <div
          aria-hidden
          className="absolute bottom-1 h-4 w-24 rounded-full bg-ink/5 blur-2xl sm:w-28"
        />
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={character.image}
            alt=""
            aria-hidden
            className="relative h-full w-auto drop-shadow-[0_14px_14px_rgba(43,36,32,0.22)]"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span className="relative text-8xl leading-none drop-shadow-sm" aria-hidden>
            {character.emoji}
          </span>
        )}
      </div>
    </div>
  );
}
