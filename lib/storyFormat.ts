// Story Mode 전용 날짜/상대시각 포맷 함수. lib/time.ts/lib/interactionTime.ts
// (Chat Mode 영구 격리 대상 — CLAUDE.md, 이 프로젝트의 Story Mode 설계 원칙 참고)를
// import하지 않고 작은 구현을 별도로 둔다. lib/storyClaude.ts가 Anthropic 클라이언트
// 초기화를 별도 복제한 것과 같은 이유: Chat Mode 파일에 대한 의존을 만들지 않기 위함이다.

const KST_TIME_ZONE = "Asia/Seoul";

/** 자동 세션 제목("눈보라 속 산장 · 2026.08.15")에 쓰는 KST 기준 "YYYY.MM.DD" 포맷. */
export function formatStoryDate(iso: string): string {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}.${get("month")}.${get("day")}`;
}

/** "이어서 하기"/"내 스토리 기록"의 "마지막 플레이" 표시용 상대 시각. */
export function formatRelativeKorean(iso: string, now: Date = new Date()): string {
  const diffMs = Math.max(0, now.getTime() - new Date(iso).getTime());
  const minutes = Math.floor(diffMs / (60 * 1000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;

  const months = Math.floor(days / 30);
  return `${months}개월 전`;
}
