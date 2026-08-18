/**
 * Cross-Character Interaction Awareness 설정의 시각적 정체성을 나타내는 최소 glyph —
 * "다른 존재와의 스침/눈치챔". 서로 옅게 겹치는 두 원으로 "누군가 다른 사람을 스치고
 * 지나갔다는 사실을 알아챈다"는 개념을 은유한다. MemoryMark(기억의 흔적/울림)나
 * ReminderMark(정해진 미래의 한 순간)와 겹치지 않는 별도 모티프다.
 *
 * `currentColor` 기반이라 색은 항상 호출부의 text color 클래스가 정한다. 이 설정은
 * 특정 캐릭터의 성격이 아니라 앱 전역 설정이므로, Memory(보라)/Reminder(seal)처럼
 * 전용 accent 토큰을 새로 만들지 않고 호출부(ChatHeader)에서 중립 톤(text-ink-soft)을
 * 지정한다.
 */
export function InteractionMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx="9" cy="12" r="5.5" stroke="currentColor" strokeWidth="1.3" opacity="0.85" />
      <circle cx="15" cy="12" r="5.5" stroke="currentColor" strokeWidth="1.3" opacity="0.4" />
    </svg>
  );
}
