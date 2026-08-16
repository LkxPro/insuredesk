import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function pidFileAlive(path: string): Promise<boolean> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return false;
  }
  const pid = Number.parseInt(text.trim(), 10);
  return Number.isInteger(pid) && pid > 0 && pidAlive(pid);
}

// mkdir 语义锁：持有人写 pid,持有人死亡后受让。与 shell 版目录布局一致。
export class DirLock {
  private held = false;
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async acquire(): Promise<boolean> {
    try {
      await mkdir(this.path);
      await writeFile(join(this.path, "pid"), `${process.pid}\n`);
      this.held = true;
      return true;
    } catch {
      // 锁已存在：持人活着就失败，死了就清尸体重试一次。
    }
    let owner = Number.NaN;
    try {
      owner = Number.parseInt(await readFile(join(this.path, "pid"), "utf8"), 10);
    } catch {}
    if (Number.isInteger(owner) && pidAlive(owner)) return false;
    await rm(join(this.path, "pid"), { force: true });
    await rmdir(this.path).catch(() => {});
    try {
      await mkdir(this.path);
      await writeFile(join(this.path, "pid"), `${process.pid}\n`);
      this.held = true;
      return true;
    } catch {
      return false;
    }
  }

  async acquireBlocking(waitSeconds = 5): Promise<void> {
    for (;;) {
      if (await this.acquire()) return;
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    }
  }

  // .worktrees 可能被整目录删除重建:锁文件消失或易主时,内存里的持有状态不算数。
  async verify(): Promise<boolean> {
    if (!this.held) return false;
    let owner = Number.NaN;
    try {
      owner = Number.parseInt(await readFile(join(this.path, "pid"), "utf8"), 10);
    } catch {
      return false;
    }
    return owner === process.pid;
  }

  async release(): Promise<void> {
    if (!this.held) return;
    this.held = false;
    let owner = Number.NaN;
    try {
      owner = Number.parseInt(await readFile(join(this.path, "pid"), "utf8"), 10);
    } catch {}
    if (owner !== process.pid) return;
    await rm(join(this.path, "pid"), { force: true });
    await rmdir(this.path).catch(() => {});
  }
}
