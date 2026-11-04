import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional class names, letting later Tailwind classes override earlier ones. */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
