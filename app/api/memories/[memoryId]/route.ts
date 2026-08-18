import { NextResponse } from "next/server";
import { getMemoryById, softDeleteMemory, updateMemoryImportance } from "@/lib/memoryStore";

// PATCH /api/memories/:memoryId { characterId, importance } -> importance만 변경.
// DELETE /api/memories/:memoryId { characterId } -> soft delete.
//
// 둘 다 body에 characterId를 함께 받아 ownership을 검증한다(memoryId만으로는 다른
// characterId의 요청도 같은 memory를 건드릴 수 있으므로). memory가 없거나 characterId가
// 일치하지 않으면 둘 다 동일하게 404로 응답해, 다른 캐릭터에 그 memoryId가 존재하는지
// 여부를 노출하지 않는다.

function ownershipError(memoryId: string, characterId: unknown) {
  const memory = getMemoryById(memoryId);
  if (!memory || memory.characterId !== characterId) {
    return NextResponse.json({ error: "기억을 찾을 수 없습니다." }, { status: 404 });
  }
  return null;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ memoryId: string }> }
) {
  const { memoryId } = await params;

  let body: { characterId?: string; importance?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문입니다." }, { status: 400 });
  }

  const ownershipErr = ownershipError(memoryId, body.characterId);
  if (ownershipErr) return ownershipErr;

  const n = Number(body.importance);
  if (!Number.isFinite(n)) {
    return NextResponse.json({ error: "importance는 숫자여야 합니다." }, { status: 400 });
  }

  const result = updateMemoryImportance(memoryId, n);
  if (!result.ok) {
    // ownershipError를 이미 통과했으므로 여기서 not_found가 나올 일은 사실상 없지만,
    // 레이스(동시 삭제) 방어를 위해 남겨둔다.
    if (result.reason === "already_deleted") {
      return NextResponse.json({ error: "이미 삭제된 기억입니다." }, { status: 409 });
    }
    return NextResponse.json({ error: "기억을 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({ memory: result.memory });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ memoryId: string }> }
) {
  const { memoryId } = await params;

  let body: { characterId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문입니다." }, { status: 400 });
  }

  const ownershipErr = ownershipError(memoryId, body.characterId);
  if (ownershipErr) return ownershipErr;

  // 이미 삭제된 기억을 다시 삭제해도 idempotent하게 성공 처리한다(REST DELETE 관례).
  const result = softDeleteMemory(memoryId);
  if (!result.ok) {
    return NextResponse.json({ error: "기억을 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
