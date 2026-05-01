import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { type Locale, defaultLocale, isLocale } from './routing';

const COOKIE_NAME = 'NEXT_LOCALE';

function bestFromAcceptLanguage(header: string | null): Locale {
  if (!header) return defaultLocale;
  const tags = header
    .split(',')
    .map((tag) => tag.split(';')[0]?.trim().toLowerCase() ?? '')
    .filter(Boolean);
  for (const tag of tags) {
    const base = tag.split('-')[0];
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
