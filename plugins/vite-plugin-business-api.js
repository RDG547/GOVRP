import {
  processWeeklyBusinessBalancesHandler,
  registerBusinessHandler,
} from '../server/businesses/http.js';

const ROUTE_HANDLERS = {
  '/api/businesses/register': registerBusinessHandler,
  '/api/businesses/process-balances': processWeeklyBusinessBalancesHandler,
};

const json = (response, statusCode, payload) => {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
};

export default function businessApiPlugin() {
  return {
    name: 'vite:business-api',
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
          console.error('[vite:business-api]', error);

          if (!response.writableEnded) {
            json(response, 500, {
              error: 'Não foi possível processar a solicitação empresarial.',
            });
          }
        }
      });
    },
  };
}
