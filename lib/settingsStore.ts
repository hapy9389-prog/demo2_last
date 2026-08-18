import fs from "node:fs";
import path from "node:path";
import { UserSettings } from "@/types";

// 사용자가 UI에서 직접 켜고 끄는 전역 설정의 persistence. lib/memoryStore.ts와 동일한
// 관용구(도메인별 독립 .data/*.json 파일 + globalThis 싱글턴 캐시 + persist())를
// 따른다. lib/store.ts(messages/reminders 전용으로 좁게 설계된 StoreShape)는 확장하지
// 않는다 — 도메인별로 파일을 분리하는 이 프로젝트의 기존 원칙을 그대로 따른 것이다.
//
// 단일 사용자 데모이므로 userId 없이 설정 1벌만 저장한다(CharacterMemory 등 다른
// 도메인 타입에 이미 있는 "userId는 아직 없다" 전제와 동일).

const DATA_DIR = path.join(process.cwd(), ".data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings-store.json");

const DEFAULT_SETTINGS: UserSettings = {
  crossCharacterInteractionEnabled: true,
};

declare global {
  var __appSettingsStore: UserSettings | undefined;
}

function loadFromDisk(): UserSettings {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    // DEFAULT_SETTINGS와 병합한다 — 파일에 없는 필드(향후 새 설정 추가 시)나 값이
    // boolean이 아닌 손상된 필드는 기본값으로 안전하게 폴백한다.
    return {
      crossCharacterInteractionEnabled:
        typeof parsed.crossCharacterInteractionEnabled === "boolean"
          ? parsed.crossCharacterInteractionEnabled
          : DEFAULT_SETTINGS.crossCharacterInteractionEnabled,
    };
  } catch {
    // 파일이 없거나(첫 실행) 손상된 경우 기본 설정으로 시작한다.
    return { ...DEFAULT_SETTINGS };
  }
}

function saveToDisk(settings: UserSettings) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
  } catch (err) {
    console.error("[settingsStore] JSON 저장 실패:", err);
  }
}

function getStore(): UserSettings {
  if (!globalThis.__appSettingsStore) {
    globalThis.__appSettingsStore = loadFromDisk();
  }
  return globalThis.__appSettingsStore;
}

/** 현재 사용자 설정 전체를 반환한다. */
export function getSettings(): UserSettings {
  return { ...getStore() };
}

/** partial을 현재 설정에 병합해 저장하고, 갱신된 설정 전체를 반환한다. */
export function updateSettings(partial: Partial<UserSettings>): UserSettings {
  const current = getStore();
  const next: UserSettings = { ...current, ...partial };
  globalThis.__appSettingsStore = next;
  saveToDisk(next);
  return { ...next };
}
