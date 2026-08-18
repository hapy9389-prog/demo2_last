import { NextResponse } from "next/server";
import { deleteReminder } from "@/lib/store";

// DELETE /api/reminders/:id -> pending 상태인 리마인더만 취소 가능.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = deleteReminder(id);

  if (!result.ok) {
    if (result.reason === "not_found") {
      return NextResponse.json({ error: "리마인더를 찾을 수 없습니다." }, { status: 404 });
    }
    // not_pending: 이미 처리 중이거나(processing) 끝난(fired/failed) 리마인더
    return NextResponse.json(
      { error: "이미 처리 중이거나 완료된 리마인더는 취소할 수 없습니다." },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true });
}
