import { NextRequest, NextResponse } from "next/server";
import { getCharacterById } from "@/lib/characters";
import { createManualMemory, getMemoriesForCharacter } from "@/lib/memoryStore";
import { CharacterMemory, MemoryListItem, MemoryListResponse } from "@/types";

// 수동 추가 content의 최대 길이. upsertMemory()의 .slice(0,300)과 같은 숫자를 쓰지만
// 의미가 다르다 — 저 쪽은 Claude가 생성한 content를 조용히 잘라도 되는 안전망이고,
// 여기는 사용자가 직접 쓴 문장이 말없이 잘리면 안 되므로 "거부"에 쓰는 임계값이다.
const MANUAL_MEMORY_MAX_LENGTH = 300;

// GET /api/memories?characterId=xxx -> 해당 캐릭터의 활성 Shared Memory 전체 목록
// (MemoryPanel용, read-only). selectMemoriesForPrompt()(Claude prompt용 top-5)와는
// 별개로, getMemoriesForCharacter()가 반환하는 전체 활성 memory를 그대로 내려준다.
export async function GET(req: NextRequest) {
  const characterId = new URL(req.url).searchParams.get("characterId");
  if (!characterId) {
    return NextResponse.json({ error: "characterId는 필수입니다." }, { status: 400 });
  }

  const character = getCharacterById(characterId);
  if (!character) {
    return NextResponse.json({ error: "존재하지 않는 캐릭터입니다." }, { status: 404 });
  }

  try {
    // 정렬: 중요도 내림차순, 동점이면 최근 갱신(updatedAt) 내림차순. Claude prompt용
    // rankMemories()의 내부 스코어링 공식과는 다른, UI 전용 정렬이라 여기서 직접 한다.
    const memories: MemoryListItem[] = getMemoriesForCharacter(characterId)
      .map((m) => ({
        id: m.id,
        content: m.content,
        importance: m.importance,
        source: { type: m.source.type },
        updatedAt: m.updatedAt,
      }))
      .sort((a, b) =>
        b.importance !== a.importance
          ? b.importance - a.importance
          : b.updatedAt.localeCompare(a.updatedAt)
      );

    const body: MemoryListResponse = { memories };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[api/memories] 조회 실패:", err);
    return NextResponse.json({ error: "기억 목록을 불러오지 못했습니다." }, { status: 500 });
  }
}

// POST /api/memories { characterId, content, importance? } -> 사용자가 MemoryPanel에서
// 직접 기억을 추가한다(Memory Manager). 자동 extraction과 동일한 upsertMemory() 경로를
// createManualMemory()를 통해 재사용하므로 dedup도 동일하게 적용된다.
export async function POST(req: NextRequest) {
  let body: { characterId?: string; content?: string; importance?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문입니다." }, { status: 400 });
  }

  const { characterId } = body;
  if (!characterId) {
    return NextResponse.json({ error: "characterId는 필수입니다." }, { status: 400 });
  }
  const character = getCharacterById(characterId);
  if (!character) {
    return NextResponse.json({ error: "존재하지 않는 캐릭터입니다." }, { status: 404 });
  }

  const trimmedContent = typeof body.content === "string" ? body.content.trim() : "";
  if (!trimmedContent) {
    return NextResponse.json({ error: "기억 내용을 입력해주세요." }, { status: 400 });
  }
  // 자동 extraction(upsertMemory)은 Claude 출력이 300자를 넘으면 조용히 잘라도 되지만,
  // 사용자가 직접 쓴 문장은 서버가 말없이 잘라 저장하면 인지하지 못한 채 내용이
  // 손실되므로 여기서는 truncate 대신 명시적으로 거부한다.
  if (trimmedContent.length > MANUAL_MEMORY_MAX_LENGTH) {
    return NextResponse.json(
      { error: `기억 내용은 ${MANUAL_MEMORY_MAX_LENGTH}자 이내로 입력해주세요.` },
      { status: 400 }
    );
  }

  // importance 미지정 시 기본값 3. 숫자가 아니면(NaN 포함) 400 — 숫자이기만 하면
  // createManualMemory()→upsertMemory()가 1~5로 clamp하므로 여기서는 "숫자인지"만 본다.
  const rawImportance = body.importance;
  let importance = 3;
  if (rawImportance !== undefined) {
    const n = Number(rawImportance);
    if (!Number.isFinite(n)) {
      return NextResponse.json({ error: "importance는 숫자여야 합니다." }, { status: 400 });
    }
    importance = n;
  }

  try {
    const { memory } = createManualMemory({ characterId, content: trimmedContent, importance });
    return NextResponse.json({ memory } satisfies { memory: CharacterMemory }, { status: 201 });
  } catch (err) {
    console.error("[api/memories] 수동 추가 실패:", err);
    return NextResponse.json({ error: "기억을 추가하지 못했습니다." }, { status: 500 });
  }
}
