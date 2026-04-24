import Constants from 'expo-constants';

const ENV_API_BASE = process.env.EXPO_PUBLIC_API_BASE?.trim();
const ENV_API_CANDIDATES = (process.env.EXPO_PUBLIC_API_CANDIDATES ?? '')
	.split(',')
	.map((value) => value.trim())
	.filter(Boolean);

export const API_BASE = ENV_API_BASE || 'http://127.0.0.1:8001';

const getExpoHostUri = (): string =>
	Constants.expoConfig?.hostUri ||
	(Constants as { manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } } }).manifest2?.extra?.expoGo
		?.debuggerHost ||
	(Constants as { manifest?: { debuggerHost?: string } }).manifest?.debuggerHost ||
	'';

const deriveLanBase = (hostUri: string): string | null => {
	if (!hostUri) return null;
	const host = hostUri.split(':')[0]?.trim();
	if (!host) return null;
	return `http://${host}:8001`;
};

const getApiBaseCandidates = (): string[] => {
	const hostUri = getExpoHostUri();
	const lanBase = deriveLanBase(hostUri);

	return Array.from(
		new Set(
			[
				persistedApiBase,
				ENV_API_BASE,
				lanBase,
				...ENV_API_CANDIDATES,
				API_BASE,
				'http://192.168.1.113:8001',
				
			]
				.filter((value): value is string => !!value)
				.map((value) => value.trim())
		)
	);
};

// Diagnostic export for debug/troubleshooting screens
export const getNetworkDiagnostics = () => {
	const hostUri = getExpoHostUri();
	const candidates = getApiBaseCandidates();
	return {
		expo_host_uri: hostUri,
		derived_lan_base: deriveLanBase(hostUri),
		env_api_base: ENV_API_BASE,
		env_api_candidates: ENV_API_CANDIDATES,
		all_candidates: candidates,
		preferred_base: preferredBase,
		default_timeout_ms: DEFAULT_TIMEOUT_MS,
	};
};

// AsyncStorage for persisting manually-set API base across network changes
let persistedApiBase: string | null = null;

export const setPersistedApiBase = async (base: string | null) => {
	persistedApiBase = base;
	try {
		const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
		if (base) {
			await AsyncStorage.setItem('api_base_override', base);
		} else {
			await AsyncStorage.removeItem('api_base_override');
		}
		console.log(`[API] Persisted API base: ${base || '(cleared)'}`);
	} catch (error) {
		console.warn('[API] Failed to persist API base:', error);
	}
};

export const loadPersistedApiBase = async (): Promise<string | null> => {
	try {
		const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
		const stored = await AsyncStorage.getItem('api_base_override');
		if (stored) {
			persistedApiBase = stored;
			console.log(`[API] Loaded persisted API base: ${stored}`);
		}
		return stored;
	} catch (error) {
		console.warn('[API] Failed to load persisted API base:', error);
		return null;
	}
};

// Try multiple hosts to support emulator/simulator, USB device, and LAN IP changes.
export const API_BASE_CANDIDATES = getApiBaseCandidates();

const DEFAULT_TIMEOUT_MS = 4500;

let preferredBase: string | null = null;

export const getResolvedApiBase = (): string => preferredBase || API_BASE;

export const toApiUrl = (input: string): string => {
	const raw = (input || '').trim();
	if (!raw) return raw;
	if (/^https?:\/\//i.test(raw)) return raw;
	const normalized = raw.startsWith('/') ? raw : `/${raw}`;
	return `${getResolvedApiBase()}${normalized}`;
};

const getOrderedBases = (): string[] => {
	const uniqueBases = Array.from(new Set(getApiBaseCandidates()));
	if (!preferredBase) {
		// Prioritize persisted base if set
		if (persistedApiBase && uniqueBases.includes(persistedApiBase)) {
			return [persistedApiBase, ...uniqueBases.filter((base) => base !== persistedApiBase)];
		}
		return uniqueBases;
	}
	return [preferredBase, ...uniqueBases.filter((base) => base !== preferredBase)];
};

const shouldTryNextBase = (response: Response, normalizedPath: string): boolean => {
	if (!normalizedPath.startsWith('/api/')) return false;

	const contentType = (response.headers.get('content-type') || '').toLowerCase();
	const isHtml = contentType.includes('text/html');
	const isWrongRouteStatus = response.status === 404 || response.status === 405;

	// HTML pages and missing API routes are usually responses from a non-API host.
	return isHtml || isWrongRouteStatus;
};

const timedFetch = async (url: string, init: RequestInit, timeoutMs: number): Promise<Response> => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
};

export async function requestApi(
	path: string,
	init: RequestInit = {},
	options: { requireOk?: boolean; timeoutMs?: number } = {}
): Promise<Response> {
	const normalizedPath = path.startsWith('/') ? path : `/${path}`;
	const requireOk = options.requireOk ?? false;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const candidates = getOrderedBases();

	let lastHttpResponse: Response | null = null;
	let lastNetworkError: unknown = null;
	const attemptLog: Array<{ base: string; status: string; error?: string }> = [];
	const logAttempt = (base: string, status: string, error?: string) => {
		attemptLog.push({ base, status, error });
		const level = status === 'success' ? 'log' : status === 'skipped' ? 'log' : 'warn';
		console[level](
			`[API] ${status.toUpperCase()} ${base}${normalizedPath} (timeout=${timeoutMs}ms) ${error ? `- ${error}` : ''}`
		);
	};

	for (const base of candidates) {
		try {
			const response = await timedFetch(`${base}${normalizedPath}`, init, timeoutMs);

			if (shouldTryNextBase(response, normalizedPath)) {
				lastHttpResponse = response;
				logAttempt(base, 'wrong_host', `HTTP ${response.status} (HTML content)`);
				continue;
			}

			preferredBase = base;
			logAttempt(base, 'success', `HTTP ${response.status}`);

			if (requireOk && !response.ok) {
				logAttempt(base, 'not_ok', `HTTP ${response.status} but requireOk=true`);
				lastHttpResponse = response;
				continue;
			}

			console.log(`[API] Resolved API base to: ${base}`);
			return response;
		} catch (error) {
			lastNetworkError = error;
			const errorMsg =
				error instanceof Error
					? error.message
					: error && typeof error === 'object' && 'code' in error
					? (error as { code?: string }).code || JSON.stringify(error)
					: String(error);
			logAttempt(base, 'failed', errorMsg);
			// Try next candidate host.
		}
	}

	if (lastHttpResponse) {
		console.warn(`[API] All hosts exhausted. Returning last HTTP response: ${lastHttpResponse.status}`);
		return lastHttpResponse;
	}

	console.error('[API] Network Diagnostics:', {
		path: normalizedPath,
		timeout_ms: timeoutMs,
		candidates_tried: candidates.length,
		attempt_log: attemptLog,
		expo_host_uri: getExpoHostUri(),
		preferred_base: preferredBase,
		last_error: lastNetworkError instanceof Error ? lastNetworkError.message : String(lastNetworkError),
	});

	const errorText =
		lastNetworkError instanceof Error && lastNetworkError.message
			? ` Last error: ${lastNetworkError.message}`
			: '';
	throw new Error(
		`Network request failed. Tried ${candidates.length} hosts (${candidates.join(', ')}).${errorText}`
	);
}
