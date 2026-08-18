"use client";

import { formatReminderTime } from "@/lib/time";
import { ReminderWithCharacter } from "@/types";
import { ReminderMark } from "./ReminderMark";

const MAX_VISIBLE = 2;

/**
 * 홈 화면 상단의 예정된 리마인더 요약. pending 리마인더가 없으면 아무것도 렌더링하지
 * 않는다. 항목/더보기 클릭 모두 기존 onOpenReminders를 호출해 기존 ReminderPanel
 * 바텀시트를 그대로 연다 — 새 패널을 따로 만들지 않는다.
 */
export function HomeReminderSummary({
  reminders,
  onOpenReminders,
}: {
  reminders: ReminderWithCharacter[];
  onOpenReminders: () => void;
}) {
  const pending = reminders
    .filter((r) => r.status === "pending")
    .sort((a, b) => a.triggerAt.localeCompare(b.triggerAt));

  if (pending.length === 0) return null;

  const visible = pending.slice(0, MAX_VISIBLE);
  const remaining = pending.length - visible.length;

  return (
    <div className="space-y-2 px-4 pt-3">
      {visible.map((r) => (
        <button
          key={r.id}
          onClick={onOpenReminders}
          className="flex w-full items-center gap-2 rounded-2xl bg-seal-soft px-3 py-2 text-left text-xs text-seal transition-opacity hover:opacity-80"
        >
          <ReminderMark className="h-4 w-4 shrink-0 text-seal" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-semibold">
              {r.characterEmoji} {r.characterName}
            </span>
            <span className="ml-1.5">{formatReminderTime(new Date(r.triggerAt))}</span>
            <span className="ml-1.5 text-seal/80">· {r.content}</span>
          </span>
        </button>
      ))}
      {remaining > 0 && (
        <button
          onClick={onOpenReminders}
          className="w-full rounded-xl px-3 py-1 text-center text-xs font-medium text-seal hover:opacity-80"
        >
          +{remaining}개 더보기
        </button>
      )}
    </div>
  );
}
