import { enabledProviders, validateTarget } from './config'
import { ProviderError, translate } from './providers'
import { protect } from './text'
import type { Provider, Settings } from './config'
import type { Translation } from './providers'

export function createService() {
	const cache = new Map<string, { result: Translation; expires: number }>()
	const jobs = new Map<
		string,
		{
			controller: AbortController
			promise: Promise<Translation>
			users: number
		}
	>()
	const cooldowns = new Map<Provider, number>()
	const runs = new Set<AbortController>()
	return {
		clear() {
			for (const run of runs) run.abort()
			runs.clear()
			for (const job of jobs.values()) job.controller.abort()
			jobs.clear()
			cache.clear()
			cooldowns.clear()
		},
		async translateWithFallback(
			settings: Settings,
			provider: Provider,
			text: string,
			target: string,
			signal: AbortSignal,
			retry = false,
		): Promise<Translation> {
			validateTarget(target)
			if (signal.aborted) throw new Error('Request cancelled.')
			const controller = new AbortController()
			const abort = () => controller.abort()
			signal.addEventListener('abort', abort, { once: true })
			runs.add(controller)
			const timer = setTimeout(abort, 45000)
			let failure: unknown = new Error('No enabled provider is available.')
			try {
				const enabled = enabledProviders(settings)
				const order = [...new Set([provider, ...enabled])].filter(value =>
					enabled.includes(value),
				)
				for (const value of order) {
					try {
						return await this.translate(
							settings,
							value,
							text,
							target,
							controller.signal,
							retry,
						)
					} catch (error) {
						if (controller.signal.aborted)
							throw new Error('Request cancelled or timed out.')
						failure = error
					}
				}
				throw failure
			} finally {
				clearTimeout(timer)
				signal.removeEventListener('abort', abort)
				runs.delete(controller)
			}
		},
		async translate(
			settings: Settings,
			provider: Provider,
			text: string,
			target: string,
			signal: AbortSignal,
			retry = false,
		): Promise<Translation> {
			validateTarget(target)
			if (signal.aborted) throw new Error('Request cancelled.')
			if (!text.trim())
				throw new Error('This message has no text to translate.')
			if (text.length > 4000)
				throw new Error('Messages over 4,000 characters are not supported.')
			const key = JSON.stringify([
				provider,
				settings[provider === 'google' ? 'target' : provider],
				text,
				target,
			])
			const cached = cache.get(key)
			if (!retry && cached && cached.expires > Date.now()) return cached.result
			if ((cooldowns.get(provider) ?? 0) > Date.now())
				throw new Error('Provider is rate limited. Wait before trying again.')
			let job = jobs.get(key)
			if (!job) {
				if (jobs.size >= 3)
					throw new Error(
						'A translation is already running. Try again shortly.',
					)
				const protectedText = protect(text)
				if (!protectedText.hasText)
					return { text: protectedText.restore(protectedText.masked), provider }
				const controller = new AbortController()
				const timer = setTimeout(
					() => controller.abort(),
					provider === 'oai' ? 30000 : 15000,
				)
				const promise = translate(
					settings,
					provider,
					protectedText.masked,
					target,
					controller.signal,
				)
					.then(result => {
						if (controller.signal.aborted)
							throw new Error('Request cancelled or timed out.')
						result = { ...result, text: protectedText.restore(result.text) }
						cache.set(key, { result, expires: Date.now() + 300000 })
						if (cache.size > 32) cache.delete(cache.keys().next().value!)
						return result
					})
					.catch(error => {
						if (
							!controller.signal.aborted &&
							error instanceof ProviderError &&
							error.cooldown
						)
							cooldowns.set(provider, Date.now() + error.cooldown)
						throw error
					})
					.finally(() => {
						clearTimeout(timer)
						if (jobs.get(key)?.controller === controller) jobs.delete(key)
					})
				job = { controller, promise, users: 0 }
				jobs.set(key, job)
			}
			const current = job
			current.users++
			return new Promise((resolve, reject) => {
				let done = false
				const finish = () => {
					if (done) return false
					done = true
					signal.removeEventListener('abort', abort)
					if (--current.users === 0) {
						current.controller.abort()
						if (jobs.get(key) === current) jobs.delete(key)
					}
					return true
				}
				const abort = () => {
					if (finish()) reject(new Error('Request cancelled.'))
				}
				signal.addEventListener('abort', abort, { once: true })
				current.promise.then(
					result => {
						if (finish()) resolve(result)
					},
					error => {
						if (finish()) reject(error)
					},
				)
			})
		},
	}
}

export type TranslationService = ReturnType<typeof createService>
