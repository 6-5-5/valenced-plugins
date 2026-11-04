import type { Provider } from '../config'

export interface Translation {
	text: string
	source?: string
	provider: Provider
}

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('The provider returned an invalid response.')
	return value as Record<string, unknown>
}

function string(value: unknown) {
	if (typeof value !== 'string' || !value.trim() || value.length > 32000)
		throw new Error('The provider returned an empty or invalid translation.')
	return value
}

export function parseTranslation(
	provider: Provider,
	body: unknown,
): Omit<Translation, 'provider'> {
	if (provider === 'google') {
		if (!Array.isArray(body) || !Array.isArray(body[0]) || !body[0].length)
			throw new Error('Google returned an invalid translation.')
		return {
			text: string(
				body[0]
					.map((part: unknown) => {
						if (!Array.isArray(part) || typeof part[0] !== 'string')
							throw new Error(
								'Google returned incomplete translation segments.',
							)
						return part[0]
					})
					.join(''),
			),
			source: typeof body[2] === 'string' ? body[2] : undefined,
		}
	}
	const data = object(body)
	if (provider === 'deepl') {
		if (!Array.isArray(data.translations) || data.translations.length !== 1)
			throw new Error('DeepL returned incomplete translation results.')
		const item = object(data.translations[0])
		return {
			text: string(item.text),
			source:
				typeof item.detected_source_language === 'string'
					? item.detected_source_language
					: undefined,
		}
	}
	if (provider === 'libre') {
		const detected = data.detectedLanguage
		const source =
			detected && typeof detected === 'object'
				? object(detected).language
				: undefined
		return {
			text: string(data.translatedText),
			source: typeof source === 'string' ? source : undefined,
		}
	}
	if (!Array.isArray(data.choices) || !data.choices.length)
		throw new Error('The model returned no translation.')
	const choice = object(data.choices[0])
	if (choice.finish_reason !== 'stop')
		throw new Error(
			'The model returned an incomplete or refused translation. Try another model.',
		)
	const message = object(choice.message)
	if (message.refusal || message.tool_calls)
		throw new Error('The model did not return a translation.')
	return { text: string(message.content) }
}

export function parseModels(body: unknown) {
	const data = object(body)
	if (!Array.isArray(data.data))
		throw new Error(
			'This endpoint does not provide an OpenAI-compatible model list. Enter a model manually.',
		)
	const models = data.data.map(item => {
		const id = object(item).id
		if (
			typeof id !== 'string' ||
			!id.trim() ||
			id.length > 200 ||
			/[\r\n]/.test(id)
		)
			throw new Error('The provider returned an invalid model list.')
		return id
	})
	if (models.length > 5000)
		throw new Error('The model list is too large. Enter a model manually.')
	return {
		models: [...new Set(models)].sort(),
		hasMore: data.has_more === true,
	}
}
