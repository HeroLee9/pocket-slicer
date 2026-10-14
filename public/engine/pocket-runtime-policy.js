/* Memory and progress policy for the tested mobile Orca runtime. */
(function (root) {
  'use strict';
  const INITIAL_MEMORY_MIB = 256;
  const PAGE_BYTES = 65536;
  function createMemory(maxMiB) {
    if (!Number.isInteger(maxMiB) || maxMiB < INITIAL_MEMORY_MIB || maxMiB > 1024) {
      throw new RangeError('The slicing memory budget must be between 256 and 1024 MiB.');
    }
    return new WebAssembly.Memory({ initial: INITIAL_MEMORY_MIB * 1024 * 1024 / PAGE_BYTES, maximum: maxMiB * 1024 * 1024 / PAGE_BYTES, shared: true });
  }
  function describeError(error) {
    const message = error?.message ?? String(error);
    if (/\b(?:std::bad_alloc|out of (?:engine )?memory|could not allocate memory|memory allocation fail(?:ed|ure)|maximum memory size exceeded|cannot enlarge memory arrays)\b/i.test(message)) {
      return { code: 'MEMORY_LIMIT', message: 'The slicer reached its memory limit for this job. Try fewer objects or a coarser layer height, or slice this job with desktop OrcaSlicer.' };
    }
    return { code: error?.code ?? 'ENGINE', message };
  }
  function createProgressReporter(emit, clock = () => performance.now(), intervalMs = 100) {
    let last = null;
    return (stage, percent = null) => {
      percent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
      // Numbered layers belong to one phase; treating every layer as a new
      // stage can overwhelm React on a phone even when the percentage stays at 80.
      const phase = stage.replace(/:\s*layer\s+\d+(?:\s*\/\s*\d+)?\b/gi, ': layer');
      const now = clock();
      if (last && last.stage === stage && last.percent === percent) return;
      const firstCompletion = percent === 100 && last?.percent !== 100;
      if (last && last.phase === phase && !firstCompletion && now - last.time < intervalMs) return;
      last = { stage, phase, percent, time: now };
      emit({ stage, percent });
    };
  }
  root.PocketRuntimePolicy = Object.freeze({ createMemory, describeError, createProgressReporter });
})(globalThis);
