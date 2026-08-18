"use client";

import { ReminderMark } from "./ReminderMark";

export function NewMessageToast({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 z-50 flex justify-center px-4">
      <div className="animate-message-in flex items-center gap-1.5 rounded-full bg-seal px-4 py-2.5 text-xs font-medium text-white shadow-lg">
        <ReminderMark className="h-4 w-4 shrink-0" />
        <span>{text}</span>
      </div>
    </div>
  );
}
