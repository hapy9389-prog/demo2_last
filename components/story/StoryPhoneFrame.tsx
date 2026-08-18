import { ReactNode } from "react";

// components/ChatApp.tsx가 쓰는 phone-frame wrapper와 같은 CSS 레이아웃을 재사용한다
// (모바일 풀블리드 / 데스크톱에서는 가운데 정렬된 폰 목업). ChatApp.tsx 자체는 수정하지
// 않고, Story Mode 전용으로 별도 컴포넌트에 마크업만 복제했다 — Chat Mode 상태/로직과는
// 아무 관련이 없다.
export function StoryPhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-white sm:flex sm:items-center sm:justify-center sm:bg-neutral-200 sm:p-6">
      <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-white sm:h-[844px] sm:max-h-[92vh] sm:max-w-[420px] sm:rounded-[2.5rem] sm:border-[8px] sm:border-neutral-900 sm:shadow-2xl">
        {children}
      </div>
    </div>
  );
}
