import { Reminder } from "@/types";
import { getCharacterById } from "./characters";
import { fireReminderMessage } from "./claude";
import { addMessage, getDueReminders, updateReminderStatus } from "./store";

// 로컬 상시구동 프로세스라는 전제를 살려, 별도 큐/워커 없이 인메모리 setInterval
// 폴링만으로 예약 도달을 감지한다. 5초 간격이면 "1분 뒤" 데모에도 충분히 촘촘하다.
const TICK_INTERVAL_MS = 5000;

declare global {
  var __reminderSchedulerStarted: boolean | undefined;
}

// tick이 겹쳐 실행되는 걸 막는 가드. Claude 호출이 5초보다 오래 걸리는 경우에도
// 같은 리마인더를 두 번 스캔하지 않도록 한다.
let isTicking = false;

async function tick() {
  if (isTicking) return;
  isTicking = true;
  try {
    const due = getDueReminders();
    for (const reminder of due) {
      await processReminder(reminder);
    }
  } catch (err) {
    console.error("[scheduler] tick 처리 중 에러:", err);
  } finally {
    isTicking = false;
  }
}

// pending → processing → (fired | failed)
async function processReminder(reminder: Reminder) {
  // 스캔 직후 즉시 processing으로 마킹해 중복 발화를 방지한다.
  // (동시에 삭제 요청이 들어와도 pending이 아니게 되므로 store.deleteReminder가 거부한다.)
  const marked = updateReminderStatus(reminder.id, "processing");
  if (!marked) return;

  const character = getCharacterById(reminder.characterId);
  if (!character) {
    console.error(
      `[scheduler] 알 수 없는 캐릭터(${reminder.characterId}) — 리마인더(${reminder.id})를 failed 처리합니다.`
    );
    updateReminderStatus(reminder.id, "failed");
    return;
  }

  try {
    const text = await fireReminderMessage(character, reminder);
    addMessage({
      characterId: reminder.characterId,
      role: "assistant",
      content: text,
      origin: "reminder",
      reminderId: reminder.id,
    });
    updateReminderStatus(reminder.id, "fired", {
      firedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[scheduler] 리마인더(${reminder.id}) 발화 실패:`, err);
    updateReminderStatus(reminder.id, "failed");
    // 무한 재시도는 하지 않는다 — 실패는 failed로 남기고 다음 tick에서 재시도하지 않는다.
  }
}

function start() {
  // Next.js dev 서버의 Fast Refresh로 이 모듈이 다시 로드되어도 setInterval이
  // 중복으로 걸리지 않도록 globalThis 플래그로 프로세스당 1회만 기동한다.
  if (globalThis.__reminderSchedulerStarted) return;
  globalThis.__reminderSchedulerStarted = true;
  console.log(`[scheduler] 리마인더 스케줄러 시작 (${TICK_INTERVAL_MS}ms 간격)`);
  setInterval(tick, TICK_INTERVAL_MS);
}

start();
