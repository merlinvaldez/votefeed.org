// Feed sentences use surnames; assistive labels retain every full member name.
export function memberSurname(name = "") {
  const normalized = String(name).trim().replace(/\s+/g, " ");
  if (!normalized) return "Unknown member";
  if (normalized.includes(",") && !/,(?:\s*)(?:jr\.?|sr\.?|ii|iii|iv|v)$/i.test(normalized)) {
    return normalized.split(",")[0].trim();
  }
  const knownCompound = ["Cortez Masto", "Wasserman Schultz", "McMorris Rodgers"]
    .find(surname => normalized.toLowerCase().endsWith(" " + surname.toLowerCase()));
  if (knownCompound) return knownCompound;
  const parts = normalized.replace(/,?\s+(?:jr\.?|sr\.?|ii|iii|iv|v)$/i, "").split(" ");
  let start = parts.length - 1;
  while (start > 1 && /^(?:van|von|de|del|da|di|la|le)$/i.test(parts[start - 1])) start -= 1;
  return parts.slice(start).join(" ");
}

export function cardMemberNames(targets) {
  const names = targets.map(member => member.name?.trim() || member.memberId || "Unknown member");
  const title = targets.length === 2 ? "Sens." : targets[0]?.chamber === "Senate" ? "Sen." : "Rep.";
  return { title, surnames: names.map(memberSurname).join(" and "), fullNames: names.join(" and ") };
}
