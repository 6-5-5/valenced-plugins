import { enabledProviders, languageFamily } from './config'
import { detectionSample } from './text'
import type { Settings } from './config'
import type { Display, Message } from './renderer'
import type { TranslationService } from './service'

export interface IncomingMessage extends Message {
	author?: { id?: string }
	type?: number
}

export function createAutoTranslate(
	settings: () => Settings,
	context: () => { channelId?: string; userId?: string; active: boolean },
	service: TranslationService,
	display: Display,
	available: () => boolean,
) {
	const seen = new Map<string, IncomingMessage>()
	const queue = new Map<string, IncomingMessage>()
	let running:
		| { message: IncomingMessage; controller: AbortController }
		| undefined
	let scheduled = false
	let stopped = false
	let retryAfter = 0

	function eligible(message: IncomingMessage) {
		const current = context()
		return (
			!stopped &&
			Date.now() >= retryAfter &&
			current.active &&
			typeof current.userId === 'string' &&
			!!current.userId &&
			typeof message.id === 'string' &&
			!!message.id &&
			typeof message.channel_id === 'string' &&
			current.channelId === message.channel_id &&
			settings().autoChannels?.some(
				channel => channel.id === message.channel_id,
			) &&
			typeof message.author?.id === 'string' &&
			!!message.author.id &&
			message.author.id !== current.userId &&
			(message.type === undefined ||
				message.type === 0 ||
				message.type === 19) &&
			typeof message.content === 'string' &&
			message.content.length <= 4000 &&
			!!message.content.trim() &&
			!display.get(message) &&
			available()
		)
	}

	function schedule() {
		if (scheduled || running || stopped || !queue.size) return
		scheduled = true
		void Promise.resolve().then(drain)
	}

	async function drain() {
		scheduled = false
		if (running || stopped) return
		const message = queue.values().next().value
		if (!message) return
		queue.delete(message.id!)
		try {
			if (!eligible(message)) return
			const sample = detectionSample(message.content!)
			if (!sample) return
			const controller = new AbortController()
			const job = { message, controller }
			running = job
			try {
				const config = settings()
				const understood = [
					config.target,
					...(config.understoodLanguages ?? []),
				]
				if ((sample.match(/\p{L}/gu)?.length ?? 0) >= 40) {
					const { needsTranslation } = await import('./detection')
					if (!needsTranslation(sample, understood)) return
				}
				if (controller.signal.aborted || !eligible(message)) return
				const apply = display.prepare(message)
				const result = await service.translateWithFallback(
					config,
					enabledProviders(config)[0],
					message.content!,
					config.target,
					controller.signal,
				)
				if (
					result.text === message.content ||
					(result.source &&
						understood.some(
							code => languageFamily(code) === languageFamily(result.source!),
						))
				)
					return
				if (!controller.signal.aborted && eligible(message)) apply(result)
			} catch {
				if (!controller.signal.aborted) {
					retryAfter = Date.now() + 30000
					queue.clear()
				}
			} finally {
				if (running === job) running = undefined
			}
		} catch {
			return
		} finally {
			schedule()
		}
	}

	function reset() {
		running?.controller.abort()
		running = undefined
		queue.clear()
		seen.clear()
		retryAfter = 0
	}

	function receive(message: IncomingMessage) {
		if (!eligible(message)) return
		const previous = seen.get(message.id!)
		if (previous?.content === message.content) return
		if (running && running.message.id === message.id) {
			running.controller.abort()
			running = undefined
		}
		const snapshot: IncomingMessage = {
			id: message.id,
			channel_id: message.channel_id,
			content: message.content,
			type: message.type,
			author: { id: message.author!.id },
		}
		seen.set(message.id!, snapshot)
		if (seen.size > 64) seen.delete(seen.keys().next().value!)
		queue.set(message.id!, snapshot)
		if (queue.size > 8) queue.delete(queue.keys().next().value!)
		schedule()
	}

	return {
		receive,
		update(message: IncomingMessage) {
			display.update(message)
			const original =
				message.id &&
				(seen.get(message.id) ??
					(running?.message.id === message.id ? running.message : undefined))
			if (!original || typeof message.content !== 'string') return
			if (original.content === message.content) return
			this.remove(message.id!)
			receive({ ...original, ...message })
		},
		remove(id: string) {
			if (running?.message.id === id) {
				running.controller.abort()
				running = undefined
			}
			queue.delete(id)
			seen.delete(id)
			schedule()
		},
		reset,
		stop() {
			stopped = true
			reset()
		},
	}
}
