/**
 * Memory 기능의 시각적 정체성을 나타내는 최소 glyph — "기억의 흔적/울림". 중심 점 하나에서
 * 옅어지는 동심원 두 겹이 퍼져나가는 형태로 "남아있는 기억"을 은유한다. 뇌 이모지(🧠)나
 * AI sparkle(✨류)처럼 기술적/generic하게 보이지 않도록 의도적으로 아주 단순하게 그렸다.
 *
 * `currentColor` 기반이라 색은 항상 호출부의 text color 클래스가 정한다(예:
 * `text-memory`). 크기도 항상 호출부 className으로 지정하는 순수 프레젠테이션
 * 컴포넌트 — Memory 아이콘이 필요한 모든 곳(ChatHeader 진입 버튼, StoryScreen 진입
 * 버튼, MemoryPanel 제목/워터마크)에서 이 하나만 재사용한다.
 */
export function MemoryMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="2.1" fill="currentColor" />
      <circle cx="12" cy="12" r="6.5" stroke="currentColor" strokeWidth="1.3" opacity="0.55" />
      <circle cx="12" cy="12" r="10.5" stroke="currentColor" strokeWidth="1" opacity="0.25" />
    </svg>
  );
}
