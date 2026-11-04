import { Inject, Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants.js';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Atomic fixed-window counter + block key in Redis, so rate limits are shared by every
 * API instance (in-memory limits would reset per process and be trivially bypassed).
 * Returns: hits, ms until window expiry, blocked flag, ms until block expiry.
 */
const SCRIPT = `
local hitsKey = KEYS[1]
local blockKey = KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])
local blockTtl = redis.call('PTTL', blockKey)
if blockTtl > 0 then
  local hits = tonumber(redis.call('GET', hitsKey) or '0')
  return { hits, math.max(redis.call('PTTL', hitsKey), 0), 1, blockTtl }
end
local hits = redis.call('INCR', hitsKey)
if hits == 1 then redis.call('PEXPIRE', hitsKey, ttl) end
local ttlLeft = redis.call('PTTL', hitsKey)
if hits > limit then
  redis.call('SET', blockKey, '1', 'PX', blockDuration)
  return { hits, ttlLeft, 1, blockDuration }
end
return { hits, ttlLeft, 0, 0 }
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const base = `rl:${throttlerName}:${key}`;
    const [hits, timeToExpire, blocked, timeToBlockExpire] = (await this.redis.eval(
      SCRIPT,
      2,
      `${base}:hits`,
      `${base}:block`,
      ttl,
      limit,
      blockDuration,
    )) as [number, number, number, number];
    return {
      totalHits: hits,
      timeToExpire: Math.ceil(timeToExpire / 1000),
      isBlocked: blocked === 1,
      timeToBlockExpire: Math.ceil(timeToBlockExpire / 1000),
    };
  }
}
