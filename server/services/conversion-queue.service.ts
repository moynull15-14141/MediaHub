interface QueueTask {
  jobId: string;
  run: (registerCancel: (kill: () => void) => void) => Promise<void>;
}

class ConversionQueue {
  private maxConcurrency = Number(process.env.CONVERTER_MAX_CONCURRENCY) || 2;
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
