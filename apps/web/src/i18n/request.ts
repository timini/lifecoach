import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { type Locale, defaultLocale, isLocale } from './routing';

const COOKIE_NAME = 'NEXT_LOCALE';

/**
 * Parse Accept-Language honouring q-values (RFC 9110 §12.5.4). Tags without
 * an explicit q default to 1.0; ties keep document order. Picks the highest-
 * quality tag whose base language is a supported locale.
 *
 * Example: `en;q=0.2, fr;q=0.9` → `fr` (not `en`, even though `en` is first
 * in document order).
 */
function bestFromAcceptLanguage(header: string | null): Locale {
  if (!header) return defaultLocale;
  const ranked = header
    .split(',')
    .map((entry, index) => {
      const [tag, ...params] = entry.split(';');
      const base = tag?.trim().toLowerCase().split('-')[0] ?? '';
      const qParam = params.find((p) => p.trim().toLowerCase().startsWith('q='));
      const qRaw = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
      const q = Number.isFinite(qRaw) ? qRaw : 0;
      return { base, q, index };
    })
    .filter((entry) => entry.base && entry.q > 0)
    .sort((a, b) => (b.q !== a.q ? b.q - a.q : a.index - b.index));
  for (const { base } of ranked) {
    if (isLocale(base)) return base;
  }
  return defaultLocale;
}

/**
 * Pick locale from cookie if set, otherwise from `Accept-Language`. No URL
 * routing — we keep paths locale-free and rely on the cookie + header to
 * resolve a single locale per request.
 */
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookieValue = cookieStore.get(COOKIE_NAME)?.value;
  const locale: Locale = isLocale(cookieValue)
    ? cookieValue
    : bestFromAcceptLanguage(headerStore.get('accept-language'));
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages };
});
