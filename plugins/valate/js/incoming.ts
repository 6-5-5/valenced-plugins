import { ToastActionCreators } from '@valenced/discord/actions'
import { Dispatcher } from '@valenced/discord/common/flux'
import { getStore } from '@valenced/discord/flux'
import { AppState } from 'react-native'
import { createAutoTranslate } from './auto'
import { Defaults } from './config'
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
				// shortcut: chronological _array cache only; update if Discord changes its message collection.
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
	async function removeChannels(
		matches: (
			channel: NonNullable<Settings['autoChannels']>[number],
		) => boolean,
	) {
		const current = settings().autoChannels ?? []
		const remaining = current.filter(channel => !matches(channel))
		if (current.length === remaining.length) return
		auto.reset()
		try {
			await storage.set({ autoChannels: remaining })
		} catch {
			ToastActionCreators.open('valate-auto-translate-error', {
				text: 'Could not remove auto-translate channels.',
				variant: 'critical',
			})
		}
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
	subscribe('CONNECTION_OPEN', event => {
		auto.reset()
		if (
			!Array.isArray(event.guilds) ||
			event.guilds.some(guild => typeof guild?.id !== 'string')
		)
			return
		const guildIds = new Set(event.guilds.map(guild => guild.id))
		void removeChannels(
			channel => !!channel.guildId && !guildIds.has(channel.guildId),
		)
	})
	subscribe('LOGOUT', auto.reset)
	subscribe('GUILD_DELETE', event => {
		const guild = event.guild ?? event
		if (
			typeof guild.id === 'string' &&
			!guild.unavailable &&
			!event.unavailable
		)
			void removeChannels(channel => channel.guildId === guild.id)
	})
	subscribe('CHANNEL_DELETE', event => {
		if (typeof event.channel?.id === 'string')
			void removeChannels(channel => channel.id === event.channel.id)
	})
	return (id: string) => channels?.getChannel?.(id)
}
