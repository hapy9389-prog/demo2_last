import { NextRequest, NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/settingsStore";
import { UserSettingsResponse } from "@/types";

// GET /api/settings -> 사용자 전역 설정 조회(SettingsPanel 초기 로드용).
export async function GET() {
  const body: UserSettingsResponse = { settings: getSettings() };
  return NextResponse.json(body);
}

// PATCH /api/settings { crossCharacterInteractionEnabled?: boolean } -> 부분 갱신.
// 단일 사용자 데모라 ownership 검증은 필요 없다(app/api/memories/[memoryId]/route.ts와
// 달리 characterId를 body에 요구하지 않는다).
export async function PATCH(req: NextRequest) {
  let body: { crossCharacterInteractionEnabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문입니다." }, { status: 400 });
  }

  const partial: Partial<{ crossCharacterInteractionEnabled: boolean }> = {};
  if (body.crossCharacterInteractionEnabled !== undefined) {
    if (typeof body.crossCharacterInteractionEnabled !== "boolean") {
      return NextResponse.json(
        { error: "crossCharacterInteractionEnabled는 boolean이어야 합니다." },
        { status: 400 }
      );
    }
    partial.crossCharacterInteractionEnabled = body.crossCharacterInteractionEnabled;
  }

  const settings = updateSettings(partial);
  const responseBody: UserSettingsResponse = { settings };
  return NextResponse.json(responseBody);
}
