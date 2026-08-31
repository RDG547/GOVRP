import { fetchWithSessionAuth } from '@/lib/apiAuth';

const readResponse = async (response) => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Não foi possível processar o avatar.');
  return payload;
};

export const uploadAvatarFile = async (file) => {
  const response = await fetchWithSessionAuth('/api/citizens/avatar', {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  return readResponse(response);
};

export const removeAvatarFile = async (path) => {
  if (!path) return { removed: false };
  const response = await fetchWithSessionAuth('/api/citizens/avatar', {
    method: 'DELETE',
    body: JSON.stringify({ path }),
  });
  return readResponse(response);
};
