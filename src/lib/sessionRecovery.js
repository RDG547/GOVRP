// A session revoked on another device is not a ban and cannot be restored by
// retrying the same JWT. Clear only the affected browser's credentials.
export function isRevokedSessionError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '');
  return code === 'govrp_session_revoked' ||
    /invalid refresh token|refresh token not found|session not found|sessão inválida|sessão expirada/i.test(message);
}

export async function clearLocalSessionAndOpenLogin(client, authUrl, environment = globalThis) {
  // Scope MUST be local. Global logout would revoke sessions on other devices.
  let timeoutId;
  try {
    const result = await Promise.race([
      client.auth.signOut({ scope: 'local' }),
      new Promise(resolve => { timeoutId = environment.setTimeout(() => resolve({ timedOut: true }), 4000); }),
    ]);
    if (result?.error) console.warn('[auth] Local session cleanup was declined:', result.error.code || result.error.name);
  } catch (error) {
    console.warn('[auth] Unable to finish local signout:', error?.code || error?.name);
  } finally {
    if (timeoutId !== undefined) environment.clearTimeout?.(timeoutId);
    // If GoTrue cannot revoke a session that was already deleted, clear ONLY
    // this project's persisted auth token. Do not delete all site storage.
    try {
      const projectRef = new URL(authUrl).hostname.split('.')[0];
      environment.localStorage?.removeItem(`sb-${projectRef}-auth-token`);
    } catch { /* storage can be unavailable in private browsing */ }
    environment.location?.replace('/login?session=expired');
  }
}
