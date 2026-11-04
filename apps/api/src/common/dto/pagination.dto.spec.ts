import { toOrderBy, toSkipTake } from './pagination.dto.js';

describe('pagination helpers', () => {
  it('computes skip/take', () => {
    expect(toSkipTake({ page: 3, pageSize: 20 } as any)).toEqual({ skip: 40, take: 20 });
  });
  it('honours allow-listed sort fields only', () => {
    expect(toOrderBy('-createdAt', ['createdAt', 'name'], { createdAt: 'desc' })).toEqual({ createdAt: 'desc' });
    expect(toOrderBy('name', ['createdAt', 'name'], { createdAt: 'desc' })).toEqual({ name: 'asc' });
    expect(toOrderBy('passwordHash', ['createdAt', 'name'], { createdAt: 'desc' })).toEqual({ createdAt: 'desc' });
  });
});
