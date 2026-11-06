import path from 'node:path';
import react from '@vitejs/plugin-react';
import { createLogger, defineConfig, loadEnv } from 'vite';
import inlineEditPlugin from './plugins/visual-editor/vite-plugin-react-inline-editor.js';
import editModeDevPlugin from './plugins/visual-editor/vite-plugin-edit-mode.js';
import iframeRouteRestorationPlugin from './plugins/vite-plugin-iframe-route-restoration.js';
import selectionModePlugin from './plugins/selection-mode/vite-plugin-selection-mode.js';
import donationApiPlugin from './plugins/vite-plugin-donation-api.js';
import electionSyncApiPlugin from './plugins/vite-plugin-election-sync-api.js';
import businessApiPlugin from './plugins/vite-plugin-business-api.js';
import citizenApiPlugin from './plugins/vite-plugin-citizen-api.js';
import { VitePWA } from 'vite-plugin-pwa';

const isDev = process.env.NODE_ENV !== 'production';

const configHorizonsViteErrorHandler = `
const observer = new MutationObserver((mutations) => {
	for (const mutation of mutations) {
		for (const addedNode of mutation.addedNodes) {
			if (
				addedNode.nodeType === Node.ELEMENT_NODE &&
				(
					addedNode.tagName?.toLowerCase() === 'vite-error-overlay' ||
					addedNode.classList?.contains('backdrop')
				)
			) {
				handleViteOverlay(addedNode);
			}
		}
	}
});

observer.observe(document.documentElement, {
	childList: true,
	subtree: true
});

function handleViteOverlay(node) {
	if (!node.shadowRoot) {
		return;
	}

	const backdrop = node.shadowRoot.querySelector('.backdrop');

	if (backdrop) {
		const overlayHtml = backdrop.outerHTML;
		const parser = new DOMParser();
		const doc = parser.parseFromString(overlayHtml, 'text/html');
		const messageBodyElement = doc.querySelector('.message-body');
		const fileElement = doc.querySelector('.file');
		const messageText = messageBodyElement ? messageBodyElement.textContent.trim() : '';
		const fileText = fileElement ? fileElement.textContent.trim() : '';
		const error = messageText + (fileText ? ' File:' + fileText : '');

		window.parent.postMessage({
			type: 'horizons-vite-error',
			error,
		}, '*');
	}
}
`;

const configHorizonsRuntimeErrorHandler = `
window.onerror = (message, source, lineno, colno, errorObj) => {
	const errorDetails = errorObj ? JSON.stringify({
		name: errorObj.name,
		message: errorObj.message,
		stack: errorObj.stack,
		source,
		lineno,
		colno,
	}) : null;

	window.parent.postMessage({
		type: 'horizons-runtime-error',
		message,
		error: errorDetails
	}, '*');
};
`;

const configHorizonsConsoleErrorHandler = `
const originalConsoleError = console.error;
const MATCH_LINE_COL_REGEX = /:(\\d+):(\\d+)\\)?\\s*$/; // regex to match the :lineNum:colNum
const MATCH_AT_REGEX = /^\\s*at\\s+(?:async\\s+)?(?:.*?\\s+)?\\(?/; // regex to remove the 'at' keyword and any 'async' or function name
const MATCH_PATH_REGEX = /^\\//; // regex to remove the leading slash

function parseStackFrameLine(line) {
	const lineColMatch = line.match(MATCH_LINE_COL_REGEX);
	if (!lineColMatch) return null;
	const [, lineNum, colNum] = lineColMatch;
	const suffix = \`:\${lineNum}:\${colNum}\`;
	const idx = line.lastIndexOf(suffix);
	if (idx === -1) return null;
	const before = line.substring(0, idx);
	const path = before.replace(MATCH_AT_REGEX, '').trim();
	if (!path) return null;

	try {
		const pathname = new URL(path).pathname;
		const filePath = pathname.replace(MATCH_PATH_REGEX, '') || pathname;
		return \`\${filePath}:\${lineNum}:\${colNum}\`;
	} catch (e) {
		const filePath = path.replace(MATCH_PATH_REGEX, '') || path;
		return \`\${filePath}:\${lineNum}:\${colNum}\`;
	}
}

function getFilePathFromStack(stack, skipFrames = 0) {
	if (!stack || typeof stack !== 'string') return null;
	const lines = stack.split('\\n').slice(1);

	const frames = lines.map(line => parseStackFrameLine(line.replace(/\\r$/, ''))).filter(Boolean);

	return frames[skipFrames] ?? null;
}

console.error = function(...args) {
	originalConsoleError.apply(console, args);

	let errorString = '';
	let filePath = null;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg instanceof Error) {
			filePath = getFilePathFromStack(arg.stack, 0);
			errorString = \`\${arg.name}: \${arg.message}\`;
			if (filePath) {
				errorString = \`\${errorString} at \${filePath}\`;
			}
			break;
		}
	}

	if (!errorString) {
		errorString = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
		const stack = new Error().stack;
		filePath = getFilePathFromStack(stack, 1);
		if (filePath) {
			errorString = \`\${errorString} at \${filePath}\`;
		}
	}

	window.parent.postMessage({
		type: 'horizons-console-error',
		error: errorString
	}, '*');
};
`;

const configWindowFetchMonkeyPatch = `
const originalFetch = window.fetch;

window.fetch = function(...args) {
	const url = args[0] instanceof Request ? args[0].url : args[0];

	// Skip WebSocket URLs
	if (url.startsWith('ws:') || url.startsWith('wss:')) {
		return originalFetch.apply(this, args);
	}

	return originalFetch.apply(this, args)
		.then(async response => {
			const contentType = response.headers.get('Content-Type') || '';

			// Exclude HTML document responses
			const isDocumentResponse =
				contentType.includes('text/html') ||
				contentType.includes('application/xhtml+xml');

			if (!response.ok && !isDocumentResponse) {
					const responseClone = response.clone();
					const errorFromRes = await responseClone.text();
					const requestUrl = response.url;
					console.error(\`Fetch error from \${requestUrl}: \${errorFromRes}\`);
			}

			return response;
		})
		.catch(error => {
			if (!url.match(/\.html?$/i)) {
				console.error(error);
			}

			throw error;
		});
};
`;

const configNavigationHandler = `
if (window.navigation && window.self !== window.top) {
	window.navigation.addEventListener('navigate', (event) => {
		const url = event.destination.url;

		try {
			const destinationUrl = new URL(url);
			const destinationOrigin = destinationUrl.origin;
			const currentOrigin = window.location.origin;

			if (destinationOrigin === currentOrigin) {
				return;
			}
		} catch (error) {
			return;
		}

		window.parent.postMessage({
			type: 'horizons-navigation-error',
			url,
		}, '*');
	});
}
`;

const addTransformIndexHtml = {
	name: 'add-transform-index-html',
	transformIndexHtml(html) {
		const tags = [];

		if (isDev) {
			tags.push(
				{
					tag: 'script',
					attrs: { type: 'module' },
					children: configHorizonsRuntimeErrorHandler,
					injectTo: 'head',
				},
				{
					tag: 'script',
					attrs: { type: 'module' },
					children: configHorizonsViteErrorHandler,
					injectTo: 'head',
				},
				{
					tag: 'script',
					attrs: {type: 'module'},
					children: configHorizonsConsoleErrorHandler,
					injectTo: 'head',
				},
				{
					tag: 'script',
					attrs: { type: 'module' },
					children: configWindowFetchMonkeyPatch,
					injectTo: 'head',
				},
				{
					tag: 'script',
					attrs: { type: 'module' },
					children: configNavigationHandler,
					injectTo: 'head',
				}
			);
		}

		if (!isDev) {
			tags.push({
				tag: 'meta',
				attrs: {
					'http-equiv': 'Content-Security-Policy',
					content:
						"default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self' https://js.stripe.com https://va.vercel-scripts.com https://js.hcaptcha.com https://*.hcaptcha.com; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; media-src 'self' blob: https:; font-src 'self' data: https:; connect-src 'self' https: wss:; frame-src 'self' https://nojlfilayycebrtyybzf.supabase.co https://js.stripe.com https://hooks.stripe.com https://*.hcaptcha.com; manifest-src 'self'; upgrade-insecure-requests",
				},
				injectTo: 'head',
			});
		}

		if (!isDev && process.env.TEMPLATE_BANNER_SCRIPT_URL && process.env.TEMPLATE_REDIRECT_URL) {
			tags.push(
				{
					tag: 'script',
					attrs: {
						src: process.env.TEMPLATE_BANNER_SCRIPT_URL,
						'template-redirect-url': process.env.TEMPLATE_REDIRECT_URL,
					},
					injectTo: 'head',
				}
			);
		}

		return {
			html,
			tags,
		};
	},
};

console.warn = () => {};

const logger = createLogger()
const loggerError = logger.error

logger.error = (msg, options) => {
	if (options?.error?.toString().includes('CssSyntaxError: [postcss]')) {
		return;
	}

	loggerError(msg, options);
}

export default defineConfig(({ mode }) => {
	Object.assign(process.env, loadEnv(mode, process.cwd(), ''));

	return {
		customLogger: logger,
		plugins: [
			...(isDev
				? [
					inlineEditPlugin(),
					editModeDevPlugin(),
					iframeRouteRestorationPlugin(),
					selectionModePlugin(),
					electionSyncApiPlugin(),
					donationApiPlugin(),
					businessApiPlugin(),
					citizenApiPlugin(),
			  ]
				: []),
			react(),
			VitePWA({
				registerType: 'prompt',
				injectRegister: null,
				includeAssets: [
					'favicon.ico',
					'favicon-16x16.png',
					'favicon-32x32.png',
					'favicon-48x48.png',
					'apple-touch-icon.png',
					'icon-192x192.png',
					'icon-512x512.png',
					'icon-maskable-512x512.png',
				],
				manifest: {
					id: '/',
					name: 'GOV.RP - Ecossistema de Roleplay Político',
					short_name: 'GOV.RP',
					description: 'Governe, legisle e transforme o Brasil em um roleplay político persistente.',
					lang: 'pt-BR',
					start_url: '/',
					scope: '/',
					display: 'standalone',
					orientation: 'any',
					background_color: '#020713',
					theme_color: '#071a4b',
					categories: ['games', 'social', 'simulation'],
					icons: [
						{
							src: '/icon-192x192.png',
							sizes: '192x192',
							type: 'image/png',
							purpose: 'any',
						},
						{
							src: '/icon-512x512.png',
							sizes: '512x512',
							type: 'image/png',
							purpose: 'any',
						},
						{
							src: '/icon-maskable-512x512.png',
							sizes: '512x512',
							type: 'image/png',
							purpose: 'maskable',
						},
					],
				},
				workbox: {
					globIgnores: ['**/BlueprintPreview-*.js'],
					cleanupOutdatedCaches: true,
					clientsClaim: false,
					skipWaiting: false,
					navigateFallback: '/index.html',
					navigateFallbackDenylist: [/^\/api\//],
					maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
					runtimeCaching: [
						{
							urlPattern: ({ request, url }) => request.method === 'GET'
								&& url.origin === self.location.origin
								&& request.destination === 'image',
							handler: 'CacheFirst',
							options: {
								cacheName: 'govrp-images',
								expiration: { maxEntries: 120, maxAgeSeconds: 30 * 24 * 60 * 60 },
							},
						},
						{
							urlPattern: ({ url }) => [
								'api.worldbank.org',
								'api.db.nomics.world',
								'api.frankfurter.dev',
								'open.er-api.com',
								'query.wikidata.org',
								'www.wikidata.org',
								'pt.wikipedia.org',
								'en.wikipedia.org',
								'ourworldindata.org',
							].includes(url.hostname),
							handler: 'NetworkFirst',
							options: {
								cacheName: 'govrp-reference-data',
								networkTimeoutSeconds: 6,
								expiration: { maxEntries: 160, maxAgeSeconds: 24 * 60 * 60 },
								cacheableResponse: { statuses: [0, 200] },
							},
						},
					],
				},
			}),
			addTransformIndexHtml
		],
		server: {
			cors: true,
			headers: {
				'Cross-Origin-Embedder-Policy': 'credentialless',
			},
			allowedHosts: true,
		},
		resolve: {
			extensions: ['.jsx', '.js', '.tsx', '.ts', '.json', ],
			alias: {
				'@': path.resolve(__dirname, './src'),
			},
		},
		build: {
			rollupOptions: {
				external: [
					'@babel/parser',
					'@babel/traverse',
					'@babel/generator',
					'@babel/types'
				]
			}
		}
	};
});
