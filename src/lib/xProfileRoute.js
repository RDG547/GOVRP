export const xProfilePath = handle => `/services/x/profile/${encodeURIComponent(handle)}`;

export function profileLookup(handle, identity, viewerId) {
  return identity?.viewerId === viewerId && identity.id
    && [identity.handle, identity.canonicalHandle].includes(handle)
    ? { column: 'id', value: identity.id }
    : { column: 'x_handle', value: handle };
}
