"use client";

import { useState } from "react";
import { Character } from "@/types";
import { ACCENT_AVATAR_STYLE } from "@/lib/accentColors";

const SIZE_CLASS = {
  sm: "h-8 w-8 text-base",
  md: "h-11 w-11 text-xl",
  lg: "h-14 w-14 text-2xl",
  xl: "h-24 w-24 text-4xl",
  // 부모 컨테이너 크기를 그대로 채운다 — CharacterCard처럼 반응형 정사각 배너로 쓸 때(shape="square").
  fill: "h-full w-full text-5xl",
} as const;

type AvatarCharacter = Pick<Character, "name" | "emoji" | "image" | "accent">;

/**
 * 캐릭터 아바타 공용 컴포넌트. character.image가 있으면 이미지를 우선 표시하고,
 * 이미지가 없거나(필드 미지정) 로드에 실패하면(onError) emoji+accent 배경으로 자동 폴백한다.
 * 홈 화면 Spotlight/그리드 카드/채팅 헤더/메시지 버블에서 공용으로 쓴다.
 */
export function Avatar({
  character,
  size = "md",
  shape = "circle",
  emphasize = false,
}: {
  character: AvatarCharacter;
  size?: keyof typeof SIZE_CLASS;
  /**
   * "circle"(기본) = 원형 아바타. "square" = 모서리를 두지 않는다(각짐) — 홈 화면 카드처럼
   * 감싸는 쪽이 자체적으로 `overflow-hidden rounded-t-2xl`로 모서리를 잘라내는 용도라,
   * 반경 값을 두 곳에서 따로 정의하지 않기 위해 Avatar 자체는 각지게 둔다.
   */
  shape?: "circle" | "square";
  /** 리마인더 발화처럼 "먼저 연락했다"는 느낌을 강조하고 싶을 때 은은한 링 효과 */
  emphasize?: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(character.image) && !imageFailed;

  return (
    <div
      className={`relative shrink-0 overflow-hidden ${
        shape === "square" ? "rounded-none" : "rounded-full"
      } ${SIZE_CLASS[size]} ${
        showImage ? "bg-neutral-100" : ACCENT_AVATAR_STYLE[character.accent]
      } ${emphasize ? "ring-2 ring-seal ring-offset-2 ring-offset-paper" : ""}`}
    >
      {showImage ? (
        // 파일이 없을 수도 있는 로컬 정적 경로라 next/image보다 onError 폴백을
        // 다루기 쉬운 일반 img를 쓴다.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={character.image}
          alt={character.name}
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center leading-none">
          {character.emoji}
        </span>
      )}
    </div>
  );
}
