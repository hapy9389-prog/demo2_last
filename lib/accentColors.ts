import { CharacterAccent } from "@/types";

/**
 * 캐릭터 accent(`Character.accent`) → tailwind 클래스 매핑의 단일 source of truth.
 *
 * 원래 `components/Avatar.tsx` 안에 비공개로 있던 `ACCENT_STYLE`을 이 파일로 옮기고,
 * 홈 화면 카드/스포트라이트용 옅은 배경·테두리 매핑을 추가했다. `Avatar`,
 * `CharacterCard`, `HomeSpotlight`가 전부 이 한 곳만 참조하므로 accent 색 정의가 여러
 * 파일에 중복되지 않는다.
 *
 * Chat 리디자인(ChatHeader/MessageBubble)에서는 accent로 배경/버블 전체를 칠하지
 * 않는다 — Home이 accent 틴트 박스를 걷어낸 것과 같은 원칙. 대신 아주 미세한 포인트
 * (캐릭터 메시지 옆 얇은 rule, 헤더 이름 옆 작은 dot)로만 쓴다. `ACCENT_RULE_STYLE`/
 * `ACCENT_DOT_STYLE`이 그 용도다.
 */

/** 아바타 이미지 로드 실패 시 emoji 폴백 배경/텍스트 색. Avatar.tsx의 기존 값을 그대로 유지. */
export const ACCENT_AVATAR_STYLE: Record<CharacterAccent, string> = {
  blue: "bg-sky-100 text-sky-700",
  rose: "bg-rose-100 text-rose-700",
  amber: "bg-amber-100 text-amber-700",
  slate: "bg-slate-100 text-slate-700",
  zinc: "bg-zinc-100 text-zinc-700",
  violet: "bg-violet-100 text-violet-700",
};

/**
 * 홈 화면 카드(Spotlight/CharacterCard) 배경·테두리용 아주 옅은 accent tint.
 * 원색 배지가 아니라 은은한 배경으로만 캐릭터를 구분해 화면이 알록달록해지지 않게 한다.
 */
export const ACCENT_CARD_STYLE: Record<CharacterAccent, string> = {
  blue: "bg-sky-50/60 border-sky-100",
  rose: "bg-rose-50/60 border-rose-100",
  amber: "bg-amber-50/60 border-amber-100",
  slate: "bg-slate-50/60 border-slate-100",
  zinc: "bg-zinc-50/60 border-zinc-100",
  violet: "bg-violet-50/60 border-violet-100",
};

/**
 * Chat 캐릭터 메시지 옆 얇은 세로 rule 색. 버블 배경 대신 이 얇은 선 하나로만
 * "누구의 말인지" 캐릭터별 정체성을 은은하게 표시한다.
 */
export const ACCENT_RULE_STYLE: Record<CharacterAccent, string> = {
  blue: "border-sky-300",
  rose: "border-rose-300",
  amber: "border-amber-300",
  slate: "border-slate-300",
  zinc: "border-zinc-300",
  violet: "border-violet-300",
};

/** Chat 헤더의 캐릭터 이름 옆 작은 점. ACCENT_RULE_STYLE과 같은 계열, 배경용 진한 톤. */
export const ACCENT_DOT_STYLE: Record<CharacterAccent, string> = {
  blue: "bg-sky-400",
  rose: "bg-rose-400",
  amber: "bg-amber-400",
  slate: "bg-slate-400",
  zinc: "bg-zinc-400",
  violet: "bg-violet-400",
};
