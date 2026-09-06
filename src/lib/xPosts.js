export const X_POST_TABLES = ['posts', 'likes', 'comments'];

export function mergePosts(current, incoming) {
  const byId = new Map(current.map(post => [post.id, post]));
  for (const post of incoming) byId.set(post.id, { ...byId.get(post.id), ...post });
  return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
}

export function changedPostIds(events) {
  return [...new Set(events.flatMap(event => event.table === 'posts'
    ? [event.new?.id, event.old?.id, event.new?.parent_post_id, event.new?.original_post_id]
    : [event.new?.post_id, event.old?.post_id]).filter(Boolean))];
}
