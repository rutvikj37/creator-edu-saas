import { cn } from '../../utils/cn.js';
import { initials } from '../../utils/format.js';

const sizes = { sm: 'size-7 text-xs', md: 'size-9 text-sm', lg: 'size-12 text-base' };

export function Avatar({ name, src, size = 'md', className }) {
  return src ? (
    <img src={src} alt={name ?? ''} className={cn('rounded-full object-cover', sizes[size], className)} loading="lazy" />
  ) : (
    <span aria-hidden={!name} className={cn('inline-grid place-items-center rounded-full bg-primary-100 font-semibold text-primary-700', sizes[size], className)}>
      {initials(name) || '?'}
    </span>
  );
}
