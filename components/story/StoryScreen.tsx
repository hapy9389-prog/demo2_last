"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { MemoryMark } from "@/components/MemoryMark";
import { MemoryPanel } from "@/components/MemoryPanel";
import { ProcessingIndicator } from "@/components/ProcessingIndicator";
import { getCharacterById } from "@/lib/characters";
import {
  GuestCharacterSlot,
  Story,
  StoryChatResponse,
  StoryMessage,
  StorySessionSummary,
} from "@/types/story";
import { GuestInvitePanel } from "./GuestInvitePanel";
import { StoryMessageBlock } from "./StoryMessageBlock";

// Story는 캐릭터 이름이 필요 없다 — 원작 캐릭터/Guest 유무와 무관하게 항상 자연스러운
// 정적 3단계 문구(실제 서버 진행률과 무관, 체감용).
const STORY_INDICATOR_MESSAGES = [
  "이야기의 흐름을 확인하고 있어요…",
  "등장인물들의 상황을 정리하고 있어요…",
  "다음 장면을 만들고 있어요…",
];

/**
 * 인터랙티브 소설 진행 화면. Chat Mode의 ChatWindow/ChatApp과 달리 폴링이 없다 —
 * Story Mode에는 proactive 발화가 존재하지 않으므로 3초 간격 인터벌 로직 자체가
 * 불필요하다. 마운트 시 이력을 한 번 불러오고, 사용자가 보낼 때마다 결과를 이어붙인다.
 *
 * sessionId는 항상 유효한 값이 부모(app/story/[storyId]/page.tsx)에서 검증된 뒤
 * 넘어온다 — 이 컴포넌트 자체는 세션 부재를 다룰 필요가 없다(그 경우는
 * StorySessionMissing이 대신 렌더링된다).
 */
export function StoryScreen({
  story,
  sessionId,
  initialGuestCharacters,
}: {
  story: Story;
  sessionId: string;
  /** app/story/[storyId]/page.tsx가 서버에서 이미 갖고 있는 session.guestCharacters를
   * 그대로 내려준다 — 세션을 나갔다가 다시 들어와도 별도 fetch 없이 게스트가 복원된다. */
  initialGuestCharacters: GuestCharacterSlot[];
}) {
  const [messages, setMessages] = useState<StoryMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // MVP: 세션당 게스트 1명(lib/storyStore.ts의 MAX_GUEST_CHARACTERS_PER_SESSION). 배열
  // 그대로 들고 있다가 첫 번째 항목만 쓴다 — 나중에 여러 명을 지원해도 이 상태 자체는
  // 바꿀 필요가 없다.
  const [guestCharacters, setGuestCharacters] = useState<GuestCharacterSlot[]>(
    initialGuestCharacters
  );
  const [guestPanelOpen, setGuestPanelOpen] = useState(false);
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // 사용자가 스크롤 바닥 근처(120px 이내)에 있는지 계속 추적한다. 과거 내용을 읽으려고
  // 위로 스크롤해 둔 상태라면(false), 새 턴이 추가돼도 강제로 맨 아래까지 끌어내리지
  // 않는다. messages.length effect는 응답이 이미 추가된 "이후"에 실행되므로, 그 안에서
  // 직접 실시간으로 측정하면 늘어난 콘텐츠 기준으로 계산돼 "보내기 직전엔 바닥
  // 근처였다"는 사실을 놓친다 — 그래서 이 ref는 "응답이 오기 직전" 시점의 위치를
  // 기억해두는 용도로 쓴다.
  const isNearBottomRef = useRef(true);
  const hasScrolledOnceRef = useRef(false);

  const measureIsNearBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return true; // 콘텐츠가 없으면 기본 true(최초 마운트 안전장치)
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  // 사용자가 실제로 스크롤할 때마다 ref를 최신 상태로 유지한다.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handleScroll = () => {
      isNearBottomRef.current = measureIsNearBottom();
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [measureIsNearBottom]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/story/messages?sessionId=${encodeURIComponent(sessionId)}`
        );
        const data = await res.json();
        if (!cancelled) setMessages(data.messages ?? []);
      } catch {
        if (!cancelled) setError("이야기를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (messages.length === 0) return;
    if (!isNearBottomRef.current) return; // 과거 내용을 읽는 중이면 스크롤 위치를 건드리지 않는다
    bottomRef.current?.scrollIntoView({
      behavior: hasScrolledOnceRef.current ? "smooth" : "auto",
      block: "end",
    });
    hasScrolledOnceRef.current = true;
  }, [messages.length]);

  // Processing Indicator는 messages 배열에 포함되지 않으므로 위 effect가 반응하지
  // 않는다 — sending이 false→true가 되는 순간에만(문구 전환마다는 X) 한 번 실행된다.
  // 이 시점은 콘텐츠가 늘어나기 "직전"이라 캐시된 ref 대신 그 순간의 실제 위치를 직접
  // 측정한다 — 오프닝 씬이 화면보다 길어서 사용자가 스크롤을 한 번도 하지 않은 채(입력창은
  // 항상 하단에 고정 노출돼 스크롤 없이도 접근 가능) 첫 메시지를 보내는 경우에도 항상
  // 정확하다. 동시에 이 측정값으로 ref를 갱신해서, 뒤이어 응답이 도착했을 때(messages.length
  // effect)도 "보내기 직전 위치" 기준으로 정확히 판단할 수 있게 한다 — 과거에는 scroll
  // 이벤트가 한 번도 안 일어난 상태에서 ref의 초기값(true)이 그대로 남아 "맨 위에 있는데
  // 바닥 근처"로 잘못 판단해 첫 메시지 전송 시 화면이 맨 아래로 튕기는 버그가 있었다.
  useEffect(() => {
    if (!sending) return;
    const nearBottom = measureIsNearBottom();
    isNearBottomRef.current = nearBottom;
    if (!nearBottom) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [sending, measureIsNearBottom]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    setInput("");
    try {
      const res = await fetch("/api/story/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text }),
      });
      const data: StoryChatResponse & { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error || "요청에 실패했습니다.");
      setMessages((prev) => [...prev, data.userMessage, data.reply]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.");
      setInput(text); // 실패 시 입력값 복원 — 다시 시도하기 쉽게
    } finally {
      setSending(false);
    }
  }, [input, sending, sessionId]);

  const handleInviteGuest = useCallback(
    async (characterId: string) => {
      const res = await fetch(`/api/story/sessions/${sessionId}/guests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId }),
      });
      const data: { session?: StorySessionSummary; error?: string } = await res.json();
      if (!res.ok || !data.session) throw new Error(data.error || "초대에 실패했습니다.");
      setGuestCharacters(data.session.guestCharacters);
      setGuestPanelOpen(false);
    },
    [sessionId]
  );

  const handleRemoveGuest = useCallback(async () => {
    const current = guestCharacters[0];
    if (!current) return;
    const res = await fetch(
      `/api/story/sessions/${sessionId}/guests/${current.sourceCharacterId}`,
      { method: "DELETE" }
    );
    const data: { session?: StorySessionSummary; error?: string } = await res.json();
    if (!res.ok || !data.session) throw new Error(data.error || "제거에 실패했습니다.");
    setGuestCharacters(data.session.guestCharacters);
  }, [guestCharacters, sessionId]);

  // 현재 게스트를 화면에 보여줄 때만 lib/characters.ts에서 실제 Character 정보를 조회한다
  // (캐릭터 카탈로그는 정적 모듈이라 클라이언트에서 바로 읽을 수 있다 — 별도 API 불필요).
  const currentGuestCharacter = useMemo(() => {
    const slot = guestCharacters[0];
    return slot ? getCharacterById(slot.sourceCharacterId) ?? null : null;
  }, [guestCharacters]);

  // openingScene은 첫 턴 이후에도 스크롤 히스토리의 가장 첫 항목으로 항상 남아 있어야
  // 한다 — 메시지가 쌓여도 사라지지 않고, 그 아래로 StoryMessage들이 계속 누적된다.
  const showOpeningScene = loaded;
  const openingParagraphs = story.openingScene
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {story.coverImage && (
        <>
          {/* 배경 이미지. scrollContainerRef 바깥(스크롤 영역의 형제)이라 메시지를
              스크롤해도 움직이지 않는다. scale-105 + blur-[1px]로 아주 약하게 흐리되,
              확대분은 StoryPhoneFrame(L2)의 overflow-hidden이 잘라주므로 여기선
              overflow-hidden을 새로 추가하지 않는다(중복 방지). */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-0 scale-105 bg-cover bg-center blur-[1px]"
            style={{ backgroundImage: `url(${story.coverImage})` }}
          />
          {/* 다크 시네마틱 스크림 — 이미지 자체를 죽이는 강한 white overlay 대신, 헤더/
              입력창 쪽만 살짝 진하고 중간은 이미지가 드러나는 그라디언트로 가독성만
              확보한다. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-story-bg/75 via-story-bg/30 to-story-bg/80"
          />
        </>
      )}

      {/* CSS 스펙상 position이 없는 일반 요소는 같은 스태킹 컨텍스트에서 absolute 요소보다
          항상 먼저(아래에) 칠해진다 — DOM 순서와 무관하다. 그래서 기존 UI 전체를 relative
          z-10 래퍼로 감싸 배경/overlay(z-0) 위에 오도록 명시적으로 승격시킨다. 아래 내용은
          scrollContainerRef/bottomRef/overflow-y-auto/min-h-0 포함해서 전부 그대로다. */}
      <div
        className={`relative z-10 flex min-h-0 flex-1 flex-col ${
          story.coverImage ? "" : "bg-story-bg"
        }`}
      >
        <header className="flex items-center gap-3 px-3 py-3">
          <Link
            href="/story"
            aria-label="스토리 목록으로"
            className="flex h-9 w-9 shrink-0 items-center justify-center text-xl text-white/55 transition-colors hover:text-story-ink"
          >
            ‹
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-base font-bold text-story-ink">
              {story.title}
            </p>
            <p className="truncate text-xs text-story-ink/60">{story.genre}</p>
          </div>
          {currentGuestCharacter && (
            <button
              type="button"
              onClick={() => setMemoryPanelOpen(true)}
              aria-label={`${currentGuestCharacter.name}의 기억 보기`}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-memory transition-colors hover:bg-white/10"
            >
              <MemoryMark className="h-5 w-5" />
            </button>
          )}
          {/* Guest 표시는 헤더를 과밀하게 만들지 않도록 portrait+이름(또는 "＋ 초대")
             만 남긴다 — pill 보더/배경 없이 아이콘 버튼 하나 정도의 무게로만. */}
          <button
            type="button"
            onClick={() => setGuestPanelOpen(true)}
            aria-label={currentGuestCharacter ? `게스트: ${currentGuestCharacter.name}` : "캐릭터 초대"}
            className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-story-ink/80 transition-opacity hover:opacity-70"
          >
            {currentGuestCharacter ? (
              <>
                <Avatar character={currentGuestCharacter} size="sm" />
                <span className="max-w-[4.5rem] truncate">{currentGuestCharacter.name}</span>
              </>
            ) : (
              <span>＋ 초대</span>
            )}
          </button>
        </header>

        <div
          ref={scrollContainerRef}
          className="no-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4"
        >
          {!loaded && (
            <p className="pt-10 text-center text-xs text-story-ink/60">이야기를 불러오는 중...</p>
          )}
          {showOpeningScene && (
            <div className="space-y-3 text-[15px] leading-8 text-story-ink">
              {openingParagraphs.map((p, i) => (
                <p key={i} className="whitespace-pre-wrap">
                  {p}
                </p>
              ))}
            </div>
          )}
          {messages.map((m) => (
            <StoryMessageBlock key={m.id} message={m} />
          ))}
          {sending && (
            <ProcessingIndicator variant="story" messages={STORY_INDICATOR_MESSAGES} />
          )}
          <div ref={bottomRef} />
        </div>

        {error && <p className="px-4 pb-1 text-xs text-red-400">{error}</p>}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2 px-4 py-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="무엇을 할까요?"
            disabled={sending}
            className="flex-1 border-b border-story-ink/25 bg-transparent px-1 py-2 text-sm text-story-ink outline-none transition-colors placeholder:text-story-ink/40 focus:border-story-ink"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            aria-label="전송"
            className={`flex h-9 w-9 shrink-0 items-center justify-center text-xl transition-colors ${
              input.trim() && !sending ? "text-story-ink" : "text-story-ink/30"
            }`}
          >
            ↑
          </button>
        </form>
      </div>

      <GuestInvitePanel
        open={guestPanelOpen}
        currentGuest={currentGuestCharacter}
        onClose={() => setGuestPanelOpen(false)}
        onInvite={handleInviteGuest}
        onRemove={handleRemoveGuest}
      />

      {memoryPanelOpen && currentGuestCharacter && (
        <MemoryPanel character={currentGuestCharacter} onClose={() => setMemoryPanelOpen(false)} />
      )}
    </div>
  );
}
