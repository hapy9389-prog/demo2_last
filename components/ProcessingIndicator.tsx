"use client";

import { useEffect, useState } from "react";

// 1.5초, 3초 시점에 다음 문구로 넘어간다. 그 이후로는 마지막 문구를 계속 유지하고,
// 끝없이 순환하지 않는다(실제 서버 진행률이 아니라 체감용 문구이므로).
const STAGE_DELAYS_MS = [1500, 3000];

/**
 * Chat/Story 공통 "응답 준비 중" 표시. 실제 서버 진행 단계와 무관한 시간 기반 문구
 * 전환이다 — 정확한 진행률을 전달하는 게 아니라 "정상적으로 처리되고 있다"는 느낌만
 * 준다. 부모가 `{sending && <ProcessingIndicator .../>}` 형태로 조건부 마운트해야 한다
 * (components/MemoryPanel.tsx와 동일한 패턴) — 그래야 요청마다 새 인스턴스로 시작하고,
 * 응답이 오든 실패하든 unmount 시 effect cleanup이 타이머를 자동으로 정리한다.
 */
export function ProcessingIndicator({
  variant,
  messages,
}: {
  variant: "chat" | "story";
  messages: string[];
}) {
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    if (messages.length <= 1) return; // 전환할 다음 문구가 없음
    const timers = STAGE_DELAYS_MS.map((delay, i) => {
      const nextIndex = i + 1;
      return window.setTimeout(() => {
        if (nextIndex < messages.length) setStageIndex(nextIndex);
      }, delay);
    });
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [messages]);

  if (messages.length === 0) return null;
  const text = messages[Math.min(stageIndex, messages.length - 1)];

  const dot = (
    <span
      aria-hidden
      className={`inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full ${
        variant === "chat" ? "bg-ink-soft" : "bg-story-ink/40"
      }`}
    />
  );

  if (variant === "chat") {
    // 캐릭터 메시지가 버블 없이 보이는 것과 같은 문법 — 상태 표시도 박스 없이
    // 왼쪽 정렬된 텍스트 + 점 하나로만.
    return (
      <div
        className="flex animate-message-in items-center gap-2 py-0.5 pl-1 text-sm text-ink-soft"
        role="status"
        aria-live="polite"
      >
        {dot}
        <span>{text}</span>
      </div>
    );
  }

  return (
    <p
      className="flex animate-message-in items-center gap-1.5 text-xs text-story-ink/60"
      role="status"
      aria-live="polite"
    >
      {dot}
      <span>{text}</span>
    </p>
  );
}
