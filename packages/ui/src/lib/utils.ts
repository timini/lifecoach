import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combines conditional class names (clsx) and then resolves Tailwind class
 * conflicts (tailwind-merge) so callers can pass overrides freely:
 *   <Button className="px-8" />  // overrides the default px-4
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
