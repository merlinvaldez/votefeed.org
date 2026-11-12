import { isNotificationSendWindow } from "../_shared/notificationWindow.ts";

Deno.test("morning retry window stays 5:30–6:25 Eastern across daylight saving", () => {
  for (const [date, expected] of [
    ['2026-11-12T10:29:00Z', false], ['2026-11-12T10:30:00Z', true],
    ['2026-11-12T11:25:00Z', true], ['2026-11-12T11:30:00Z', false],
    ['2026-07-12T09:30:00Z', true], ['2026-07-12T10:25:00Z', true],
    ['2026-07-12T10:30:00Z', false], ['2026-11-12T18:00:00Z', false],
  ] as const) {
    if (isNotificationSendWindow(new Date(date)) !== expected) throw new Error(`Wrong window: ${date}`);
  }
});
