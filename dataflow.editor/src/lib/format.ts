/*
 * The product is international and its screens are in English, whatever the browser's language: words ("2 days ago",
 * "yesterday") are always English, so a sentence never mixes languages ("Updated semana passada"). Absolute dates are
 * numeric only (no month names) in the order and hour cycle of the user's region (03/11/2026 18:52 in Brazil,
 * 11/03/2026, 06:52 PM in the US). Every date on screen goes through here, so changing the rule is this file only.
 */

/** the language of every word on screen */
export const LOCALE = 'en-US';

/** the user's region, for the order of day, month and year */
const region = () => (typeof navigator !== 'undefined' && navigator.language) || LOCALE;

/** "03/11/2026" (Brazil) or "11/03/2026" (US) */
export const formatDate = (date: Date, locale = region()) =>
  new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);

/** "03/11/2026, 18:52" (Brazil) or "11/03/2026, 06:52 PM" (US), for tooltips */
export const formatDateTime = (date: Date, locale = region()) =>
  new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
