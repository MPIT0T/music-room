import { z } from 'zod';

// Invisible characters that change how text is shown without being seen:
// C0/C1 controls (NUL, ANSI escapes, newlines) and bidirectional overrides,
// which can display "evil" reversed or hide part of a name. Emoji joiners stay allowed.
const INVISIBLE = /[\p{Cc}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

// Single-line text typed by a user and shown to others (names, city...)
export function safeText({ min = 0, max }) {
  return z
    .string()
    .normalize('NFC')
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !INVISIBLE.test(value), {
      message: 'must not contain control or text-direction characters',
    });
}
