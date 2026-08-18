/**
 * lib/homeStatus.ts의 순수 함수(getCharacterStatus/describeCharacterStatus/
 * pickSpotlightCharacter)를 검증하는 스크립트. tsx로 직접 실행한다: npm run test:home-status
 *
 * 전부 가짜 HomeRow[]와 고정된 now만 주입해서 검증한다 — 실제 메시지/리마인더 데이터
 * (.data/store.json)는 전혀 만들거나 건드리지 않는다. "오랜만" Spotlight 시나리오도 이
 * 스크립트가 1차 검증 수단이다.
 */
import { DEFAULT_CHARACTER_ID, getCharacterById } from "../lib/characters";
import {
  HomeRow,
  getCharacterStatus,
  describeCharacterStatus,
  pickSpotlightCharacter,
} from "../lib/homeStatus";
import { ReminderWithCharacter } from "../types";

let passCount = 0;
let failCount = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passCount++;
    console.log(`  ok  - ${name}`);
  } catch (err) {
    failCount++;
    console.error(`FAIL  - ${name}`);
    console.error(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const NOW = new Date(2026, 7, 14, 21, 30, 0, 0); // 2026-08-14 21:30:00 (KST 가정)

function daysAgo(d: number): string {
  return new Date(NOW.getTime() - d * 24 * 60 * 60_000).toISOString();
}
function minutesAgo(m: number): string {
  return new Date(NOW.getTime() - m * 60_000).toISOString();
}

function makeRow(characterId: string, overrides: Partial<HomeRow> = {}): HomeRow {
  const character = getCharacterById(characterId);
  if (!character) throw new Error(`알 수 없는 characterId: ${characterId}`);
  return {
    character,
    lastMessage: undefined,
    lastUserMessageAt: null,
    nearestPendingReminder: undefined,
    unread: false,
    ...overrides,
  };
}

function makeReminder(characterId: string): ReminderWithCharacter {
  const character = getCharacterById(characterId);
  return {
    id: "r-1",
    characterId,
    createdAt: NOW.toISOString(),
    triggerAt: minutesAgo(-30), // 30분 뒤(미래)
    originalPhrase: "30분 뒤 알려줘",
    content: "물 마시기",
    status: "pending",
    characterName: character?.name ?? characterId,
    characterEmoji: character?.emoji ?? "🔔",
  };
}

console.log("=== lib/homeStatus.ts 단위 테스트 ===\n");

console.log("--- pickSpotlightCharacter ---");
check("(a) 3일 이상 미대화 캐릭터가 있으면 그중 gap이 가장 큰 캐릭터를 long_absence로 선정", () => {
  const rows: HomeRow[] = [
    makeRow("tsundere", {
      lastUserMessageAt: daysAgo(10),
      lastMessage: { id: "m1", characterId: "tsundere", role: "user", content: "hi", createdAt: daysAgo(10), origin: "chat" },
    }),
    makeRow("yandere", {
      lastUserMessageAt: daysAgo(4),
      lastMessage: { id: "m2", characterId: "yandere", role: "user", content: "hi", createdAt: daysAgo(4), origin: "chat" },
    }),
    makeRow("mina", {
      lastUserMessageAt: minutesAgo(10),
      lastMessage: { id: "m3", characterId: "mina", role: "user", content: "hi", createdAt: minutesAgo(10), origin: "chat" },
    }),
  ];
  const pick = pickSpotlightCharacter(rows, NOW, DEFAULT_CHARACTER_ID);
  assertEqual(pick?.reason, "long_absence", "reason");
  assertEqual(pick?.row.character.id, "tsundere", "characterId");
});

check(
  "(a-1) 30일 이상(extremely_long) 미대화 캐릭터도 여전히 long_absence로 선정되어야 함(tier 분리 회귀 방지)",
  () => {
    const rows: HomeRow[] = [
      makeRow("tsundere", {
        // extremely_long(30일 이상) — lib/interactionTime.ts에 tier가 추가되면서
        // lib/homeStatus.ts의 LONG_ABSENCE_TIERS가 이 tier를 놓치면 아래 assertEqual이 깨진다.
        lastUserMessageAt: daysAgo(45),
        lastMessage: {
          id: "m1",
          characterId: "tsundere",
          role: "user",
          content: "hi",
          createdAt: daysAgo(45),
          origin: "chat",
        },
      }),
      makeRow("yandere", {
        // very_long(7~30일) — 45일보다는 gap이 작으므로 long_absence 후보이긴 해도 tsundere에 밀려야 함.
        lastUserMessageAt: daysAgo(10),
        lastMessage: {
          id: "m2",
          characterId: "yandere",
          role: "user",
          content: "hi",
          createdAt: daysAgo(10),
          origin: "chat",
        },
      }),
    ];
    const pick = pickSpotlightCharacter(rows, NOW, DEFAULT_CHARACTER_ID);
    assertEqual(pick?.reason, "long_absence", "reason");
    assertEqual(pick?.row.character.id, "tsundere", "characterId");
  }
);

check("(b) 장기 미대화 캐릭터가 없으면 lastMessage가 가장 최근인 캐릭터를 recent로 선정", () => {
  const rows: HomeRow[] = [
    makeRow("tsundere", {
      lastUserMessageAt: minutesAgo(120),
      lastMessage: { id: "m1", characterId: "tsundere", role: "assistant", content: "hi", createdAt: minutesAgo(120), origin: "chat" },
    }),
    makeRow("yandere", {
      lastUserMessageAt: minutesAgo(5),
      lastMessage: { id: "m2", characterId: "yandere", role: "assistant", content: "hi", createdAt: minutesAgo(5), origin: "chat" },
    }),
  ];
  const pick = pickSpotlightCharacter(rows, NOW, DEFAULT_CHARACTER_ID);
  assertEqual(pick?.reason, "recent", "reason");
  assertEqual(pick?.row.character.id, "yandere", "characterId");
});

check("(c) 대화 이력이 전혀 없으면 fallbackCharacterId를 first_time으로 선정", () => {
  const rows: HomeRow[] = [makeRow("tsundere"), makeRow("yandere"), makeRow("mina")];
  const pick = pickSpotlightCharacter(rows, NOW, DEFAULT_CHARACTER_ID);
  assertEqual(pick?.reason, "first_time", "reason");
  assertEqual(pick?.row.character.id, DEFAULT_CHARACTER_ID, "characterId");
});

console.log("\n--- getCharacterStatus: 우선순위(unread > reminder > elapsed > new) ---");
check("unread=true면 pending reminder/경과 시간이 있어도 kind=unread가 이김", () => {
  const row = makeRow("tsundere", {
    unread: true,
    nearestPendingReminder: makeReminder("tsundere"),
    lastUserMessageAt: daysAgo(5),
  });
  assertEqual(getCharacterStatus(row, NOW).kind, "unread", "kind");
});

check("unread=false, pending reminder 있으면 kind=reminder", () => {
  const row = makeRow("tsundere", {
    nearestPendingReminder: makeReminder("tsundere"),
    lastUserMessageAt: daysAgo(5),
  });
  assertEqual(getCharacterStatus(row, NOW).kind, "reminder", "kind");
});

check("unread/reminder 없고 lastUserMessageAt 있으면 kind=elapsed, tier가 lib/interactionTime과 일치", () => {
  const row = makeRow("tsundere", { lastUserMessageAt: daysAgo(2) });
  const status = getCharacterStatus(row, NOW);
  assertEqual(status.kind, "elapsed", "kind");
  if (status.kind === "elapsed") {
    assertEqual(status.tier, "several_days", "tier");
  }
});

check("대화 이력이 전혀 없으면 kind=new", () => {
  const row = makeRow("tsundere");
  assertEqual(getCharacterStatus(row, NOW).kind, "new", "kind");
});

console.log("\n--- describeCharacterStatus: 문구 매핑 ---");
check("unread → '새 메시지'", () => {
  assertEqual(describeCharacterStatus({ kind: "unread" }, NOW), "새 메시지", "문구");
});
check("new → 빈 문자열(호출부가 tagline으로 대체)", () => {
  assertEqual(describeCharacterStatus({ kind: "new" }, NOW), "", "문구");
});
check("elapsed(several_days) → 'n일 전 대화'", () => {
  const row = makeRow("tsundere", { lastUserMessageAt: daysAgo(2) });
  const status = getCharacterStatus(row, NOW);
  assertEqual(describeCharacterStatus(status, NOW), "2일 전 대화", "문구");
});

console.log(`\n=== 결과: ${passCount}개 통과 / ${failCount}개 실패 ===`);
if (failCount > 0) {
  process.exit(1);
}
