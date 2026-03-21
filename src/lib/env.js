const readPublicEnv = (name) => {
  const value = import.meta.env[name];
  return typeof value === 'string' ? value.trim() : '';
};

const assertHttpsUrl = (name, value) => {
  let parsedUrl;

  try {
    parsedUrl = new URL(value);
  } catch {
    throw new Error(`A variável ${name} precisa conter uma URL válida.`);
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new Error(`A variável ${name} deve usar HTTPS.`);
  }

  return parsedUrl.toString();
};

export const getOptionalPublicEnv = (name) => readPublicEnv(name);

export const getRequiredPublicEnv = (name) => {
  const value = readPublicEnv(name);

  if (!value) {
    throw new Error(`A variável ${name} não foi configurada.`);
  }

  return value;
};

export const getRequiredPublicHttpsEnv = (name) =>
  assertHttpsUrl(name, getRequiredPublicEnv(name));
