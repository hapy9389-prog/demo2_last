import { NextRequest, NextResponse } from "next/server";
import { getMessagesForCharacter, getMessagesSince } from "@/lib/store";

// GET /api/messages?characterId=xxx   -> 해당 캐릭터의 전체 대화 이력 (스레드 최초 로드/전환용)
// GET /api/messages?since=<ISO>       -> 캐릭터 무관, since 이후 생성된 전체 신규 메시지 (폴링용)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const characterId = searchParams.get("characterId");
  const since = searchParams.get("since");

  if (characterId) {
    return NextResponse.json({ messages: getMessagesForCharacter(characterId) });
  }

  return NextResponse.json({ messages: getMessagesSince(since) });
}
