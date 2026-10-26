/**
 * 设备锁：手机和外部写操作，同一时刻只能有一方在用。
 *
 * 为什么只锁这些：手只有一双，脑子可以同时想两件事。
 *   - 手机 phone_* —— 物理资源，必须串行（不然两边都以为自己在正确的位置）
 *   - B 站写操作（点赞/评论/弹幕/动态）—— 对外可见的动作，别抢
 *   - 思考、回忆、读字幕 —— 不锁，各跑各的，你说话立刻能回
 *
 * 这里是**全局单例**：聊天那个 service 和思考那个 service 是两个实例，
 * 只有共享同一把锁才能真正互斥。
 */
type Release = () => void;

let locked = false;
const waiters: Array<() => void> = [];

/** 试着拿锁；拿不到就等。返回释放函数。 */
export async function acquireDevice(timeoutMs = 120_000): Promise<Release> {
  if (!locked) {
    locked = true;
    return release;
  }

  // 有人在用：排队等，但别无限等
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      const i = waiters.indexOf(enter);
      if (i >= 0) waiters.splice(i, 1);
      reject(new Error("等设备等太久，这次先不动"));
    }, timeoutMs);

    const enter = (): void => {
      clearTimeout(timer);
      locked = true;
      resolve();
    };
    waiters.push(enter);
  });

  return release;
}

function release(): void {
  const next = waiters.shift();
  if (next) {
    // 直接把锁交给下一个，避免「先放再抢」的窗口
    next();
    return;
  }
  locked = false;
}

/** 现在有没有人在用 */
export function deviceBusy(): boolean {
  return locked;
}
