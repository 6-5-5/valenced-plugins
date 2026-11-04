import { Dispatcher } from '@valenced/discord/common/flux'
import { getStore } from '@valenced/discord/flux'
import { AppState } from 'react-native'
import { createAutoTranslate } from './auto'
import { Defaults } from './config'
import { watchChannelRemoval } from './incoming/channels'
import type { JsonStorage } from '@valenced/json-storage'
import type { IncomingMessage } from './auto'
import type { Settings } from './config'
import type { patchRenderer } from './renderer'
import type { TranslationService } from './service'

export interface Channel {
	id: string
	guild_id?: string
	type?: number
}

export function watchIncoming(
	storage: JsonStorage<Settings>,
	service: TranslationService,
	renderer: ReturnType<typeof patchRenderer>,
	cleanup: (...callbacks: (() => void)[]) => void,
) {
	let selected: { getChannelId(): string | undefined } | undefined
	let users: { getCurrentUser(): { id: string } | undefined } | undefined
	let channels: { getChannel(id: string): Channel | undefined } | undefined
	let messages:
		| { getMessages(id: string): { _array?: IncomingMessage[] } | undefined }
		| undefined
	let active = AppState.currentState === 'active'
	let focused = true
	let stopped = false
	let recentChannel: string | undefined
	let recentScheduled = false
	const settings = () => ({ ...Defaults, ...storage.cache })
	const auto = createAutoTranslate(
		settings,
		() => ({
			channelId: selected?.getChannelId?.(),
			userId: users?.getCurrentUser?.()?.id,
			active: active && focused,
		}),
		service,
		renderer.display,
		renderer.available,
	)
	function checkRecent() {
		if (
			recentScheduled ||
			stopped ||
			!active ||
			!focused ||
			recentChannel === selected?.getChannelId?.()
		)
			return
		recentScheduled = true
		void Promise.resolve().then(() => {
			recentScheduled = false
			if (
				stopped ||
				!active ||
				!focused ||
				!renderer.available() ||
				!users?.getCurrentUser?.()?.id
			)
				return
			const id = selected?.getChannelId?.()
			if (
				!id ||
				recentChannel === id ||
				!settings().autoChannels?.some(channel => channel.id === id)
			)
				return
			try {
				const loaded = messages?.getMessages?.(id)?._array
				if (!Array.isArray(loaded) || !loaded.length) return
				const first = loaded[0].id
				const last = loaded[loaded.length - 1].id
				if (
					!first ||
					!last ||
					!/^\d{1,20}$/.test(first) ||
					!/^\d{1,20}$/.test(last)
				)
					return
				const latest =
					BigInt(first) > BigInt(last)
						? loaded.slice(0, 8).reverse()
						: loaded.slice(-8)
				recentChannel = id
				for (const message of latest) auto.receive(message)
			} catch {
				return
			}
		})
	}
	function reset() {
		auto.reset()
		recentChannel = undefined
		checkRecent()
	}
	cleanup(() => {
		stopped = true
		auto.stop()
	}, storage.subscribe(reset))
	cleanup(
		getStore<{ getChannelId(): string | undefined }>(
			'SelectedChannelStore',
			store => {
				selected = store
				let id = store.getChannelId?.()
				const changed = () => {
					const next = store.getChannelId?.()
					if (next === id) return
					id = next
					reset()
				}
				store.addChangeListener(changed)
				cleanup(() => store.removeChangeListener(changed))
				checkRecent()
			},
		),
		getStore<{ getCurrentUser(): { id: string } | undefined }>(
			'UserStore',
			store => {
				users = store
				let id = store.getCurrentUser?.()?.id
				const changed = () => {
					const next = store.getCurrentUser?.()?.id
					if (next === id) return
					id = next
					reset()
				}
				store.addChangeListener(changed)
				cleanup(() => store.removeChangeListener(changed))
				checkRecent()
			},
		),
		getStore<{ getChannel(id: string): Channel | undefined }>(
			'ChannelStore',
			store => {
				channels = store
			},
		),
		getStore<{
			getMessages(id: string): { _array?: IncomingMessage[] } | undefined
		}>('MessageStore', store => {
			messages = store
			store.addChangeListener(checkRecent)
			cleanup(() => store.removeChangeListener(checkRecent))
			checkRecent()
		}),
	)
	const state = AppState.addEventListener('change', value => {
		active = value === 'active'
		reset()
	})
	const blur = AppState.addEventListener('blur', () => {
		focused = false
		reset()
	})
	const focus = AppState.addEventListener('focus', () => {
		focused = true
		checkRecent()
	})
	cleanup(
		() => state.remove(),
		() => blur.remove(),
		() => focus.remove(),
	)

	function subscribe(
		type: string,
		callback: (event: Record<string, any>) => void,
	) {
		Dispatcher.subscribe(type, callback)
		cleanup(() => Dispatcher.unsubscribe(type, callback))
	}
	subscribe('MESSAGE_CREATE', event => {
		if (!event.optimistic && !event.isPush && event.message)
			auto.receive(event.message as IncomingMessage)
	})
	subscribe('MESSAGE_UPDATE', event => {
		if (event.message) auto.update(event.message as IncomingMessage)
	})
	subscribe('MESSAGE_DELETE', event => {
		if (typeof event.id === 'string') auto.remove(event.id)
	})
	subscribe('MESSAGE_DELETE_BULK', event => {
		if (!Array.isArray(event.ids)) return
		for (const id of event.ids) {
			if (typeof id === 'string') auto.remove(id)
		}
	})
	subscribe('CHANNEL_SELECT', reset)
	subscribe('CONNECTION_CLOSED', auto.reset)
	subscribe('LOGOUT', auto.reset)
	watchChannelRemoval(storage, auto.reset, subscribe)
	return (id: string) => channels?.getChannel?.(id)
}
