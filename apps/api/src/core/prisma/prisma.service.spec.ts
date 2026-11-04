import { poolOptionsFromUrl } from './prisma.service.js';

describe('poolOptionsFromUrl', () => {
  it('parses credentials, database and options', () => {
    const o = poolOptionsFromUrl('mysql://ce%40app:p%23ss@db.local:3307/creator?connection_limit=25');
    expect(o).toMatchObject({ host: 'db.local', port: 3307, user: 'ce@app', password: 'p#ss', database: 'creator', connectionLimit: 25, timezone: 'Z' });
  });
});
