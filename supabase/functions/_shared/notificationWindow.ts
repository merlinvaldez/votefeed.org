// Keep the delivery window fixed in New York time through daylight saving.
export function isNotificationSendWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find(part => part.type === "hour")?.value);
  const minute = Number(parts.find(part => part.type === "minute")?.value);
  return (hour === 5 && minute >= 30) || (hour === 6 && minute <= 25);
}
