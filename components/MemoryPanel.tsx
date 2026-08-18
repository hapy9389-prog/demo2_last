"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Character, MemoryListItem } from "@/types";
import { MemoryMark } from "./MemoryMark";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; memories: MemoryListItem[] };

const SOURCE_LABEL: Record<"chat" | "story" | "manual", string> = {
  chat: "Chat",
  story: "Story",
  manual: "직접 추가",
};

const MANUAL_MEMORY_MAX_LENGTH = 300;

/**
 * 클릭 가능한 dot 5개("이 기억이 얼마나 선명한지"). 기존 항목의 importance 변경(PATCH)과
 * 추가 폼의 importance 선택(로컬 state) 양쪽에서 재사용한다. n번째 dot 클릭 -> onRate(n).
 * 이전 StarPicker와 동일한 button 기반 상호작용(네이티브 키보드 포커스/Enter·Space 활성화)을
 * 그대로 유지하고, 각 단계에 aria-label과 focus-visible 링만 추가했다.
 */
function MemoryVividnessDots({
  value,
  onRate,
  disabled,
}: {
  value: number;
  onRate: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      role="group"
      aria-label={`이 기억의 선명도, 5단계 중 ${value}단계`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          aria-label={`선명도 ${n}단계로 표시`}
          aria-pressed={n <= value}
          onClick={() => onRate(n)}
          className="rounded-full p-0.5 leading-none outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-memory focus-visible:ring-offset-1 focus-visible:ring-offset-paper disabled:opacity-40"
        >
          <span
            aria-hidden
            className={`block h-2 w-2 rounded-full transition-colors ${
              n <= value ? "bg-memory" : "border border-ink-soft/30"
            }`}
          />
        </button>
      ))}
    </span>
  );
}

/**
 * 항상 날짜만 보여준다("8월 16일"), 시:분은 포함하지 않는다. lib/time.ts의
 * formatReminderTime()과 의도적으로 분리된 별도 구현 — lib/time.ts는 import 시
 * side effect가 있는 모듈이라 단순 날짜 표시를 위해 여기서 끌어오지 않는다.
 */
function formatMemoryDate(date: Date): string {
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

/**
 * Shared Memory 목록 바텀시트(읽기 전용). 부모(폰 프레임 body)가 `relative`여야 이 안에서
 * `absolute inset-0`이 브라우저 전체가 아니라 폰 화면 안에서만 덮인다.
 *
 * ReminderPanel과 달리 이 컴포넌트는 `open` prop으로 스스로를 숨기지 않는다 — 부모
 * (ChatApp)가 열려 있을 때만 조건부로 마운트한다. 그래서 "닫힘"은 곧 unmount이고,
 * unmount는 state를 통째로 버리고 진행 중이던 fetch의 응답도 자연히 무시하게 만든다
 * (같은 인스턴스가 남아있는 채로 setState를 동기 호출해 "idle로 리셋"하는 방식은
 * react-hooks/set-state-in-effect 린트 규칙과 충돌해 피했다). 다음에 다시 열리면
 * 완전히 새 인스턴스가 마운트되므로 이전 캐릭터의 데이터/로딩 잔상이 보일 수 없다.
 * 열릴 때(=마운트될 때)마다 `characterId` 기준으로 GET /api/memories를 새로 호출한다 —
 * ChatApp의 3초 폴링에는 포함되지 않는다(Memory는 실시간 알림 데이터가 아님).
 */
export function MemoryPanel({
  character,
  onClose,
}: {
  character: Character;
  onClose: () => void;
}) {
  // 초기 상태 자체가 "loading"이므로 마운트 시점에 별도로 setState할 필요가 없다
  // (react-hooks/set-state-in-effect가 effect 내부의 동기 setState 호출을 금지하므로,
  // effect 본문에서는 fetch를 "시작"만 하고 결과 반영은 항상 .then/.catch 콜백 안에서만
  // 한다 — 이 콜백들은 진짜 비동기이므로 규칙 대상이 아니다).
  const [state, setState] = useState<LoadState>({ status: "loading" });
  // 현재 유효한 요청만 state에 반영하기 위한 토큰. characterId가 바뀌면(이론상으로만
  // 가능 - 패널이 열려 있는 동안은 배경 클릭이 전체를 덮어 캐릭터 전환이 불가능하지만,
  // 방어적으로 대비한다) 토큰을 새로 발급해 이전 요청의 응답을 무시한다.
  const requestTokenRef = useRef(0);

  // Memory Manager(CRUD) 상태. 전부 이 컴포넌트 로컬 state로만 관리한다 — 별도 상태
  // 관리 라이브러리나 optimistic UI 없이, mutation은 항상 "성공 -> runFetch()로 재조회"
  // 패턴을 쓴다(패널 규모가 작아 optimistic UI의 복잡도가 이득보다 크다는 판단).
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addContent, setAddContent] = useState("");
  const [addImportance, setAddImportance] = useState(3);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // 헤더/empty state의 box-less 캐릭터 초상용. ChatHeader.tsx/CharacterCard.tsx와 동일한
  // 이유로 Avatar(원형 크롭 전제)를 쓰지 않고 이 컴포넌트 전용 로컬 폴백을 둔다.
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(character.image) && !imageFailed;

  const runFetch = useCallback(() => {
    const myToken = ++requestTokenRef.current;
    fetch(`/api/memories?characterId=${encodeURIComponent(character.id)}`)
      .then(async (res) => {
        const data = await res.json();
        if (requestTokenRef.current !== myToken) return; // stale 응답 무시
        if (!res.ok) {
          setState({ status: "error", message: data.error || "기억을 불러오지 못했습니다." });
          return;
        }
        setState({ status: "success", memories: data.memories ?? [] });
      })
      .catch(() => {
        if (requestTokenRef.current !== myToken) return;
        setState({ status: "error", message: "기억을 불러오지 못했습니다." });
      });
  }, [character.id]);

  useEffect(() => {
    runFetch();
    // unmount(=패널 닫힘) 시 진행 중이던 요청을 무효화한다 — 늦게 도착하는 응답이
    // (이미 사라진) 이전 인스턴스의 state를 갱신하는 일은 React가 알아서 막아주지만,
    // 명시적으로 토큰을 무효화해 의도를 분명히 한다.
    const tokenRef = requestTokenRef;
    return () => {
      tokenRef.current++;
    };
  }, [character.id, runFetch]);

  // 재시도 버튼: effect 밖(클릭 이벤트 핸들러)에서 호출되므로 동기 setState가 허용된다.
  const handleRetry = useCallback(() => {
    setState({ status: "loading" });
    runFetch();
  }, [runFetch]);

  // 헤더 새로고침 버튼: 재시도와 달리 로딩 화면으로 갈아엎지 않고 목록을 그대로 둔 채
  // 조용히 다시 불러온다 — 자동 Story Memory 생성처럼 패널을 열어둔 사이 서버 상태가
  // 바뀌었을 수 있는 경우를 사용자가 수동으로 확인하기 위한 용도(별도 polling 없음).
  const handleRefresh = useCallback(() => {
    setActionError(null);
    runFetch();
  }, [runFetch]);

  const handleRate = useCallback(
    async (memoryId: string, importance: number) => {
      setActionError(null);
      setMutatingId(memoryId);
      try {
        const res = await fetch(`/api/memories/${memoryId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterId: character.id, importance }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "중요도를 변경하지 못했습니다.");
        runFetch();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "중요도를 변경하지 못했습니다.");
      } finally {
        setMutatingId(null);
      }
    },
    [character.id, runFetch]
  );

  const handleDeleteClick = useCallback((memoryId: string) => {
    setActionError(null);
    setConfirmingDeleteId(memoryId);
  }, []);

  const handleDeleteCancel = useCallback(() => {
    setConfirmingDeleteId(null);
  }, []);

  const handleDeleteConfirm = useCallback(
    async (memoryId: string) => {
      setActionError(null);
      setMutatingId(memoryId);
      try {
        const res = await fetch(`/api/memories/${memoryId}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterId: character.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "기억을 삭제하지 못했습니다.");
        setConfirmingDeleteId(null);
        runFetch();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "기억을 삭제하지 못했습니다.");
      } finally {
        setMutatingId(null);
      }
    },
    [character.id, runFetch]
  );

  const handleAddSubmit = useCallback(async () => {
    const trimmed = addContent.trim();
    if (!trimmed) {
      setAddError("기억 내용을 입력해주세요.");
      return;
    }
    setAddError(null);
    setAddSubmitting(true);
    try {
      const res = await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: character.id, content: trimmed, importance: addImportance }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "기억을 추가하지 못했습니다.");
      setAddContent("");
      setAddImportance(3);
      setShowAddForm(false);
      runFetch();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "기억을 추가하지 못했습니다.");
    } finally {
      setAddSubmitting(false);
    }
  }, [addContent, addImportance, character.id, runFetch]);

  const handleAddCancel = useCallback(() => {
    setShowAddForm(false);
    setAddContent("");
    setAddImportance(3);
    setAddError(null);
  }, []);

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end">
      <button
        aria-label="닫기"
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-black/30"
      />
      <div className="relative z-10 flex max-h-[70%] animate-sheet-up flex-col rounded-t-3xl bg-paper shadow-2xl">
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-paper-sunken" />
        <div className="relative overflow-hidden border-b border-memory/15 bg-paper px-4 py-3">
          {/* 은은한 mood 장식 2개만: 초상 뒤 옅은 glow, 모서리의 아주 옅은 워터마크.
             둘 다 position 없는(static) 콘텐츠보다 항상 아래에 그려지므로 z-index가
             필요 없고, 캐릭터 초상을 가리지 않는다 — opacity를 낮게, 크기를 초상보다
             작게 유지해 시각적 우선순위가 초상을 넘지 않게 한다. */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full bg-memory/20 blur-lg"
          />
          <MemoryMark
            className="pointer-events-none absolute -right-2 -top-3 h-16 w-16 text-memory opacity-[0.14]"
          />

          <div className="flex items-center gap-3">
            {showImage ? (
              // ChatHeader.tsx와 동일한 box-less 캐릭터 초상 — 원형 크롭 없이 원본 비율.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={character.image}
                alt=""
                aria-hidden
                className="h-10 w-auto shrink-0 drop-shadow-[0_3px_6px_rgba(43,36,32,0.18)]"
                onError={() => setImageFailed(true)}
              />
            ) : (
              <span className="shrink-0 text-2xl leading-none" aria-hidden>
                {character.emoji}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-1.5 truncate font-display text-sm font-bold text-ink">
                <MemoryMark className="h-3.5 w-3.5 shrink-0 text-memory" />
                {character.name}의 기억
              </h2>
              <p className="mt-0.5 truncate text-xs text-memory">
                함께 나눈 이야기 중 {character.name}가 기억해둔 것들이에요.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <button
                onClick={handleRefresh}
                aria-label="새로고침"
                title="새로고침"
                className="text-ink-soft hover:text-ink"
              >
                ↻
              </button>
              <button
                onClick={onClose}
                aria-label="닫기"
                className="shrink-0 text-ink-soft transition-colors hover:text-ink"
              >
                ✕
              </button>
            </div>
          </div>
        </div>

        <div className="no-scrollbar flex-1 space-y-2 overflow-y-auto p-3">
          {state.status === "loading" && (
            <p className="mt-6 text-center text-xs text-ink-soft">기억을 불러오는 중...</p>
          )}

          {state.status === "error" && (
            <div className="mt-6 text-center text-xs">
              <p className="text-red-500">{state.message}</p>
              <button
                onClick={handleRetry}
                className="mt-2 font-medium text-memory hover:opacity-70"
              >
                다시 시도
              </button>
            </div>
          )}

          {state.status === "success" && (
            <>
              {actionError && <p className="py-1 text-xs text-red-500">{actionError}</p>}

              {state.memories.length === 0 && !showAddForm && (
                <div className="mt-6 flex flex-col items-center gap-3 text-center">
                  {showImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={character.image}
                      alt=""
                      aria-hidden
                      className="h-24 w-auto opacity-80 drop-shadow-[0_8px_10px_rgba(43,36,32,0.15)]"
                      onError={() => setImageFailed(true)}
                    />
                  ) : (
                    <span className="text-5xl opacity-80" aria-hidden>
                      {character.emoji}
                    </span>
                  )}
                  <p className="text-xs leading-relaxed text-ink-soft">
                    아직 {character.name}가 특별히 기억해둔 게 없어요.
                    <br />
                    대화를 나누거나 함께 Story를 경험하면
                    <br />
                    중요한 기억이 이곳에 쌓입니다.
                  </p>
                </div>
              )}

              {state.memories.length > 0 && (
                <div className="divide-y divide-paper-sunken">
                  {state.memories.map((m) => {
                    const isMutating = mutatingId === m.id;
                    const isConfirming = confirmingDeleteId === m.id;
                    return (
                      <div key={m.id} className="animate-message-in py-3 text-xs">
                        <p className="leading-relaxed text-ink">{m.content}</p>

                        {isConfirming ? (
                          <div className="mt-1.5 flex items-center justify-between text-ink-soft">
                            <span>정말 삭제할까요?</span>
                            <span className="flex gap-2">
                              <button
                                onClick={handleDeleteCancel}
                                disabled={isMutating}
                                className="font-medium text-ink-soft hover:text-ink disabled:opacity-40"
                              >
                                취소
                              </button>
                              <button
                                onClick={() => handleDeleteConfirm(m.id)}
                                disabled={isMutating}
                                className="font-medium text-red-500 hover:text-red-700 disabled:opacity-40"
                              >
                                {isMutating ? "삭제 중..." : "삭제"}
                              </button>
                            </span>
                          </div>
                        ) : (
                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                              <span className="shrink-0 rounded-[3px] bg-paper-sunken px-1 py-0.5 text-[10px] font-medium text-ink-soft">
                                {SOURCE_LABEL[m.source.type]}
                              </span>
                              <span className="shrink-0 text-[10px] text-ink-soft/70">
                                {formatMemoryDate(new Date(m.updatedAt))} 갱신
                              </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-3">
                              <MemoryVividnessDots
                                value={m.importance}
                                disabled={isMutating}
                                onRate={(n) => handleRate(m.id, n)}
                              />
                              <button
                                onClick={() => handleDeleteClick(m.id)}
                                disabled={isMutating}
                                className="text-[11px] font-medium text-ink-soft hover:text-red-500 disabled:opacity-40"
                              >
                                삭제
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {state.memories.length > 0 && (
                <p className="pt-1 text-center text-[11px] text-ink-soft">
                  총 {state.memories.length}개의 기억
                </p>
              )}

              {showAddForm ? (
                // 입력 폼이 펼쳐진 상태에서만 옅은 memory surface를 준다 — 실제로 뭔가를
                // 적어 넣는 활성 입력 영역이라 최소한의 경계가 필요하기 때문이다. 닫힌
                // 상태(아래 else 분기)는 또 하나의 박스 카드처럼 보이지 않도록 순수 텍스트
                // 버튼으로만 둔다.
                <div className="animate-message-in rounded-xl border border-memory/20 bg-memory/5 p-3 text-xs">
                  <textarea
                    value={addContent}
                    onChange={(e) => setAddContent(e.target.value)}
                    maxLength={MANUAL_MEMORY_MAX_LENGTH}
                    rows={3}
                    placeholder="기억할 내용을 적어주세요"
                    disabled={addSubmitting}
                    className="w-full resize-none rounded-lg border border-paper-sunken bg-paper px-2.5 py-2 text-xs text-ink outline-none focus:border-memory disabled:opacity-60"
                  />
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-ink-soft">
                      선명도{" "}
                      <MemoryVividnessDots
                        value={addImportance}
                        disabled={addSubmitting}
                        onRate={setAddImportance}
                      />
                    </span>
                    <span className="text-[11px] text-ink-soft">
                      {addContent.length}/{MANUAL_MEMORY_MAX_LENGTH}
                    </span>
                  </div>
                  {addError && <p className="mt-1.5 text-red-500">{addError}</p>}
                  <div className="mt-2 flex justify-end gap-3">
                    <button
                      onClick={handleAddCancel}
                      disabled={addSubmitting}
                      className="font-medium text-ink-soft hover:text-ink disabled:opacity-40"
                    >
                      취소
                    </button>
                    <button
                      onClick={handleAddSubmit}
                      disabled={addSubmitting}
                      className="font-medium text-memory hover:opacity-70 disabled:opacity-40"
                    >
                      {addSubmitting ? "추가 중..." : "추가"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="w-full py-2 text-center text-xs font-medium text-memory transition-opacity hover:opacity-70"
                >
                  + 직접 기억 남기기
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
