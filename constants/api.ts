import Constants from 'expo-constants';

const DEFAULT_REMOTE_API_BASE = 'https://muscan-admin-api.onrender.com';

const ENV_API_BASE = process.env.EXPO_PUBLIC_API_BASE?.trim();
const ENV_API_FALLBACK = process.env.EXPO_PUBLIC_API_FALLBACK?.trim();
const ENV_API_CANDIDATES = (process.env.EXPO_PUBLIC_API_CANDIDATES ?? '')
	.split(',')
	.map((value) => value.trim())
	.filter(Boolean);

export const API_BASE = ENV_API_BASE || DEFAULT_REMOTE_API_BASE;

type CandidateSource =
	| 'persisted_override'
	| 'env_api_base'
	| 'env_api_fallback'
	| 'env_api_candidates'
	| 'default_api_base'
	| 'derived_lan';

type CandidateEntry = {
	base: string;
	source: CandidateSource;
};

// AsyncStorage for persisting manually-set API base across network changes
let persistedApiBase: string | null = null;

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

const pushCandidate = (
	target: CandidateEntry[],
	value: string | null | undefined,
	source: CandidateSource
) => {
	const trimmed = String(value || '').trim();
	if (!trimmed) return;
	target.push({ base: trimmed, source });
};

const getApiCandidateEntries = (): CandidateEntry[] => {
	const hostUri = getExpoHostUri();
	const lanBase = deriveLanBase(hostUri);
	const entries: CandidateEntry[] = [];

	pushCandidate(entries, persistedApiBase, 'persisted_override');
	pushCandidate(entries, ENV_API_BASE, 'env_api_base');
	pushCandidate(entries, ENV_API_FALLBACK, 'env_api_fallback');
	for (const candidate of ENV_API_CANDIDATES) {
		pushCandidate(entries, candidate, 'env_api_candidates');
	}
	pushCandidate(entries, API_BASE, 'default_api_base');
	pushCandidate(entries, lanBase, 'derived_lan');

	return entries;
};

const getApiBaseCandidates = (): string[] => {
	return Array.from(new Set(getApiCandidateEntries().map((entry) => entry.base)));
};

const isApiDebugEnabled = typeof __DEV__ !== 'undefined' && __DEV__;

const apiLog = (level: 'log' | 'warn' | 'error', ...args: unknown[]) => {
	if (!isApiDebugEnabled) return;
	const logger = console[level] ?? console.log;
	logger(...args);
};

// Diagnostic export for debug/troubleshooting screens
export const getNetworkDiagnostics = () => {
	const hostUri = getExpoHostUri();
	const entries = getApiCandidateEntries();
	const grouped = new Map<string, Set<CandidateSource>>();
	for (const entry of entries) {
		if (!grouped.has(entry.base)) {
			grouped.set(entry.base, new Set<CandidateSource>());
		}
		grouped.get(entry.base)?.add(entry.source);
	}
	const candidateDetails = Array.from(grouped.entries()).map(([base, sources]) => ({
		base,
		sources: Array.from(sources),
	}));
	const candidates = candidateDetails.map((item) => item.base);
	return {
		expo_host_uri: hostUri,
		derived_lan_base: deriveLanBase(hostUri),
		persisted_override: persistedApiBase,
		env_api_base: ENV_API_BASE,
		env_api_fallback: ENV_API_FALLBACK,
		env_api_candidates: ENV_API_CANDIDATES,
		default_remote_api_base: DEFAULT_REMOTE_API_BASE,
		all_candidates: candidates,
		candidate_details: candidateDetails,
		preferred_base: preferredBase,
		default_timeout_ms: DEFAULT_TIMEOUT_MS,
	};
};

export const setPersistedApiBase = async (base: string | null) => {
	persistedApiBase = base;
	try {
		const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
		if (base) {
			await AsyncStorage.setItem('api_base_override', base);
		} else {
			await AsyncStorage.removeItem('api_base_override');
		}
		apiLog('log', `[API] Persisted API base: ${base || '(cleared)'}`);
	} catch (error) {
		apiLog('warn', '[API] Failed to persist API base:', error);
	}
};

export const loadPersistedApiBase = async (): Promise<string | null> => {
	try {
		const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
		const stored = await AsyncStorage.getItem('api_base_override');
		if (stored) {
			persistedApiBase = stored;
			apiLog('log', `[API] Loaded persisted API base: ${stored}`);
		}
		return stored;
	} catch (error) {
		apiLog('warn', '[API] Failed to load persisted API base:', error);
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
		const level: 'log' | 'warn' = status === 'success' ? 'log' : status === 'skipped' ? 'log' : 'warn';
		apiLog(
			level,
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

			apiLog('log', `[API] Resolved API base to: ${base}`);
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
		apiLog('warn', `[API] All hosts exhausted. Returning last HTTP response: ${lastHttpResponse.status}`);
		return lastHttpResponse;
	}

	apiLog('error', '[API] Network Diagnostics:', {
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
