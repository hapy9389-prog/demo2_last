"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Character, Message, ReminderCardItem } from "@/types";
import { ChatHeader } from "./ChatHeader";
import { MessageBubble } from "./MessageBubble";
import { ProcessingIndicator } from "./ProcessingIndicator";
import { ReminderSystemCard } from "./ReminderSystemCard";

type TimelineItem =
  | { kind: "message"; key: string; createdAt: string; data: Message }
  | { kind: "reminderCard"; key: string; createdAt: string; data: ReminderCardItem };

/**
 * 한글 주격 조사(이/가) 판별. 표준 받침 판별식 — 마지막 글자가 한글 음절이고 종성이
 * 있으면 "이", 없으면 "가"(한글이 아니거나 빈 문자열이면 기본값 "가"). 캐릭터 이름은
 * lib/characters.ts에 고정 6개뿐이지만 "레이/유이/미나/세라/루나"는 받침이 없어 "가"가
 * 맞고 "아린"만 받침(ㄴ)이 있어 "이"가 맞다 — 하드코딩하면 아린만 틀리므로 작은 순수
 * 함수로 둔다.
 */
function getSubjectParticle(name: string): "이" | "가" {
  const lastChar = name.trim().at(-1);
  if (!lastChar) return "가";
  const code = lastChar.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return "가";
  return (code - 0xac00) % 28 !== 0 ? "이" : "가";
}

export function ChatWindow({
  character,
  messages,
  reminderCards,
  bellPulseTick,
  onSend,
  sending,
  error,
  onBack,
  onOpenReminders,
  onOpenMemory,
}: {
  character: Character;
  messages: Message[];
  reminderCards: ReminderCardItem[];
  /** 리마인더/proactive 메시지가 도착할 때마다 증가 — ChatHeader의 bell 강조 애니메이션에 그대로 전달. */
  bellPulseTick: number;
  onSend: (text: string) => void;
  sending: boolean;
  error: string | null;
  onBack: () => void;
  onOpenReminders: () => void;
  onOpenMemory: () => void;
}) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // 일반 대화 메시지와 리마인더 등록 시스템 카드를 시간순으로 병합해 한 스크롤에 보여준다.
  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...messages.map((m) => ({
        kind: "message" as const,
        key: m.id,
        createdAt: m.createdAt,
        data: m,
      })),
      ...reminderCards.map((c) => ({
        kind: "reminderCard" as const,
        key: `card-${c.id}`,
        createdAt: c.createdAt,
        data: c,
      })),
    ];
    return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [messages, reminderCards]);

  // 캐릭터 이름 기반 3단계 문구. sending 중에만 렌더링되므로 매 렌더마다 새로 만들어도
  // 비용이 크지 않지만, character가 안 바뀌면 재계산할 이유가 없어 memo한다.
  const chatIndicatorMessages = useMemo(() => {
    const p = getSubjectParticle(character.name);
    return [
      `${character.name}${p} 대화를 읽고 있어요…`,
      `${character.name}${p} 기억과 맥락을 정리하고 있어요…`,
      `${character.name}${p} 답변을 준비하고 있어요…`,
    ];
  }, [character.name]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [timeline.length]);

  // Processing Indicator는 timeline에 포함되지 않으므로 위 effect가 반응하지 않는다 —
  // sending이 false→true가 되는 순간에만(문구 전환마다는 X) 한 번 스크롤해 Indicator가
  // 보이게 한다. Chat은 기존에도 near-bottom 가드 없이 항상 스크롤하는 정책이라 여기도
  // 동일하게 무조건 스크롤한다(Story와 다름 — Story는 near-bottom 가드가 있다).
  useEffect(() => {
    if (sending) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sending]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    onSend(text);
    setInput("");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper">
      <ChatHeader
        character={character}
        bellPulseTick={bellPulseTick}
        onBack={onBack}
        onOpenReminders={onOpenReminders}
        onOpenMemory={onOpenMemory}
      />

      <div className="no-scrollbar flex-1 space-y-3 overflow-y-auto px-3 py-4">
        {timeline.length === 0 && (
          <p className="mt-10 text-center text-sm text-ink-soft">
            {character.emoji} {character.name}에게 말을 걸어보세요.
          </p>
        )}
        {timeline.map((item) =>
          item.kind === "message" ? (
            <MessageBubble key={item.key} message={item.data} character={character} />
          ) : (
            <ReminderSystemCard
              key={item.key}
              content={item.data.content}
              timeLabel={item.data.timeLabel}
            />
          )
        )}
        {sending && <ProcessingIndicator variant="chat" messages={chatIndicatorMessages} />}
        <div ref={bottomRef} />
      </div>

      {error && <p className="px-4 pb-1 text-xs text-red-500">{error}</p>}

      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 border-t border-paper-sunken bg-paper px-4 py-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`${character.name}에게 메시지 보내기...`}
          className="flex-1 border-b border-paper-sunken bg-transparent px-1 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-soft focus:border-seal"
          disabled={sending}
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          aria-label="전송"
          className={`flex h-9 w-9 shrink-0 items-center justify-center text-xl transition-colors ${
            input.trim() && !sending ? "text-seal" : "text-ink-soft/40"
          }`}
        >
          {sending ? "···" : "↑"}
        </button>
      </form>
    </div>
  );
}
