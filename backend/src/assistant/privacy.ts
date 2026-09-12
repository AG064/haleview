export function hasPrivateText(value: string): boolean {
  value = value.normalize("NFKC");
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(value)
    || /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{12,}|Bearer\s+\S{12,})/iu.test(value)
    || /\b(?:my\s+)?(?:password|api[ _-]?key|date of birth|dob)\s*(?:is|:|=)\s*\S+/iu.test(value)
    || /\bborn\s+(?:on\s+)?(?:\d|[a-z]+\s+\d)/iu.test(value)
    || /(?:\+\d[\d\s().-]{7,}\d)|\b\d{9,}\b/u.test(value)
    || /(?:\b\d{3}|\(\d{3}\))[ .-]?\d{3}[ .-]\d{4}\b/u.test(value)
    || /\b(?:phone|telephone|mobile|cell|call me|contact me)\b[^\d\n]{0,24}(?:\+?\d[\d ().-]{5,}\d)\b/iu.test(value);
}
