"use client";

import { InteractionMark } from "./InteractionMark";

/**
 * 앱 전역 설정 바텀시트. ReminderPanel.tsx와 동일한 구조(open prop + 오버레이 +
 * rounded-t-3xl 시트)를 재사용한다 — 토글 하나뿐이라 MemoryPanel.tsx의 "마운트=열림,
 * 자체 fetch" 패턴보다 이 쪽이 더 단순하고 적합하다. 데이터(현재 값)는 이 컴포넌트가
 * 직접 조회하지 않고 부모(ChatApp)가 소유해 props로 내려준다 — ReminderPanel이
 * reminders를 부모에게서 받는 것과 동일한 이유.
 *
 * 이 설정은 특정 캐릭터가 아니라 앱 전역에 적용되므로, Memory(보라)/Reminder(seal)
 * 처럼 전용 accent 토큰을 새로 만들지 않고 ink 계열 중립 톤을 사용한다.
 */
export function SettingsPanel({
  open,
  crossCharacterInteractionEnabled,
  onClose,
  onToggleCrossCharacterInteraction,
}: {
  open: boolean;
  crossCharacterInteractionEnabled: boolean;
  onClose: () => void;
  onToggleCrossCharacterInteraction: (next: boolean) => void;
}) {
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end">
      <button
        aria-label="닫기"
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-black/30"
      />
      <div className="relative z-10 flex max-h-[70%] animate-sheet-up flex-col rounded-t-3xl bg-paper shadow-2xl">
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-paper-sunken" />
        <div className="flex items-center justify-between gap-3 border-b border-paper-sunken bg-paper px-4 py-3">
          <h2 className="flex items-center gap-1.5 truncate font-display text-sm font-bold text-ink">
            <InteractionMark className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
            설정
          </h2>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="shrink-0 text-ink-soft transition-colors hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="no-scrollbar flex-1 overflow-y-auto p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">캐릭터 상호작용 인식</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
                다른 캐릭터와 대화한 사실을 캐릭터가 눈치챌 수 있습니다.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={crossCharacterInteractionEnabled}
              aria-label="캐릭터 상호작용 인식"
              onClick={() => onToggleCrossCharacterInteraction(!crossCharacterInteractionEnabled)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                crossCharacterInteractionEnabled ? "bg-ink" : "bg-paper-sunken"
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-paper shadow transition-transform ${
                  crossCharacterInteractionEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
