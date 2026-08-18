"use client";

import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { CHARACTERS } from "@/lib/characters";
import { Character } from "@/types";

/**
 * Guest Character 초대/제거 바텀시트. components/ReminderPanel.tsx와 같은 셸 패턴
 * (`absolute inset-0 z-40` 백드롭 + `animate-sheet-up` 시트) — 부모(StoryScreen 루트)가
 * `relative`라 폰 프레임 안에서만 덮인다. 캐릭터 카탈로그(CHARACTERS)는 정적 모듈이라
 * 별도 API 없이 클라이언트에서 바로 읽는다.
 */
export function GuestInvitePanel({
  open,
  currentGuest,
  onClose,
  onInvite,
  onRemove,
}: {
  open: boolean;
  /** 현재 세션에 초대된 게스트(MVP: 최대 1명). 없으면 null. */
  currentGuest: Character | null;
  onClose: () => void;
  onInvite: (characterId: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleInvite = async (characterId: string) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await onInvite(characterId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "초대에 실패했습니다.");
    } finally {
      setPending(false);
    }
  };

  const handleRemove = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await onRemove();
    } catch (err) {
      setError(err instanceof Error ? err.message : "제거에 실패했습니다.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end">
      <button
        aria-label="닫기"
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-black/30"
      />
      {/* Story 본문의 dark cinematic 톤과 완전히 분리하지 않는다 — bg-paper 유틸리티
         시트는 유지하되("지금은 이야기 밖으로 나와 설정을 바꾸는 중"이라는 구분은
         남기고), story 톤이 아주 옅게 스며드는 워시를 얹어 Story 화면과의 연결감을
         준다. 장식(워시)은 `absolute inset-0 pointer-events-none`으로 깔고 실제
         콘텐츠는 `relative z-10`으로 그 위에 명시적으로 올려서, DOM 순서나 암묵적
         stacking 규칙에 기대지 않고 항상 콘텐츠가 워시 위에 오도록 한다. */}
      <div className="relative z-10 flex max-h-[70%] animate-sheet-up flex-col overflow-hidden rounded-t-3xl bg-paper shadow-2xl">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-story-bg/10 via-transparent to-transparent"
        />

        <div className="relative z-10 flex min-h-0 flex-1 flex-col">
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-story-bg/15" />
          <div className="flex items-center justify-between border-b border-story-bg/10 bg-story-bg/5 px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">
              {currentGuest ? "게스트 캐릭터" : "캐릭터 초대"}
            </h2>
            <button
              onClick={onClose}
              aria-label="닫기"
              className="shrink-0 text-ink-soft transition-colors hover:text-ink"
            >
              ✕
            </button>
          </div>

          {error && (
            <p className="px-4 pt-2 text-xs text-red-500">{error}</p>
          )}

          {currentGuest ? (
            <div className="flex flex-col items-center gap-3 p-6">
              <Avatar character={currentGuest} size="xl" />
              <div className="text-center">
                <p className="font-semibold text-ink">{currentGuest.name}</p>
                <p className="text-xs text-ink-soft">{currentGuest.tagline}</p>
              </div>
              <button
                onClick={handleRemove}
                disabled={pending}
                className="mt-1 text-xs font-medium text-ink-soft hover:text-red-500 disabled:opacity-50"
              >
                {pending ? "제거하는 중..." : "제거하기"}
              </button>
              <p className="text-center text-[11px] text-ink-soft">
                다른 캐릭터로 바꾸려면 먼저 제거한 뒤 다시 초대해주세요.
              </p>
            </div>
          ) : (
            <div className="no-scrollbar flex-1 divide-y divide-story-bg/10 overflow-y-auto p-3">
              {CHARACTERS.map((character) => (
                <button
                  key={character.id}
                  onClick={() => handleInvite(character.id)}
                  disabled={pending}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-story-bg/5 disabled:opacity-50"
                >
                  <Avatar character={character} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {character.name}
                    </p>
                    <p className="truncate text-xs text-ink-soft">{character.tagline}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
