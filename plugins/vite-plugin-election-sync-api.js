import { syncElectionOfficesHandler } from '../server/elections/http.js';
import { adminUpdateUserHandler } from '../server/admin/http.js';

const ROUTE_HANDLERS = {
  '/api/admin/update-user': adminUpdateUserHandler,
  '/api/elections/sync-offices': syncElectionOfficesHandler,
};

const json = (response, statusCode, payload) => {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
};

export default function electionSyncApiPlugin() {
  return {
    name: 'vite:election-sync-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const requestUrl = request.url ? new URL(request.url, 'http://localhost') : null;
        const handler = requestUrl ? ROUTE_HANDLERS[requestUrl.pathname] : null;

        if (!handler) {
          next();
          return;
        }

        try {
          await handler(request, response);
        } catch (error) {
          console.error('[vite:election-sync-api]', error);

          if (!response.writableEnded) {
            json(response, 500, {
              error: 'Não foi possível sincronizar os cargos eleitorais.',
            });
          }
        }
      });
    },
  };
}
