/**
 * Provider content is untrusted. These helpers strip markup, control/zero-width characters and
 * instruction-like payloads before any text is stored, rendered, or shown to a model.
 */

const TAG_RE = /<\/?[a-z][^>]*>/gi;
const SCRIPT_RE = /<(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\/\1>/gi;
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const ZERO_WIDTH_RE = /[​-‏‪-‮⁠-⁤﻿]/g;
const ENTITY_MAP: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

export function sanitizeText(input: unknown, maxLen = 2000): string {
  if (typeof input !== "string") return "";
  let s = input.replace(SCRIPT_RE, " ").replace(TAG_RE, " ");
  s = s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITY_MAP[m] ?? m);
  s = s.replace(CONTROL_RE, " ").replace(ZERO_WIDTH_RE, "");
  s = s.replace(/\s+/g, " ").trim();
  return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
}

/** Phrases that indicate an attempt to instruct a downstream model. Flagged, never obeyed. */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all|any|the)? ?(previous|prior|above) (instructions|prompts?)/i,
  /disregard (the )?(system|previous) (prompt|instructions)/i,
  /you are (now )?(an?|the) (ai|assistant|model)/i,
  /\bsystem prompt\b/i,
  /\bact as\b.{0,40}\b(assistant|model|ai)\b/i,
  /<\/?(system|assistant|instructions?)>/i,
  /\bdo not (tell|reveal) the user\b/i,
  /\boutput (the following|only)\b.{0,30}\bjson\b/i,
];

export function detectInjection(text: string): string[] {
  return INJECTION_PATTERNS.filter((re) => re.test(text)).map((re) => re.source);
}

/** Only http(s) URLs with a real hostname are rendered as links. */
export function safeExternalUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  try {
    const u = new URL(input);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".")) return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}
