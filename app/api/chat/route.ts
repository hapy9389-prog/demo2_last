import { NextRequest, NextResponse } from "next/server";
import { getCharacterById } from "@/lib/characters";
import { chatWithCharacter } from "@/lib/claude";
import {
  buildCrossCharacterAwarenessBlock,
  getCrossCharacterCandidates,
  pickCrossCharacterCandidate,
  shouldUseCrossCharacterAwareness,
} from "@/lib/crossCharacterAwareness";
import { getDevCrossAwarenessOverride } from "@/lib/devCrossAwarenessOverride";
import { getDevInteractionOverride } from "@/lib/devInteractionOverride";
import { buildTimeAwarenessForCharacter } from "@/lib/interactionTime";
import { CHAT_MEMORY_EXTRACTION_INTERVAL, extractMemoryFromChat } from "@/lib/memoryClaude";
import { buildSharedMemoryBlock } from "@/lib/memoryPrompt";
import { markMemoriesUsed, selectMemoriesForPrompt, upsertMemory } from "@/lib/memoryStore";
import { isExplicitReminderRequest, isSourceTextFromCurrentMessage } from "@/lib/reminderGuard";
import {
  addMessage,
  addReminder,
  findDuplicateReminder,
  getLastUserMessageAt,
  getMessagesForCharacter,
  getRecentHistory,
} from "@/lib/store";
import { resolveTriggerTime, validateTriggerTime } from "@/lib/time";
import { ChatResponse } from "@/types";

const isDev = process.env.NODE_ENV !== "production";

// Claude 호출 지점 #1: 일반 채팅 응답 생성 + (있다면) 리마인더 intent 추출을
// 한 번의 호출로 처리한다. 시간 계산은 여기서 하지 않고 서버의 결정적 함수에 위임한다.
export async function POST(req: NextRequest) {
  let body: { characterId?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문입니다." }, { status: 400 });
  }

  const { characterId, message } = body;
  if (!characterId || !message || !message.trim()) {
    return NextResponse.json(
      { error: "characterId와 message는 필수입니다." },
      { status: 400 }
    );
  }

  const character = getCharacterById(characterId);
  if (!character) {
    return NextResponse.json({ error: "존재하지 않는 캐릭터입니다." }, { status: 404 });
  }

  const trimmedMessage = message.trim();

  // ⚠️ 반드시 addMessage(user) 이전에 실행해야 한다 — 이래야 "갱신 전" lastInteractionAt
  // 기준으로 경과 시간을 계산할 수 있다(순서를 바꾸면 gap이 항상 0이 되는 버그가 생긴다).
  // getDevInteractionOverride는 개발 환경에서만 값을 반환하고, production에서는 항상
  // null이라 실제 getLastUserMessageAt() 결과가 그대로 쓰인다 — 실제 메시지 데이터는
  // 이 시간 인식 기능 어디에서도 건드리지 않는다. 리마인더 관련 로직과는 무관하다.
  const lastInteractionAtISO =
    getDevInteractionOverride(characterId) ?? getLastUserMessageAt(characterId);
  const timeAwarenessContext = buildTimeAwarenessForCharacter(lastInteractionAtISO);
  if (isDev) {
    console.log(
      "[time-awareness][debug] lastInteractionAtISO:",
      lastInteractionAtISO,
      "hasContext:",
      timeAwarenessContext !== null
    );
  }

  const history = getRecentHistory(characterId);

  // Shared Memory 조회(부작용 없음) — Reminder/Time Awareness와 완전히 무관한 별도 컨텍스트.
  // 이 캐릭터에게 memory가 하나도 없으면 selectedMemories는 빈 배열, sharedMemoryContext는
  // null이 되어 system prompt가 오늘과 완전히 동일해진다(기존 동작 그대로 유지).
  const memoryNow = new Date();
  const selectedMemories = selectMemoriesForPrompt(characterId, memoryNow);
  const sharedMemoryContext = buildSharedMemoryBlock(selectedMemories);

  // Cross-Character Awareness 선택(부작용 없음) — Reminder/Time Awareness/Shared Memory
  // prompt usage(markMemoriesUsed)와 완전히 무관한 별도의 일회성 context다. 다른
  // Character의 Memory를 이 Character의 Shared Memory로 복사하지 않는다 — 이번 턴
  // system prompt에만 임시로 주입한다. 당첨되지 않거나(확률/후보 없음) dev override가
  // 없으면 crossCharacterAwarenessContext는 null이 되어 system prompt가 오늘과 완전히
  // 동일해진다(기존 동작 그대로 유지).
  const devCrossOverride = getDevCrossAwarenessOverride(characterId);
  const crossAwarenessChance = character.crossCharacterAwarenessChance ?? 0;
  const crossAwarenessHit =
    devCrossOverride?.forceOn === true || shouldUseCrossCharacterAwareness(crossAwarenessChance);

  let crossCharacterAwarenessContext: string | null = null;
  let crossAwarenessDebugSelection: { sourceCharacterId: string; memoryId: string } | null = null;
  if (crossAwarenessHit) {
    let candidates = getCrossCharacterCandidates(characterId);
    if (devCrossOverride?.sourceCharacterId) {
      candidates = candidates.filter(
        (m) => m.characterId === devCrossOverride.sourceCharacterId
      );
    }
    const picked = pickCrossCharacterCandidate(candidates);
    if (picked) {
      const sourceCharacter = getCharacterById(picked.characterId);
      crossCharacterAwarenessContext = buildCrossCharacterAwarenessBlock(
        sourceCharacter?.name ?? "다른 사람",
        picked.content
      );
      crossAwarenessDebugSelection = { sourceCharacterId: picked.characterId, memoryId: picked.id };
    }
  }
  if (isDev) {
    // JSON.stringify로 명시 직렬화한다 — 객체를 console.log의 trailing arg로 그대로
    // 넘기면 Next dev의 구조화 로거가 "{}"로 collapse하는 경우가 있어(관찰됨), 문자열로
    // 확실히 남긴다.
    console.log(
      "[cross-awareness][debug] chance:",
      crossAwarenessChance,
      "hit:",
      crossAwarenessHit,
      "forced:",
      devCrossOverride?.forceOn === true,
      "selected:",
      JSON.stringify(crossAwarenessDebugSelection)
    );
  }

  const userMsg = addMessage({
    characterId,
    role: "user",
    content: trimmedMessage,
    origin: "chat",
  });

  let chatResult;
  try {
    chatResult = await chatWithCharacter(
      character,
      history,
      trimmedMessage,
      timeAwarenessContext,
      sharedMemoryContext,
      crossCharacterAwarenessContext
    );
  } catch (err) {
    console.error("[api/chat] Claude 호출 실패:", err);
    return NextResponse.json(
      { error: "캐릭터 응답 생성에 실패했습니다. API 키/네트워크를 확인해주세요." },
      { status: 502 }
    );
  }

  // Claude 호출이 실제로 성공했을 때만 "사용됨"을 기록한다(selectMemoriesForPrompt 자체는
  // 조회만 하고 mutation하지 않는다 — 위 §2 설계 참고). 실패해도 채팅 응답에는 영향 없음.
  if (selectedMemories.length > 0) {
    try {
      markMemoriesUsed(
        selectedMemories.map((m) => m.id),
        memoryNow
      );
    } catch (err) {
      console.error("[api/chat] memory markMemoriesUsed 실패(무시):", err);
    }
  }

  const assistantMsg = addMessage({
    characterId,
    role: "assistant",
    content: chatResult.replyText,
    origin: "chat",
  });

  const responseBody: ChatResponse = { userMessage: userMsg, reply: assistantMsg };

  if (chatResult.extraction) {
    const extraction = chatResult.extraction;

    // 1단계: 현재 사용자 메시지 자체에 시간 표현 + 알림 요청 표현이 모두 있는지.
    // Claude가 conversation history 속 과거 요청을 잘못 재해석해 tool을 호출했더라도,
    // 이 서버 측 hard guard를 통과하지 못하면 리마인더는 생성되지 않는다(prompt 방어와
    // 별개의 결정적 2차 방어선).
    const explicitRequest = isExplicitReminderRequest(trimmedMessage);
    // 2단계: Claude가 근거로 댄 source_text가 실제로 현재 메시지 안에 있는지. 1단계를
    // 우회하는 경우까지 잡아내는 독립적인 세 번째 방어선(1: prompt, 2: 정규식 guard,
    // 3: source_text 대조).
    const sourceTextValid =
      explicitRequest && isSourceTextFromCurrentMessage(extraction.source_text, trimmedMessage);

    if (isDev) {
      // 개발 환경에서만 원인 추적용 로그를 남긴다. API 키 등 민감정보는 절대 포함하지 않는다.
      console.log("[reminder][debug] currentUserMessage:", trimmedMessage);
      console.log(
        "[reminder][debug] toolCallDetected: true, kind:",
        extraction.kind,
        "explicitRequestGuard:",
        explicitRequest,
        "sourceTextGuard:",
        sourceTextValid
      );
    }

    if (!explicitRequest) {
      console.warn(
        "[reminder] blocked tool call: current message is not an explicit reminder request",
        extraction.original_phrase
      );
    } else if (!sourceTextValid) {
      console.warn(
        "[reminder] blocked tool call: source_text not found in current message",
        extraction.source_text
      );
    } else {
      // 3단계: triggerAt 계산. 4단계: triggerAt 검증.
      const now = new Date();
      const triggerAt = resolveTriggerTime(extraction, now);
      const validation = validateTriggerTime(triggerAt, now);

      if (validation.ok) {
        // 5단계: dedup 검사(기존 로직 유지).
        const duplicate = findDuplicateReminder(characterId, extraction.content, triggerAt, now);

        if (duplicate) {
          // Claude가 과거 대화의 리마인더 요청을 잘못 재해석해 재등록하려는 경우에 대한
          // 서버 측 마지막 방어선. 조용히 무시한다 — 캐릭터의 채팅 답변 자체는 이미
          // 자연스럽게 나갔으므로 사용자 경험이 끊기지는 않는다.
          console.warn(
            "[api/chat] 중복 리마인더로 판단해 생성 거부:",
            duplicate.id,
            extraction
          );
        } else {
          // 6단계: 생성.
          const reminder = addReminder({
            characterId,
            triggerAt: triggerAt.toISOString(),
            originalPhrase: extraction.original_phrase,
            content: extraction.content,
            sourceMessageId: userMsg.id,
          });
          if (isDev) {
            console.log("[reminder][debug] created reminder id:", reminder.id);
          }
          responseBody.reminderCreated = {
            id: reminder.id,
            content: reminder.content,
            triggerAt: reminder.triggerAt,
            originalPhrase: reminder.originalPhrase,
          };
        }
      } else {
        // 검증 실패(과거 시각/1년 초과/형식 이상)면 조용히 리마인더를 만들지 않는다.
        // 캐릭터의 채팅 답변 자체는 이미 자연스럽게 나갔으므로 사용자 경험이 완전히 끊기진 않는다.
        console.warn("[api/chat] 리마인더 시간 검증 실패:", validation.reason, extraction);
      }
    }
  } else if (isDev) {
    console.log(
      "[reminder][debug] currentUserMessage:",
      trimmedMessage,
      "toolCallDetected: false"
    );
  }

  // Shared Memory 추출(쓰기 경로) — 반드시 위 Reminder 파이프라인이 전부 끝나고
  // responseBody가 확정된 뒤에만 실행한다. 별도 Claude 호출(lib/memoryClaude.ts)이며
  // schedule_reminder의 호출·응답 루프와 물리적으로 분리돼 있다. 실패해도 이미 완성된
  // 채팅 응답에는 영향이 없도록 try/catch로 감싼다.
  try {
    const userMessageCount = getMessagesForCharacter(characterId).filter(
      (m) => m.role === "user"
    ).length;
    if (
      userMessageCount > 0 &&
      userMessageCount % CHAT_MEMORY_EXTRACTION_INTERVAL === 0
    ) {
      const recentForExtraction = getRecentHistory(characterId, 8);
      const extracted = await extractMemoryFromChat(character, recentForExtraction);
      for (const item of extracted) {
        upsertMemory({
          characterId,
          content: item.content,
          importance: item.importance,
          source: { type: "chat", refId: userMsg.id },
        });
      }
      if (isDev) {
        console.log("[memory][debug] chat extraction ran, extracted:", extracted.length);
      }
    }
  } catch (err) {
    console.error("[api/chat] memory extraction 실패(무시):", err);
  }

  return NextResponse.json(responseBody);
}
