"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CHARACTERS, DEFAULT_CHARACTER_ID, getCharacterById } from "@/lib/characters";
import { HomeRow, pickSpotlightCharacter } from "@/lib/homeStatus";
import { formatReminderTime } from "@/lib/time";
import { ChatResponse, Message, ReminderCardItem, ReminderWithCharacter } from "@/types";
import { ChatWindow } from "./ChatWindow";
import { HomeScreen } from "./HomeScreen";
import { MemoryPanel } from "./MemoryPanel";
import { NewMessageToast } from "./NewMessageToast";
import { ReminderPanel } from "./ReminderPanel";

const POLL_INTERVAL_MS = 3000;
const DEFAULT_TITLE = "현실 시간과 연결되는 AI 캐릭터 채팅";
const TOAST_DURATION_MS = 3000;

type View = "home" | "chat";

function mergeMessages(prev: Message[], incoming: Message[]): Message[] {
  if (incoming.length === 0) return prev;
  const map = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, m);
  return Array.from(map.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function ChatApp() {
  const [view, setView] = useState<View>("home");
  const [activeCharacterId, setActiveCharacterId] = useState(DEFAULT_CHARACTER_ID);
  const [allMessages, setAllMessages] = useState<Message[]>([]);
  const [reminderCards, setReminderCards] = useState<ReminderCardItem[]>([]);
  const [reminders, setReminders] = useState<ReminderWithCharacter[]>([]);
  const [reminderSheetOpen, setReminderSheetOpen] = useState(false);
  const [memorySheetOpen, setMemorySheetOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // 홈 화면 행에 "아직 안 열어본 새 리마인더 발화가 있다"는 점을 찍기 위한 최소 버전
  // (핵심 UI가 먼저이므로, 상태 하나만 추가하는 선에서 최소 구현)
  const [unreadCharacterIds, setUnreadCharacterIds] = useState<Set<string>>(new Set());
  // 리마인더/proactive 메시지가 도착할 때마다 증가시켜, 현재 보이는 bell 아이콘이
  // 그 순간에만 짧게 강조 애니메이션을 재생하도록 하는 트리거 카운터.
  const [bellPulseTick, setBellPulseTick] = useState(0);

  // 마지막으로 확인한 메시지의 서버 createdAt. 클라이언트 시계가 아니라 서버가 준
  // 값을 기준으로 폴링해야 서버-클라이언트 시계 오차에 영향을 받지 않는다.
  const lastSeenRef = useRef<string>(new Date(0).toISOString());
  const initializedRef = useRef(false);
  const titleTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  // 폰 프레임 전체 진동 효과 대상. 이 div는 앱 전체를 감싸므로 React key로
  // 리마운트시키면 자식들의 state(스크롤 위치, 입력 중 텍스트 등)가 날아간다 —
  // 그래서 classList를 직접 조작해 리마운트 없이 애니메이션을 재시작한다.
  const frameRef = useRef<HTMLDivElement>(null);

  // 리마인더/proactive 메시지가 도착했을 때만 호출한다(일반 채팅 응답에는 호출하지 않음).
  const triggerReminderArrivalEffect = useCallback(() => {
    const el = frameRef.current;
    if (el) {
      el.classList.remove("animate-phone-shake");
      void el.offsetWidth; // 강제 리플로우: 같은 클래스를 다시 추가해도 애니메이션이 재생되게 함
      el.classList.add("animate-phone-shake");
    }
    setBellPulseTick((t) => t + 1);
  }, []);

  const refreshReminders = useCallback(async () => {
    try {
      const res = await fetch("/api/reminders");
      const data = await res.json();
      setReminders(data.reminders ?? []);
    } catch {
      // 폴링성 요청이므로 실패해도 조용히 다음 tick에서 재시도한다.
    }
  }, []);

  const flashTitleFor = useCallback((characterName: string) => {
    document.title = `🔔 ${characterName}에게서 메시지`;
    if (titleTimerRef.current) window.clearTimeout(titleTimerRef.current);
    titleTimerRef.current = window.setTimeout(() => {
      document.title = DEFAULT_TITLE;
    }, TOAST_DURATION_MS);
  }, []);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }, []);

  // 최초 로드: 지금까지의 전체 대화 이력 + 리마인더 목록을 한 번에 가져온다.
  // 이후 캐릭터를 전환해도 재요청 없이 이 배열을 클라이언트에서 필터링만 하면 된다
  // (폴링이 모든 캐릭터의 신규 메시지를 계속 채워주기 때문).
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/messages");
        const data = await res.json();
        const messages: Message[] = data.messages ?? [];
        setAllMessages(messages);
        if (messages.length > 0) {
          lastSeenRef.current = messages[messages.length - 1].createdAt;
        }
      } catch {
        setError("초기 메시지를 불러오지 못했습니다.");
      }
      refreshReminders();
    })();
  }, [refreshReminders]);

  // 폴링: 활성 캐릭터/화면과 무관하게 전체 신규 메시지를 감지한다.
  // 리마인더 발화 메시지는 등록 당시 캐릭터로 고정되어 오므로, 사용자가 다른
  // 캐릭터를 보고 있거나 홈 화면에 있어도 토스트/탭 제목/미확인 점으로 알아챌 수 있다.
  useEffect(() => {
    const interval = window.setInterval(async () => {
      try {
        const res = await fetch(
          `/api/messages?since=${encodeURIComponent(lastSeenRef.current)}`
        );
        const data = await res.json();
        const incoming: Message[] = data.messages ?? [];
        if (incoming.length > 0) {
          lastSeenRef.current = incoming[incoming.length - 1].createdAt;
          setAllMessages((prev) => mergeMessages(prev, incoming));

          const reminderMsg = incoming.find((m) => m.origin === "reminder");
          if (reminderMsg) {
            const character = getCharacterById(reminderMsg.characterId);
            const name = character?.name ?? "캐릭터";
            showToast(`${name}에게 새 메시지가 왔습니다`);
            flashTitleFor(name);
            triggerReminderArrivalEffect();

            const isViewingThisCharacter =
              view === "chat" && activeCharacterId === reminderMsg.characterId;
            if (!isViewingThisCharacter) {
              setUnreadCharacterIds((prev) => new Set(prev).add(reminderMsg.characterId));
            }
          }
          refreshReminders();
        }
      } catch {
        // 폴링 실패는 조용히 무시하고 다음 tick에서 재시도한다.
      }
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [
    activeCharacterId,
    flashTitleFor,
    refreshReminders,
    showToast,
    triggerReminderArrivalEffect,
    view,
  ]);

  useEffect(() => {
    return () => {
      if (titleTimerRef.current) window.clearTimeout(titleTimerRef.current);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const handleSend = useCallback(
    async (text: string) => {
      setSending(true);
      setError(null);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterId: activeCharacterId, message: text }),
        });
        const data: ChatResponse & { error?: string } = await res.json();
        if (!res.ok) throw new Error(data.error || "요청에 실패했습니다.");

        setAllMessages((prev) => mergeMessages(prev, [data.userMessage, data.reply]));
        if (data.reply.createdAt > lastSeenRef.current) {
          lastSeenRef.current = data.reply.createdAt;
        }

        if (data.reminderCreated) {
          // 임시 배너 대신, 채팅 스크롤에 영구히 남는 인라인 시스템 카드로 추가한다.
          setReminderCards((prev) => [
            ...prev,
            {
              id: data.reminderCreated!.id,
              characterId: activeCharacterId,
              content: data.reminderCreated!.content,
              timeLabel: formatReminderTime(new Date(data.reminderCreated!.triggerAt)),
              originalPhrase: data.reminderCreated!.originalPhrase,
              createdAt: data.reply.createdAt,
            },
          ]);
          refreshReminders();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.");
      } finally {
        setSending(false);
      }
    },
    [activeCharacterId, refreshReminders]
  );

  const handleDeleteReminder = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/reminders/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "삭제에 실패했습니다.");
      }
      setReminders((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "리마인더 삭제에 실패했습니다.");
    }
  }, []);

  const handleSelectCharacter = useCallback((id: string) => {
    setActiveCharacterId(id);
    setView("chat");
    setError(null);
    setUnreadCharacterIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const activeCharacter = getCharacterById(activeCharacterId) ?? CHARACTERS[0];
  const activeMessages = allMessages.filter((m) => m.characterId === activeCharacterId);
  const activeReminderCards = reminderCards.filter(
    (c) => c.characterId === activeCharacterId
  );

  const homeRows: HomeRow[] = useMemo(
    () =>
      CHARACTERS.map((character) => {
        const characterMessages = allMessages.filter((m) => m.characterId === character.id);
        // 서버의 getLastUserMessageAt(characterId)(lib/store.ts)와 동일한 정의를
        // 클라이언트에서 재현한다 — role이 "user"인 메시지 중 가장 최근 createdAt.
        const lastUserMessageAt = characterMessages.reduce<string | null>((latest, m) => {
          if (m.role !== "user") return latest;
          return !latest || m.createdAt > latest ? m.createdAt : latest;
        }, null);
        const nearestPendingReminder = reminders
          .filter((r) => r.characterId === character.id && r.status === "pending")
          .sort((a, b) => a.triggerAt.localeCompare(b.triggerAt))[0];
        return {
          character,
          lastMessage: characterMessages[characterMessages.length - 1],
          lastUserMessageAt,
          nearestPendingReminder,
          unread: unreadCharacterIds.has(character.id),
        };
      }),
    [allMessages, reminders, unreadCharacterIds]
  );

  // 홈 화면 Spotlight 대상 선정 — 판단 로직은 lib/homeStatus.ts의 순수 함수에 있고,
  // 여기서는 현재 homeRows를 넘겨 호출만 한다.
  const spotlight = useMemo(
    () => pickSpotlightCharacter(homeRows, new Date(), DEFAULT_CHARACTER_ID),
    [homeRows]
  );

  const pendingReminderCount = reminders.filter((r) => r.status === "pending").length;

  return (
    <div className="min-h-screen w-full bg-white sm:flex sm:items-center sm:justify-center sm:bg-neutral-200 sm:p-6">
      <div
        ref={frameRef}
        className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-white sm:h-[844px] sm:max-h-[92vh] sm:max-w-[420px] sm:rounded-[2.5rem] sm:border-[8px] sm:border-neutral-900 sm:shadow-2xl"
      >
        {view === "home" ? (
          <HomeScreen
            rows={homeRows}
            spotlight={spotlight}
            reminders={reminders}
            pendingReminderCount={pendingReminderCount}
            bellPulseTick={bellPulseTick}
            onSelect={handleSelectCharacter}
            onOpenReminders={() => setReminderSheetOpen(true)}
          />
        ) : (
          <ChatWindow
            character={activeCharacter}
            messages={activeMessages}
            reminderCards={activeReminderCards}
            bellPulseTick={bellPulseTick}
            onSend={handleSend}
            sending={sending}
            error={error}
            onBack={() => setView("home")}
            onOpenReminders={() => setReminderSheetOpen(true)}
            onOpenMemory={() => setMemorySheetOpen(true)}
          />
        )}

        <ReminderPanel
          open={reminderSheetOpen}
          reminders={reminders}
          onClose={() => setReminderSheetOpen(false)}
          onDelete={handleDeleteReminder}
        />

        {memorySheetOpen && (
          <MemoryPanel character={activeCharacter} onClose={() => setMemorySheetOpen(false)} />
        )}

        {toast && <NewMessageToast text={toast} />}
      </div>
    </div>
  );
}
