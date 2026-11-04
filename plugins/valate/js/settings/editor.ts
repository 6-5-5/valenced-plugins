import { baseUrl, Defaults, validateProvider, validateTarget } from '../config'
import type { JsonStorage } from '@valenced/json-storage'
import type { Provider, Settings } from '../config'

export type SettingsPage =
	| Provider
	| 'language'
	| 'priority'
	| 'channels'
	| null

export class SettingsFieldError extends Error {
	constructor(
		public field: string,
		message: string,
	) {
		super(message)
	}
}

function settingsPatch(draft: Settings, page: SettingsPage) {
	let field = 'target'
	try {
		if (page === 'language')
			return { target: validateTarget(draft.target.trim()) }
		if (page === 'channels') {
			field = 'understoodLanguages'
			const understoodLanguages = [...new Set(draft.understoodLanguages ?? [])]
			for (const code of understoodLanguages) validateTarget(code)
			return { understoodLanguages }
		}
		if (!page || page === 'priority') return
		if (page === 'google') return { google: draft.google }
		const config = { ...draft[page] }
		field = 'key'
		if (/[\r\n]/.test(config.key))
			throw new Error('The API key contains a line break.')
		if (page === 'deepl') {
			if (draft.deepl.enabled) validateProvider(draft, page)
			return { deepl: config }
		}
		field = 'url'
		const provider = page === 'oai' ? draft.oai : draft.libre
		if (provider.url.trim() || provider.enabled)
			Object.assign(config, { url: baseUrl(provider.url) })
		if (page === 'oai') {
			field = 'model'
			if (draft.oai.model.length > 200 || /[\r\n]/.test(draft.oai.model))
				throw new Error('Enter a valid model ID.')
			if (draft.oai.enabled) validateProvider(draft, page)
		}
		return { [page]: config }
	} catch (error) {
		throw new SettingsFieldError(field, (error as Error).message)
	}
}

export function createSettingsEditor(
	storage: JsonStorage<Settings>,
	page: SettingsPage,
) {
	let draft = { ...Defaults, ...storage.cache }
	let saved = JSON.stringify(value())
	let queue = Promise.resolve()
	let pending: { value: string; promise: Promise<void> } | undefined
	function value() {
		if (page === 'language') return { target: draft.target }
		if (page === 'channels')
			return { understoodLanguages: draft.understoodLanguages ?? [] }
		if (!page || page === 'priority') return {}
		return { [page]: draft[page] }
	}
	function save(patch: Parameters<typeof storage.set>[0], raw: string) {
		const promise = queue
			.catch(() => {})
			.then(() => storage.set(patch))
			.then(() => {
				saved = raw
			})
		queue = promise
		pending = { value: raw, promise }
		return promise.finally(() => {
			if (pending?.promise === promise) pending = undefined
		})
	}
	return {
		get draft() {
			return draft
		},
		change(next: Settings) {
			draft = next
		},
		provider(provider: Provider, patch: Record<string, string | boolean>) {
			const current = draft[provider]
			if ('url' in patch && 'url' in current && patch.url !== current.url) {
				patch = {
					...patch,
					key: '',
					...(provider === 'oai' ? { model: '' } : {}),
				}
			}
			draft = { ...draft, [provider]: { ...current, ...patch } }
			return draft
		},
		disable(provider: Provider) {
			return save({ [provider]: { enabled: false } }, '')
		},
		async commit() {
			const raw = JSON.stringify(value())
			if (raw === saved && !pending) return
			if (pending?.value === raw) return pending.promise
			const patch = settingsPatch(draft, page)
			if (!patch) return
			return save(patch, raw)
		},
	}
}
