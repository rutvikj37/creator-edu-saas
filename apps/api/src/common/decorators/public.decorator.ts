import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
/** Marks a route as not requiring authentication (enforced from Phase 2 by the global auth guard). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
