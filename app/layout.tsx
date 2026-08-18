// 스케줄러를 서버 프로세스 기동 시 1회 시작시키기 위한 side-effect import.
// 루트 레이아웃은 앱의 첫 요청에서 항상 로드되므로, 별도의 instrumentation.ts
// 설정 없이도 이 위치에서 import하는 것만으로 "로컬 상시구동 서버" 전제를 만족시킬 수 있다.
import "@/lib/scheduler";

import type { Metadata } from "next";
import localFont from "next/font/local";
import { Geist_Mono, Gowun_Batang } from "next/font/google";
import "./globals.css";

/**
 * Pretendard — 한글 프리미엄 앱의 사실상 표준 UI 서체. Google Fonts에는 없어
 * pretendard npm 패키지(node_modules/pretendard)의 variable woff2를 app/fonts/에
 * vendoring해 next/font/local로 self-host한다(런타임 CDN 의존 없이 next/font
 * 최적화·font-display 적용). 기존에 body가 실제로는 Arial로 렌더링되던 문제
 * (globals.css 참고)를 이 폰트로 교체하며 함께 정리한다.
 */
const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "45 920",
  display: "swap",
});

/**
 * Gowun Batang — "포토카드 다이어리" 컨셉의 제목/편집 텍스트 전용 세리프.
 * 본문에는 쓰지 않고 캐릭터 이름 네임플레이트, 섹션 헤드라인 등 절제된 자리에만
 * globals.css의 font-display 유틸리티로 쓴다.
 */
const gowunBatang = Gowun_Batang({
  weight: ["400", "700"],
  // Gowun Batang은 Google Fonts CSS가 subset별로 파일을 나누지 않는 단일 파일 폰트라
  // "latin"만 지정해도 한글 글리프가 함께 로드된다.
  subsets: ["latin"],
  variable: "--font-gowun-batang",
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "현실 시간과 연결되는 AI 캐릭터 채팅",
  description: "캐릭터와 채팅하다 리마인더를 부탁하면, 실제 그 시간에 캐릭터가 먼저 말을 겁니다.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${pretendard.variable} ${gowunBatang.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-paper text-ink">
        {children}
      </body>
    </html>
  );
}
