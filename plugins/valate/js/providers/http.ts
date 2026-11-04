export class ProviderError extends Error {
	constructor(
		message: string,
		readonly cooldown = 0,
	) {
		super(message)
	}
}

export async function request(
	url: string,
	init: RequestInit,
	signal: AbortSignal,
) {
	try {
		const response = await fetch(url, { ...init, signal, redirect: 'error' })
		if (!response.ok) {
			if (response.status === 429) {
				const retry = response.headers.get('retry-after') ?? ''
				const seconds = /^\d+$/.test(retry)
					? Number(retry)
					: (Date.parse(retry) - Date.now()) / 1000
				throw new ProviderError(
					'Rate limited. Wait before trying again.',
					Math.min(300000, Math.max(30000, (seconds || 0) * 1000)),
				)
			}
			if (response.status === 456)
				throw new ProviderError(
					'DeepL quota exhausted. Check your account.',
					60000,
				)
			if (response.status === 401 || response.status === 403)
				throw new ProviderError(
					'Provider rejected access. Check your key and permissions.',
				)
			throw new ProviderError(
				`Provider request failed (HTTP ${response.status}).`,
			)
		}
		if (
			response.redirected ||
			(response.url && new URL(response.url).origin !== new URL(url).origin)
		)
			throw new ProviderError('Provider redirects are not supported.')
		const body = await response.text()
		if (body.length > 1000000)
			throw new ProviderError('Provider response is too large.')
		try {
			return JSON.parse(body) as unknown
		} catch {
			throw new ProviderError('Provider returned invalid JSON.')
		}
	} catch (error) {
		if (signal.aborted) throw new Error('Request cancelled or timed out.')
		if (error instanceof ProviderError) throw error
		throw new ProviderError(
			'Could not reach the provider. Check your connection and base URL.',
		)
	}
}

export function json(body: unknown, key = '', auth = 'Bearer'): RequestInit {
	return {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(key.trim() ? { Authorization: `${auth} ${key.trim()}` } : {}),
		},
		body: JSON.stringify(body),
	}
}
