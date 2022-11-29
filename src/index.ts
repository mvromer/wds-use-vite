import koaConnect from 'koa-connect';
import { URL } from 'url';
import { createServer } from 'vite';

import type { Middleware } from 'koa';

function requestingModernWebVirtualModule(requestPath: string) {
  return (
    requestPath.startsWith('/__web-test-runner__') ||
    requestPath.startsWith('/__web-dev-server__')
  );
}

export function useVite(): Middleware {
  let wrappedViteMiddleware: Middleware;

  return async function useViteMiddleware(context, next) {
    if (!wrappedViteMiddleware) {
      const viteServer = await createServer({
        clearScreen: false,
        appType: 'custom',
        server: {
          middlewareMode: true,
        },
        plugins: [
          {
            name: 'wds-use-vite:resolve',

            resolveId(moduleId) {
              // We cannot resolve WDS and WTR modules because they are actually virtual modules created
              // by the WDS instance. Treat the imports as external from Vite's perspective so that WDS
              // can resolve them.
              if (requestingModernWebVirtualModule(moduleId)) {
                return { id: moduleId, external: true };
              }
            },
          },
        ],
      });

      wrappedViteMiddleware = koaConnect(viteServer.middlewares);
    }

    const originalUrl = context.req.url;

    if (!originalUrl) {
      await next();
      return;
    }

    // Strip off the WTR session ID query parameters before passing them through to Vite's
    // middleware. Otherwise, some of Vite's module resolution plugins can fail. For example, when
    // an importing module imports a TypeScript file using the .js extension. The test Vite uses for
    // detecting this (and ultimately serving the corresponding .ts file) is based on matching the
    // expected file extension strictly at the end of the requested module path, which fails if any
    // unexpected query parameters are present.
    const modifiedUrl = new URL(
      originalUrl.toString(),
      `${context.protocol}://${context.host}`
    );

    modifiedUrl.searchParams.delete('wtr-session-id');

    // Call Vite middleware with the modified request URL. Before returning, restore it on the
    // context object.
    context.req.url = `${modifiedUrl.pathname}${modifiedUrl.search}`;
    await wrappedViteMiddleware(context, next);
    context.req.url = originalUrl;
  };
}
