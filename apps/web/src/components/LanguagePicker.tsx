'use client';

import { Label } from '@lifecoach/ui';
import { RadioGroup, RadioGroupItem } from '@lifecoach/ui';
import type { User } from 'firebase/auth';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Locale, locales } from '../i18n/routing';

export interface LanguagePickerProps {
  user: User | null;
  /** Current locale resolved server-side (cookie or Accept-Language). */
  locale: Locale;
}

/**
 * Radio group bound to `profile.language` + the `NEXT_LOCALE` cookie. Changes
 * trigger `router.refresh()` so server-rendered messages re-flow into the new
 * language without a full reload.
 */
export function LanguagePicker({ user, locale }: LanguagePickerProps) {
  const t = useTranslations('settings.language');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setLanguage(next: string) {
    if (!user || busy || next === locale) return;
    setBusy(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/profile/language', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ language: next }),
      });
      if (!res.ok) throw new Error(`POST /api/profile/language: ${res.status}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>{t('label')}</Label>
      <p className="text-xs text-muted-foreground">{t('description')}</p>
      <RadioGroup value={locale} onValueChange={setLanguage} disabled={busy} className="mt-1">
        {locales.map((code) => {
          const id = `lang-${code}`;
          return (
            <label
              key={code}
              htmlFor={id}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <RadioGroupItem id={id} value={code} disabled={busy} />
              {t(code)}
            </label>
          );
        })}
      </RadioGroup>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
