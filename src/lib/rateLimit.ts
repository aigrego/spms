/* 内存滑动窗口限流。当前用于登录接口:按 key(IP+用户名)统计窗口内的
   失败次数,达到上限即拒绝。
   注意:计数保存在进程内 Map —— serverless / 多实例部署下各实例的计数
   互不可见,限流会失真;那种部署形态需换成共享存储(Redis INCR/EXPIRE、
   Upstash Ratelimit 等),保持下面的函数签名即可无缝替换实现。 */

// key → 窗口内的命中时间戳(升序)
const buckets = new Map<string, number[]>();

/* 不同 key 超过该值时做一次全量清扫,防止被喷洒随机 key 撑大内存。 */
const MAX_KEYS = 5000;

/* 滤出 windowMs 内的记录;空桶直接从 Map 删掉。 */
function liveHits(key: string, windowMs: number, now: number): number[] {
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length) buckets.set(key, hits);
  else buckets.delete(key);
  return hits;
}

function sweep(windowMs: number, now: number): void {
  if (buckets.size <= MAX_KEYS) return;
  for (const [k, hits] of buckets) {
    const live = hits.filter((t) => now - t < windowMs);
    if (live.length) buckets.set(k, live);
    else buckets.delete(k);
  }
}

/* 该 key 当前是否已超限(窗口内命中数 >= limit)。 */
export function rateLimited(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  return liveHits(key, windowMs, now).length >= limit;
}

/* 记一次命中(如一次登录失败)。 */
export function rateLimitRecord(key: string, windowMs: number, now = Date.now()): void {
  sweep(windowMs, now);
  const hits = liveHits(key, windowMs, now);
  hits.push(now);
  buckets.set(key, hits);
}

/* 清零该 key(如登录成功后)。 */
export function rateLimitReset(key: string): void {
  buckets.delete(key);
}
