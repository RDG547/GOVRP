import { citizenAvatarHandler } from '../server/citizens/avatar.js';
import { evidenceHandler } from '../server/justice/evidence.js';

export default function citizenApiPlugin() {
  return {
    name: 'vite:citizen-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url || '/', 'http://localhost').pathname;
        if (pathname === '/api/justice/evidence') return evidenceHandler(request, response);
        if (pathname !== '/api/citizens/avatar') return next();
        await citizenAvatarHandler(request, response);
      });
    },
  };
}
