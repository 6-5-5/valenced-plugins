import { Dispatcher } from '@valenced/discord/common/flux'
import { getModules } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import type { Translation } from './providers'

export interface Message {
	id?: string
	channel_id?: string
	content?: string
}

function createDisplay(refresh: (message: Message) => void) {
	const entries = new Map<string, { message: Message; result: Translation }>()
	const pending = new Map<
		string,
		{ message: Message; controller: AbortController }
	>()
	const changed = new Set<string>()
	let active = true
	function notify(message: Message) {
		changed.add(message.id!)
		if (changed.size > 64) changed.delete(changed.values().next().value!)
		try {
			refresh(message)
			return true
		} catch {
			return false
		}
	}
	function clear() {
		for (const job of pending.values()) job.controller.abort()
		pending.clear()
		const messages = [...entries.values()].map(entry => entry.message)
		entries.clear()
		for (const message of messages) notify(message)
	}
	function remove(id: string) {
		pending.get(id)?.controller.abort()
		pending.delete(id)
		changed.delete(id)
		return entries.delete(id)
	}
	return {
		get(message: Message) {
			const entry = message.id ? entries.get(message.id) : undefined
			return entry?.message.content === message.content
				? entry?.result
				: undefined
		},
		prepare(message: Message, controller: AbortController) {
			message = { ...message }
			const job = { message, controller }
			if (message.id) {
				pending.get(message.id)?.controller.abort()
				pending.set(message.id, job)
				if (pending.size > 64) {
					const oldest = pending.keys().next().value!
					pending.get(oldest)!.controller.abort()
					pending.delete(oldest)
				}
			}
			return (result: Translation) => {
				if (
					!active ||
					controller.signal.aborted ||
					!message.id ||
					!message.channel_id ||
					pending.get(message.id) !== job
				)
					return false
				pending.delete(message.id)
				entries.set(message.id, { message, result })
				if (entries.size > 32) {
					const oldest = entries.values().next().value!
					entries.delete(oldest.message.id!)
					notify(oldest.message)
				}
				if (notify(message)) return true
				entries.delete(message.id)
				return false
			}
		},
		update(message: Message) {
			if (!message.id || typeof message.content !== 'string') return
			const original =
				pending.get(message.id)?.message ?? entries.get(message.id)?.message
			if (original && original.content !== message.content) remove(message.id)
		},
		revert(message: Message) {
			if (message.id && remove(message.id)) notify(message)
		},
		remove,
		takeChanged(id?: string) {
			return !!id && changed.delete(id)
		},
		clear,
		stop() {
			active = false
			clear()
			changed.clear()
		},
	}
}

export type Display = ReturnType<typeof createDisplay>

interface Row {
	type?: number
	changeType?: number
	message?: { id?: string; edited?: string }
}
interface Args {
	message: Message
}
interface RecordUtils {
	updateMessageRecord(record: Message, update: object): Message
}
interface RowManager {
	generate(args: Args): Row
}

export function renderMessage(
	display: Display,
	args: Args,
	original: (args: Args) => Row,
	utils?: RecordUtils,
) {
	if (!args?.message) return original(args)
	const result = display.get(args.message)
	let rendered = args
	try {
		if (result && utils)
			rendered = {
				...args,
				message: utils.updateMessageRecord(args.message, {
					content: result.text,
				}),
			}
	} catch {}
	let row: Row
	try {
		row = original(rendered)
	} catch (error) {
		if (rendered === args) throw error
		rendered = args
		row = original(args)
	}
	if (rendered !== args && row?.type === 1 && row.message)
		row = {
			...row,
			message: {
				...row.message,
				edited: row.message.edited
					? `${row.message.edited} · translated`
					: 'translated',
			},
		}
	if (row?.type === 1 && display.takeChanged(args.message.id))
		return { ...row, changeType: 2 }
	return row
}

export function patchRenderer(cleanup: (...callbacks: (() => void)[]) => void) {
	const display = createDisplay(message =>
		Dispatcher.dispatch({
			type: 'MESSAGE_UPDATE',
			message: { id: message.id, channel_id: message.channel_id },
		}),
	)
	let utils: RecordUtils | undefined
	let ready = false
	const callbacks: (() => void)[] = []
	callbacks.push(
		getModules(withProps<RecordUtils>('updateMessageRecord'), exports => {
			utils = exports
		}),
		getModules(
			withName<{ prototype: RowManager }>('RowManager'),
			({ prototype }) => {
				callbacks.push(
					instead(prototype, 'generate', function (args, original) {
						return renderMessage(
							display,
							args[0],
							value => original.call(this, value),
							utils,
						)
					}),
				)
				ready = true
			},
		),
	)
	cleanup(() => {
		display.stop()
		for (const callback of callbacks) callback()
	})
	return { display, available: () => ready && !!utils }
}
