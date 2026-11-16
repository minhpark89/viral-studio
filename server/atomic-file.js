import fs from 'node:fs';

const pause = new Int32Array(new SharedArrayBuffer(4));

// A Windows reader or scanner can briefly deny replacing the destination.
// Keep the fsynced temporary file and the previous committed file intact.
// The caller still waits for the commit before acknowledging a saved receipt.
export function commitFileSync(temporary, destination) {
  const deadline = performance.now() + 2000;
  let waitMs = 10;
  for (;;) {
    try {
      fs.renameSync(temporary, destination);
      return;
    } catch (error) {
      const remaining = deadline - performance.now();
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || remaining <= 0) throw error;
      Atomics.wait(pause, 0, 0, Math.min(waitMs, remaining));
      waitMs = Math.min(waitMs * 2, 100);
    }
  }
}
