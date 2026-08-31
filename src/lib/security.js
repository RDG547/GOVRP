const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

export const ACCEPTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
];

export const ACCEPTED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'];

export const ACCEPTED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/webm',
];

export const ACCEPTED_VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm'];

export const IMAGE_ACCEPT_ATTRIBUTE = ACCEPTED_IMAGE_MIME_TYPES.join(',');
export const VIDEO_ACCEPT_ATTRIBUTE = ACCEPTED_VIDEO_MIME_TYPES.join(',');

export const MAX_STANDARD_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_AVATAR_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_SOCIAL_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_SUPPORT_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_POST_VIDEO_UPLOAD_BYTES = 180 * 1024 * 1024;
export const MAX_STORY_VIDEO_UPLOAD_BYTES = 60 * 1024 * 1024;

const getFileExtension = (filename = '') => {
  const extension = filename.split('.').pop();
  return extension ? extension.toLowerCase() : '';
};

export const sanitizeStorageFileName = (filename = 'arquivo') => {
  const extension = getFileExtension(filename);
  const baseName = filename.replace(/\.[^/.]+$/, '');
  const safeBaseName =
    baseName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'arquivo';

  const safeExtension = extension.replace(/[^a-z0-9]/g, '').slice(0, 10);

  return safeExtension ? `${safeBaseName}.${safeExtension}` : safeBaseName;
};

export const buildStoragePath = ({ prefix, entityId, fileName }) =>
  [prefix, entityId, `${Date.now()}-${sanitizeStorageFileName(fileName)}`]
    .filter(Boolean)
    .join('/');

export const extractStoragePathFromUrl = (url, bucketName) => {
  if (!url) return null;

  try {
    const urlObject = new URL(url);
    const pathSegments = urlObject.pathname.split('/');
    const bucketIndex = pathSegments.indexOf(bucketName);

    if (bucketIndex === -1 || bucketIndex + 1 >= pathSegments.length) {
      return null;
    }

    return pathSegments.slice(bucketIndex + 1).join('/');
  } catch {
    return null;
  }
};

export const normalizeSafeUrl = (value) => {
  if (!value?.trim()) {
    return '';
  }

  try {
    const url = new URL(value.trim());

    if (!HTTP_PROTOCOLS.has(url.protocol)) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
};

export const validateRemoteAssetUrl = (value) => {
  if (!value?.trim()) {
    return { ok: true, value: '' };
  }

  const normalizedUrl = normalizeSafeUrl(value);

  if (!normalizedUrl) {
    return {
      ok: false,
      error: 'Use apenas URLs HTTP/HTTPS válidas.',
    };
  }

  return { ok: true, value: normalizedUrl };
};

const formatMbLimit = (maxBytes) => {
  const mb = maxBytes / (1024 * 1024);
  return Number.isInteger(mb) ? String(mb) : mb.toFixed(1);
};

export const validateSelectedFile = (
  file,
  {
    allowedMimeTypes = [],
    allowedExtensions = [],
    maxBytes,
    label = 'arquivo',
  } = {}
) => {
  if (!file) {
    return {
      ok: false,
      error: `Nenhum ${label} foi selecionado.`,
    };
  }

  const fileType = file.type?.toLowerCase() || '';
  const fileExtension = getFileExtension(file.name);
  const hasMimeRestrictions = allowedMimeTypes.length > 0;
  const hasExtensionRestrictions = allowedExtensions.length > 0;
  const mimeAllowed = !hasMimeRestrictions || allowedMimeTypes.includes(fileType);
  const extensionAllowed =
    !hasExtensionRestrictions || allowedExtensions.includes(fileExtension);

  if (!mimeAllowed && !extensionAllowed) {
    return {
      ok: false,
      error: `Tipo de ${label} não permitido.`,
    };
  }

  if (maxBytes && file.size > maxBytes) {
    return {
      ok: false,
      error: `O ${label} excede o limite de ${formatMbLimit(maxBytes)} MB.`,
    };
  }

  return { ok: true };
};

export const openUrlInNewTab = (url) => {
  const safeUrl = normalizeSafeUrl(url);

  if (!safeUrl) {
    return false;
  }

  const openedWindow = window.open(safeUrl, '_blank', 'noopener,noreferrer');

  if (openedWindow) {
    openedWindow.opener = null;
  }

  return true;
};
