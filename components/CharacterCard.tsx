"use client";

import { useState } from "react";
import { HomeRow, describeCharacterStatus, getCharacterStatus } from "@/lib/homeStatus";

/** 지금 당장 신경 써야 할 캐릭터일수록(새 메시지/리마인더/오래 못 봄) 레일에서 무대를
 *  살짝 더 크게 잡는다. 장식적 랜덤이 아니라 lib/homeStatus.ts가 이미 판단한 상태를
 *  그대로 재사용하는 것 — 새 임계값을 여기서 만들지 않는다. */
const LONG_ABSENCE_TIERS = ["long", "very_long", "extremely_long"];

function stageHeightClass(row: HomeRow): string {
  const status = getCharacterStatus(row);
  if (status.kind === "unread" || status.kind === "reminder") return "h-44";
  if (status.kind === "elapsed" && LONG_ABSENCE_TIERS.includes(status.tier)) return "h-40";
  return "h-36";
}

/**
 * 홈 화면 캐릭터 가로 스크롤 레일의 아이템 — "Modern Character Entertainment App" 2차
 * 리디자인에서 grid-cols-2 균일 카드를 걷어낸 자리.
 *
 * 이전에는 accent 색 네임플레이트 박스(rounded card + 배경 tint)가 일러스트 아래 항상
 * 붙어 있었다. 지금은 그 박스를 완전히 없애고 이미지 + 텍스트 두 줄만 남긴다 — 캐릭터마다
 * 원본 이미지 비율(세로 반신 vs 정사각)이 다른 만큼 레일에서 자연히 폭이 달라지고,
 * 상태(getCharacterStatus)에 따라 무대 높이도 달라지므로 "똑같은 상품 카드가 반복되는"
 * 인상을 주지 않는다.
 *
 * 상태 판단은 이전과 동일하게 lib/homeStatus.ts에 맡기고 이 컴포넌트는 렌더링만 한다.
 * 클릭 시 onSelect(character.id)를 호출하는 동작과 HomeRow 데이터 구조는 그대로다.
 */
export function CharacterCard({
  row,
  onSelect,
}: {
  row: HomeRow;
  onSelect: (characterId: string) => void;
}) {
  const { character, lastMessage, unread, nearestPendingReminder } = row;
  const status = getCharacterStatus(row);
  // 지금 당장 챙길 게 있으면(새 메시지/리마인더) 그 문구를, 아니면 마지막 대화 미리보기나
  // tagline을 보여준다 — HomeHero와 동일한 "actionable 우선, 아니면 flavor" 규칙이라
  // 좁은 레일 폭 안에서도 한 줄로 정리된다(박스가 없어 세 줄까지 쌓을 여유가 없다).
  const showsActionable = status.kind === "unread" || status.kind === "reminder";
  const line = showsActionable
    ? describeCharacterStatus(status)
    : (lastMessage?.content ?? character.tagline);

  // Avatar.tsx와 동일한 폴백 패턴이지만, Avatar는 overflow-hidden으로 원형/정사각 크롭을
  // 전제하는 공용 컴포넌트라 여기서 요구하는 "박스 없이 그대로 보여주는" 연출과는 맞지
  // 않는다 — Chat/Story 쪽 Avatar 사용에 영향을 주지 않기 위해 이 카드 전용으로 이미지
  // 로드 실패 처리를 별도로 둔다.
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(character.image) && !imageFailed;

  return (
    <button
      onClick={() => onSelect(character.id)}
      className="group flex min-w-[7rem] shrink-0 snap-start flex-col items-center gap-1.5 rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seal/40"
    >
      <div
        className={`relative flex items-end justify-center ${stageHeightClass(row)}`}
      >
        {nearestPendingReminder && (
          <span
            className="absolute right-1.5 top-0.5 h-2.5 w-2.5 rounded-full bg-seal"
            aria-hidden
          />
        )}
        {showImage ? (
          // 파일이 없을 수도 있는 로컬 정적 경로라 next/image보다 onError 폴백을
          // 다루기 쉬운 일반 img를 쓴다(components/Avatar.tsx와 동일한 이유).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={character.image}
            alt={character.name}
            className="h-full w-auto drop-shadow-[0_10px_10px_rgba(43,36,32,0.2)]"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span className="text-5xl leading-none drop-shadow-sm" aria-hidden>
            {character.emoji}
          </span>
        )}
      </div>

      <div className="flex max-w-[7.5rem] flex-col items-center gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-display text-sm font-bold text-ink sm:text-base">
            {character.name}
          </span>
          {unread && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-seal ring-2 ring-seal-soft"
              aria-hidden
            />
          )}
        </div>
        {line && (
          <p
            className={`line-clamp-1 text-center text-[11px] ${
              showsActionable ? "font-medium text-seal" : "text-ink-soft"
            }`}
          >
            {line}
          </p>
        )}
      </div>
    </button>
  );
}
