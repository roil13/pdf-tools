import fs from 'node:fs';

/**
 * Absolute paths to real-world PDFs to run the integration tests against.
 *
 * These live outside the repository, in `test/samples.local.json`, for two
 * reasons: they are machine-specific, so nobody else's checkout could use them
 * anyway; and they are someone's own documents, whose names do not belong in a
 * public repository.
 *
 * Returns an empty list when the file is absent or unreadable, which is what
 * makes the suites that use it skip rather than fail on a clean checkout.
 * See `test/samples.local.example.json`.
 */
export function localSamples(): string[] {
  try {
    const listed: unknown = JSON.parse(fs.readFileSync('test/samples.local.json', 'utf8'));
    if (!Array.isArray(listed)) return [];
    return listed.filter((f): f is string => typeof f === 'string' && fs.existsSync(f));
  } catch {
    return [];
  }
}
