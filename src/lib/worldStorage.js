// Storage does not forward custom request headers to its database connection.
// Persist the captured generation in upload metadata so the row trigger can
// check it atomically, including uploads delayed across a reset.
export function withStorageGeneration(options, headers, generation) {
  const body = options.body;
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const copy = new FormData();
    for (const [key, value] of body.entries()) copy.append(key, value);
    let metadata = {};
    try {
      metadata = JSON.parse(copy.get("metadata") || "{}");
    } catch {
      /* Replace invalid metadata. */
    }
    copy.set(
      "metadata",
      JSON.stringify({ ...metadata, world_generation: generation }),
    );
    return { ...options, body: copy, headers };
  }
  let metadata = {};
  try {
    metadata = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(headers.get("x-metadata") || ""), (c) =>
          c.charCodeAt(0),
        ),
      ),
    );
  } catch {
    /* No existing metadata. */
  }
  const encoded = new TextEncoder().encode(
    JSON.stringify({ ...metadata, world_generation: generation }),
  );
  headers.set("x-metadata", btoa(String.fromCharCode(...encoded)));
  return { ...options, headers };
}
