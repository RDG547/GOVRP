// World reset protection belongs to the database maintenance gate. Do not
// request the universe generation or inject per-request headers for normal
// authenticated server operations.
export const withWorldRequest = (_request, work) => work();
export const worldServerFetch = (input, options) =>
  globalThis.fetch(input, options);
