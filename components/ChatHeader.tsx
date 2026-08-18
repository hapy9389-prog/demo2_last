"use client";

import { useState } from "react";
import { Character } from "@/types";
import { ACCENT_DOT_STYLE } from "@/lib/accentColors";
import { MemoryMark } from "./MemoryMark";
import { ReminderMark } from "./ReminderMark";

/**
 * 채팅 화면 상단 헤더: 뒤로가기 + 캐릭터 일러스트/이름/상태 문구 + 기억/리마인더 버튼.
 *
 * 원형으로 크롭한 아바타 대신 Home Hero/CharacterCard와 같은 "박스 없는 일러스트"
 * 문법을 그대로 가져온다 — 이미지가 있으면 원본 비율 그대로(radius/배경 박스 없이)
 * 헤더 높이에 맞춰 보여주고, drop-shadow만으로 살짝 띄운다. Home에서 보던 캐릭터가
 * 그대로 이 화면까지 따라온 것처럼 느껴지게 하기 위함이다.
 */
export function ChatHeader({
  character,
  bellPulseTick,
  onBack,
  onOpenReminders,
  onOpenMemory,
}: {
  character: Character;
  /** 리마인더/proactive 메시지가 도착할 때마다 증가 — bell 아이콘 강조 애니메이션 재생용. */
  bellPulseTick: number;
  onBack: () => void;
  onOpenReminders: () => void;
  onOpenMemory: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(character.image) && !imageFailed;

  return (
    <header className="flex items-center gap-3 border-b border-paper-sunken bg-paper px-3 py-2">
      <button
        onClick={onBack}
        aria-label="뒤로가기"
        className="flex h-9 w-9 shrink-0 items-center justify-center text-xl text-ink-soft transition-colors hover:text-ink"
      >
        ‹
      </button>

      {showImage ? (
        // 파일이 없을 수도 있는 로컬 정적 경로라 onError 폴백을 다루기 쉬운 일반 img를
        // 쓴다(components/CharacterCard.tsx와 동일한 이유). Avatar를 쓰지 않는 이유도
        // 같다 — Avatar는 overflow-hidden으로 원형 크롭하는데, 여기서는 캐릭터 아트를
        // 박스 없이 원본 비율로 보여주고 싶다.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={character.image}
          alt=""
          aria-hidden
          className="h-12 w-auto shrink-0 drop-shadow-[0_4px_8px_rgba(43,36,32,0.2)]"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className="shrink-0 text-3xl leading-none" aria-hidden>
          {character.emoji}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-base font-bold text-ink">{character.name}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-soft">
          <span
            aria-hidden
            className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${ACCENT_DOT_STYLE[character.accent]}`}
          />
          <span className="truncate">{character.tagline}</span>
        </p>
      </div>

      <button
        onClick={onOpenMemory}
        aria-label="기억 목록 열기"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-memory transition-colors hover:bg-memory/10"
      >
        <MemoryMark className="h-5 w-5" />
      </button>
      <button
        onClick={onOpenReminders}
        aria-label="리마인더 목록 열기"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-seal transition-colors hover:bg-seal-soft"
      >
        <span
          key={bellPulseTick}
          className={bellPulseTick > 0 ? "inline-block animate-bell-ring" : "inline-block"}
        >
          <ReminderMark className="h-5 w-5" />
        </span>
      </button>
    </header>
  );
}
