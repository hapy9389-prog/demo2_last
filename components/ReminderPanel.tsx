"use client";

import { ReminderWithCharacter } from "@/types";
import { formatKoreanTime } from "@/lib/time";
import { ReminderMark } from "./ReminderMark";

/**
 * 리마인더 목록 전용 day 라벨("오늘"/"내일"/"8월 20일"). lib/time.ts는 scheduler/route가
 * 공유하는 triggerAt 계산·검증의 source of truth라서 건드리지 않는다 — MemoryPanel.tsx의
 * formatMemoryDate와 동일한 이유로 표시 전용 로직만 이 컴포넌트 안에 로컬로 둔다. 시:분
 * 자체는 lib/time.ts의 formatKoreanTime을 그대로 재사용한다.
 */
function formatReminderDayLabel(triggerAt: Date, now: Date = new Date()): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(triggerAt) - startOfDay(now)) / 86_400_000);
  if (diffDays === 0) return "오늘";
  if (diffDays === 1) return "내일";
  return `${triggerAt.getMonth() + 1}월 ${triggerAt.getDate()}일`;
}

/** 캐릭터가 이 리마인더에 대해 지금 하고 있는/할 일을 자연스러운 한 문장으로. */
function describeReminderAction(r: ReminderWithCharacter): string {
  switch (r.status) {
    case "pending":
      return `${r.characterName}가 이 시간에 먼저 말을 걸어요`;
    case "processing":
      return `${r.characterName}가 지금 말을 전하고 있어요`;
    case "fired":
      return `${r.characterName}가 이미 전했어요`;
    case "failed":
      return `${r.characterName}에게 전달하지 못했어요`;
  }
}

/**
 * 리마인더 목록 바텀시트. 부모(폰 프레임 body)가 `relative`여야 이 안에서
 * `absolute inset-0`이 브라우저 전체가 아니라 폰 화면 안에서만 덮인다.
 */
export function ReminderPanel({
  open,
  reminders,
  onClose,
  onDelete,
}: {
  open: boolean;
  reminders: ReminderWithCharacter[];
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  if (!open) return null;

  // pending/processing = 아직 지켜지지 않은 "살아있는" 약속(active), fired/failed = 이미
  // 지나간 약속(past). active는 가장 가까운 시각이 먼저 오도록, past는 최근 것이 위로
  // 오도록 정렬한다 — 표시 순서만 바뀔 뿐 API로 받은 데이터 자체는 그대로다.
  const active = reminders
    .filter((r) => r.status === "pending" || r.status === "processing")
    .sort((a, b) => a.triggerAt.localeCompare(b.triggerAt));
  const past = reminders
    .filter((r) => r.status === "fired" || r.status === "failed")
    .sort((a, b) => b.triggerAt.localeCompare(a.triggerAt));
  const ordered = [...active, ...past];
  const nearestActive = active[0];

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end">
      <button
        aria-label="닫기"
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-black/30"
      />
      <div className="relative z-10 flex max-h-[70%] animate-sheet-up flex-col rounded-t-3xl bg-paper shadow-2xl">
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-paper-sunken" />
        {/* Memory 헤더보다 한 단계 절제 — 장식용 glow/watermark 없이, ReminderMark
           아이콘과 "가장 가까운 약속" 시각 자체가 헤더의 중심이 되게 한다. */}
        <div className="flex items-center justify-between gap-3 border-b border-seal/15 bg-paper px-4 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 truncate font-display text-sm font-bold text-ink">
              <ReminderMark className="h-3.5 w-3.5 shrink-0 text-seal" />
              예정된 약속
            </h2>
            {nearestActive ? (
              <p className="mt-0.5 truncate text-xs text-seal">
                가장 가까운 약속 · {formatReminderDayLabel(new Date(nearestActive.triggerAt))}{" "}
                {formatKoreanTime(new Date(nearestActive.triggerAt))}
              </p>
            ) : (
              <p className="mt-0.5 truncate text-xs text-ink-soft">아직 다가올 약속이 없어요.</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="shrink-0 text-ink-soft transition-colors hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="no-scrollbar flex-1 overflow-y-auto p-3">
          {reminders.length === 0 && (
            <div className="mt-8 flex flex-col items-center gap-3 text-center">
              <ReminderMark className="h-16 w-16 text-seal opacity-30" />
              <p className="text-xs leading-relaxed text-ink-soft">
                아직 약속한 시간이 없어요.
                <br />
                &quot;~해줘&quot;처럼 말해보면 그 시간에 캐릭터가 먼저 연락해요.
              </p>
            </div>
          )}

          {ordered.length > 0 && (
            <div className="divide-y divide-paper-sunken">
              {ordered.map((r) => {
                const isActive = r.status === "pending" || r.status === "processing";
                const isFailed = r.status === "failed";
                const triggerDate = new Date(r.triggerAt);
                return (
                  <div key={r.id} className="animate-message-in flex gap-3 py-3 text-xs">
                    {/* 시간 정보가 가장 중요한 정보라 왼쪽 고정폭 열에 크게 둔다. active가
                       아닐 때만 이 열을 옅게 낮춘다 — 본문(오른쪽)은 상태와 무관하게 항상
                       또렷하게 읽혀야 한다. */}
                    <div className={`w-16 shrink-0 text-right ${isActive ? "" : "opacity-70"}`}>
                      <p className="text-[10px] uppercase tracking-wide text-ink-soft">
                        {formatReminderDayLabel(triggerDate)}
                      </p>
                      <p
                        className={`mt-0.5 text-sm font-bold ${isActive ? "text-seal" : "text-ink-soft"}`}
                      >
                        {formatKoreanTime(triggerDate)}
                      </p>
                    </div>

                    <div className="min-w-0 flex-1 border-l border-paper-sunken pl-3">
                      <p className="leading-relaxed text-ink">{r.content}</p>
                      <p className="mt-1 flex items-center gap-1 text-ink-soft">
                        <span aria-hidden>{r.characterEmoji}</span>
                        <span>{describeReminderAction(r)}</span>
                      </p>
                      {isFailed && (
                        <p className="mt-1 font-medium text-red-500">
                          잠시 후 다시 시도하거나 새로 요청해 주세요.
                        </p>
                      )}
                      {/* 사용자가 원래 어떻게 말했는지 확인할 방법이 이 패널 말고는 없어서,
                         압축된 레이아웃에서도 아주 작게나마 남겨둔다. */}
                      <p className="mt-1 truncate text-[10px] text-ink-soft/70">
                        &quot;{r.originalPhrase}&quot;
                      </p>
                      {r.status === "pending" && (
                        <div className="mt-1.5 flex justify-end">
                          <button
                            onClick={() => onDelete(r.id)}
                            className="font-medium text-ink-soft hover:text-red-500"
                          >
                            취소
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
