import { StoryMessage } from "@/types/story";

/**
 * 인터랙티브 소설 화면의 메시지 블록. 카톡형 말풍선(components/MessageBubble.tsx)과
 * 시각적으로 명확히 구분한다 — 사용자 입력은 인용 스타일 한 줄로, AI 응답은 여러 문단을
 * 그대로 읽기 좋은 프로즈로 보여준다.
 */
export function StoryMessageBlock({ message }: { message: StoryMessage }) {
  if (message.role === "user") {
    return (
      <p className="animate-message-in border-l-2 border-story-ink/25 pl-3 text-sm italic text-story-ink/70">
        {message.content}
      </p>
    );
  }

  const paragraphs = message.content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  // leading-8(오프닝 씬과 동일 리듬)은 모바일에서 일반 응답 길이엔 너무 성글어 보여서
  // leading-7을 유지하고, 대신 문단 사이 간격(space-y-4)을 오프닝 씬만큼 넉넉하게 줘서
  // 프로즈 읽기 리듬은 유지하되 줄 자체는 조밀하게 둔다.
  return (
    <div className="animate-message-in space-y-4 text-[15px] leading-7 text-story-ink">
      {paragraphs.map((paragraph, i) => (
        <p key={i} className="whitespace-pre-wrap">
          {paragraph}
        </p>
      ))}
    </div>
  );
}
