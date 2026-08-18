import { NextResponse } from "next/server";
import { getCharacterById } from "@/lib/characters";
import { listReminders } from "@/lib/store";

// GET /api/reminders -> 전체 캐릭터의 리마인더 목록 (ReminderPanel용)
export async function GET() {
  const reminders = listReminders().map((r) => {
    const character = getCharacterById(r.characterId);
    return {
      ...r,
      characterName: character?.name ?? r.characterId,
      characterEmoji: character?.emoji ?? "🔔",
    };
  });
  return NextResponse.json({ reminders });
}
