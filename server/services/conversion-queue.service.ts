interface QueueTask {
  jobId: string;
  run: (registerCancel: (kill: () => void) => void) => Promise<void>;
}

class ConversionQueue {
  // Defaults to 1: on a memory-constrained instance (e.g. Render's free 512MB
  // plan), running more than one ffmpeg encode at a time easily exceeds the
  // limit and crashes the whole process. Raise via env var on a bigger plan.
  private maxConcurrency = Number(process.env.CONVERTER_MAX_CONCURRENCY) || 1;
  private running = new Map<string, () => void>();
  private pending: QueueTask[] = [];
  private activeCount = 0;

  enqueue(task: QueueTask) {
    this.pending.push(task);
    this.drain();
  }

  cancel(jobId: string): boolean {
    const kill = this.running.get(jobId);
    if (kill) {
      kill();
      return true;
    }
    const index = this.pending.findIndex((task) => task.jobId === jobId);
    if (index >= 0) {
      this.pending.splice(index, 1);
      return true;
    }
    return false;
  }

  private drain() {
    while (this.activeCount < this.maxConcurrency && this.pending.length > 0) {
      const task = this.pending.shift()!;
      this.activeCount++;
      task
        .run((kill) => this.running.set(task.jobId, kill))
        .catch(() => {})
        .finally(() => {
          this.running.delete(task.jobId);
          this.activeCount--;
          this.drain();
        });
    }
  }
}

export const conversionQueue = new ConversionQueue();
