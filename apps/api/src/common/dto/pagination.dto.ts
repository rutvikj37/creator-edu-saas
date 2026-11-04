import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

/** Standard list query: ?page=&pageSize=&q=&sort=-createdAt */
export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;

  @ApiPropertyOptional({ description: 'Free-text search' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ description: 'Field name, prefix with - for descending', example: '-createdAt' })
  @IsOptional()
  @Matches(/^-?[a-zA-Z]{1,40}$/)
  sort?: string;
}

/** Converts a validated sort string into a Prisma orderBy, restricted to an allow-list. */
export function toOrderBy<T extends string>(
  sort: string | undefined,
  allowed: readonly T[],
  fallback: Partial<Record<T, 'asc' | 'desc'>>,
): Partial<Record<T, 'asc' | 'desc'>> {
  if (!sort) return fallback;
  const desc = sort.startsWith('-');
  const field = (desc ? sort.slice(1) : sort) as T;
  if (!allowed.includes(field)) return fallback;
  return { [field]: desc ? 'desc' : 'asc' } as Partial<Record<T, 'asc' | 'desc'>>;
}

export function toSkipTake(q: PaginationQueryDto) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}
