"use client";

import { ReminderWithCharacter } from "@/types";
import { HomeRow, SpotlightPick } from "@/lib/homeStatus";
import { StoryModeEntry } from "./StoryModeEntry";
import { CharacterCard } from "./CharacterCard";
import { HomeReminderSummary } from "./HomeReminderSummary";
import { HomeHero } from "./HomeHero";
import { ReminderMark } from "./ReminderMark";

export type { HomeRow };

/**
 * 홈 화면. 헤더(고정) + 스크롤 영역(Hero → 리마인더 요약 → 캐릭터 레일 → Story 티저)으로
 * 구성된 오케스트레이터. 캐릭터 "상태" 판단은 여기서 하지 않고 lib/homeStatus.ts에 맡긴다.
 *
 * "Modern Character Entertainment App" 2차 리디자인에서 섹션 순서를 재배치했다: Story
 * 진입부는 더 이상 최상단이 아니라 캐릭터 레일 아래(맨 끝)로 옮겨서, 스크롤 끝에서 "다른
 * 분위기의 문"처럼 마무리되게 한다. 박스/구분선 대신 섹션 간 여백 자체가 구획 역할을 한다.
 */
export function HomeScreen({
  rows,
  spotlight,
  reminders,
  pendingReminderCount,
  bellPulseTick,
  onSelect,
  onOpenReminders,
}: {
  rows: HomeRow[];
  /** Hero에 띄울 캐릭터. 캐릭터가 하나도 없을 때만 null(현재 앱에서는 발생하지 않음). */
  spotlight: SpotlightPick | null;
  reminders: ReminderWithCharacter[];
  pendingReminderCount: number;
  /** 리마인더/proactive 메시지가 도착할 때마다 증가 — bell 아이콘 강조 애니메이션 재생용. */
  bellPulseTick: number;
  onSelect: (characterId: string) => void;
  onOpenReminders: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper">
      <header className="flex items-center justify-between border-b border-paper-sunken px-4 py-4">
        <h1 className="text-lg font-bold text-ink">AI 캐릭터 채팅</h1>
        <button
          onClick={onOpenReminders}
          aria-label="리마인더 목록 열기"
          className="relative flex h-9 w-9 items-center justify-center rounded-full bg-seal-soft text-seal transition-opacity hover:opacity-80"
        >
          <span
            key={bellPulseTick}
            className={bellPulseTick > 0 ? "inline-block animate-bell-ring" : "inline-block"}
          >
            <ReminderMark className="h-5 w-5" />
          </span>
          {pendingReminderCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-seal px-1 text-[10px] font-semibold text-white">
              {pendingReminderCount}
            </span>
          )}
        </button>
      </header>

      <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto pb-4">
        {spotlight && (
          <div className="shrink-0 px-4 pt-6">
            <HomeHero pick={spotlight} onSelect={onSelect} />
          </div>
        )}

        {/* HomeReminderSummary는 pending 리마인더가 없으면 null을 반환한다 — 그 경우
           이 wrapper의 mt-8까지 남아있으면 라벨의 pt-8과 겹쳐 다른 상태보다 여백이
           두 배로 보인다. pending 유무를 여기서도 확인해 그럴 때는 wrapper 자체를
           렌더링하지 않는다(HomeReminderSummary 내부 로직/데이터는 그대로). */}
        {reminders.some((r) => r.status === "pending") && (
          <div className="mt-8 shrink-0">
            <HomeReminderSummary reminders={reminders} onOpenReminders={onOpenReminders} />
          </div>
        )}

        <p className="shrink-0 px-4 pb-2 pt-8 text-xs font-medium uppercase tracking-wide text-ink-soft">
          캐릭터
        </p>
        <div className="no-scrollbar flex shrink-0 snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2">
          {rows.map((row) => (
            <CharacterCard key={row.character.id} row={row} onSelect={onSelect} />
          ))}
        </div>

        {/* 콘텐츠가 프레임보다 짧을 때 남는 세로 공간을 이 spacer가 흡수해서 Story teaser가
            화면 하단까지 자연스럽게 이어지도록 한다. teaser 자체는 flex-grow를 갖지 않고
            항상 고정 높이(h-44 / sm:h-48)를 유지한다 — 늘어나는 건 이 보이지 않는 spacer뿐이다.
            콘텐츠가 길어 스크롤이 필요해지면 spacer는 flex-shrink로 0에 수렴해 정상적인
            스크롤 흐름으로 돌아간다. 다른 형제들은 shrink-0으로 고정해 spacer/teaser 때문에
            눌리는 일이 없게 한다. */}
        <div className="flex-1" aria-hidden="true" />

        <div className="mt-10 shrink-0">
          <StoryModeEntry />
        </div>
      </div>
    </div>
  );
}
