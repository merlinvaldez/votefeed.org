const ADDRESS_DRAFT_STORAGE_KEY = "votefeed_address_draft";

function normalizeAddressDraft(draft = {}) {
  return {
    street: String(draft.street ?? ""),
    city: String(draft.city ?? ""),
    stateCode: String(draft.stateCode ?? ""),
    zip: String(draft.zip ?? ""),
  };
}

export function readAddressDraft() {
  if (typeof window === "undefined") return normalizeAddressDraft();
  try {
    return normalizeAddressDraft(
      JSON.parse(window.sessionStorage.getItem(ADDRESS_DRAFT_STORAGE_KEY)) ||
        {},
    );
  } catch {
    return normalizeAddressDraft();
  }
}

export function saveAddressDraft(draft) {
  if (typeof window === "undefined") return;
  const nextDraft = normalizeAddressDraft(draft);
  const hasValue = Object.values(nextDraft).some((value) => value.trim());
  if (!hasValue) {
    window.sessionStorage.removeItem(ADDRESS_DRAFT_STORAGE_KEY);
    return;
  }
  window.sessionStorage.setItem(
    ADDRESS_DRAFT_STORAGE_KEY,
    JSON.stringify(nextDraft),
  );
}

export function clearAddressDraft() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(ADDRESS_DRAFT_STORAGE_KEY);
}

export function validateAddressFields({ street, city, stateCode, zip }) {
  const errors = {};
  const zipPattern = /^\d{5}$/;
  if (!zipPattern.test(zip.trim())) errors.zip = "Enter a 5 digit ZIP code.";
  if (!street.trim() || !city.trim() || !stateCode.trim())
    errors.address = "Street, city, and state are required.";
  return errors;
}

export function formatAddress({ street, city, stateCode, zip }) {
  return `${street.trim()}, ${city.trim()}, ${stateCode.trim()} ${zip.trim()}`;
}
