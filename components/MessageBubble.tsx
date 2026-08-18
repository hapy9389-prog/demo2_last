import { ReactNode } from "react";
import { formatKoreanTime } from "@/lib/time";
import { Character, Message } from "@/types";
import { Avatar } from "./Avatar";
import { ReminderMark } from "./ReminderMark";
import { ACCENT_RULE_STYLE } from "@/lib/accentColors";

/**
 * "**text**"만 안전하게 <strong>으로 바꾸는 최소 parser. 전체 Markdown을 지원하지
 * 않고 bold 하나만 처리한다(대형 markdown 라이브러리를 추가하지 않기 위함).
 * dangerouslySetInnerHTML을 쓰지 않고 React 엘리먼트/문자열 배열만 반환한다.
 * 닫히지 않은 `**`는 정규식이 매치하지 않으므로 안전하게 원본 텍스트로 남는다.
 *
 * `.+?`(줄바꿈 제외, non-greedy)를 쓴다 — `[^*]+?`처럼 내부에 `*` 문자가 하나라도
 * 있으면 매칭 자체가 깨지는 방식보다 단순하고 안전하다. `**`로 닫히기만 하면 되므로
 * "**A*B**"도 정상 처리된다. `s` 플래그(dotAll)는 의도적으로 넣지 않는다 — `.`이
 * 줄바꿈을 넘지 않으므로 한 bold 구간이 여러 문단에 걸쳐 잘못 이어붙는 것을
 * 구조적으로 막아준다(행동 묘사는 원래 짧은 한 줄이어야 하므로 이 제약이 자연스럽다).
 */
function renderAssistantContent(text: string): ReactNode[] {
  const parts = text.split(/(\*\*.+?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

export function MessageBubble({
  message,
  character,
}: {
  message: Message;
  character: Character;
}) {
  const isUser = message.role === "user";
  const isReminder = message.origin === "reminder";
  const time = formatKoreanTime(new Date(message.createdAt));

  return (
    <div
      className={`flex items-end gap-2 ${isUser ? "justify-end" : "justify-start"} ${
        isReminder ? "animate-message-in-strong" : "animate-message-in"
      }`}
    >
      {!isUser && <Avatar character={character} size="sm" emphasize={isReminder} />}
      <div className={`flex max-w-[78%] flex-col ${isUser ? "items-end" : "items-start"}`}>
        {isUser ? (
          // 내 메시지만 옅은 pill 배경을 둔다 — "내가 보낸 말풍선"이라는 신호는 필요하지만
          // 화면을 지배할 만큼 진하지는 않게. 캐릭터 메시지는 아래에서 버블 없이 보여준다.
          <div className="rounded-2xl rounded-br-sm bg-seal-soft px-4 py-2 text-sm leading-relaxed text-ink">
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        ) : (
          // 캐릭터 메시지는 버블 박스 없이 paper 배경 위 텍스트 그대로 둔다 — 가독성이
          // 최우선이고, 캐릭터 accent 색의 얇은 rule 하나로만 "누구의 말인지" 표시한다.
          <div
            className={`border-l-2 py-0.5 pl-3 text-sm leading-relaxed text-ink ${ACCENT_RULE_STYLE[character.accent]}`}
          >
            {isReminder && (
              <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-seal">
                <ReminderMark className="h-3 w-3 shrink-0" />
                <span>먼저 말을 걸었어요</span>
              </div>
            )}
            <p className="whitespace-pre-wrap">{renderAssistantContent(message.content)}</p>
          </div>
        )}
        <span className="mt-1 px-1 text-[10px] text-ink-soft">{time}</span>
      </div>
    </div>
  );
}
