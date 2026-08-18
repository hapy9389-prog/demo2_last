/**
 * Reminder 기능의 시각적 정체성을 나타내는 최소 glyph — "정해진 한 순간". 얇은 원(아직
 * 열려있는 시간) 안에서 중심 점이 한 지점을 가리키는 짧은 바늘 하나로 "다가올 약속의
 * 시각"을 표현한다. 숫자도 종 모양도 없다 — 벨 이모지(🔔)나 generic alarm/calendar
 * 아이콘을 대체한다.
 *
 * `components/MemoryMark.tsx`와 개념적으로 대구를 이룬다: Memory는 점에서 밖으로 퍼지는
 * 흔적(=과거에 남은 것), Reminder는 원 안에서 한 지점을 가리키는 바늘(=아직 오지 않은
 * 순간)이다.
 *
 * `currentColor` 기반이라 색은 항상 호출부의 text color 클래스가 정한다(예: `text-seal`).
 * 크기도 항상 호출부 className으로 지정하는 순수 프레젠테이션 컴포넌트 — Reminder 아이콘이
 * 필요한 모든 곳(ChatHeader/HomeScreen 벨 버튼, ReminderPanel, ReminderSystemCard,
 * MessageBubble의 proactive 배지, NewMessageToast, HomeReminderSummary)에서 이 하나만
 * 재사용한다.
 */
export function ReminderMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.3" opacity="0.55" />
      <path d="M12 12 L15.2 7.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </svg>
  );
}
