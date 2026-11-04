import { ToastActionCreators } from '@valenced/discord/actions'
import type { JsonStorage } from '@valenced/json-storage'
import type { Settings } from '../config'

export function watchChannelRemoval(
	storage: JsonStorage<Settings>,
	reset: () => void,
	subscribe: (
		type: string,
		callback: (event: Record<string, any>) => void,
	) => void,
) {
	async function removeChannels(
		matches: (
			channel: NonNullable<Settings['autoChannels']>[number],
		) => boolean,
	) {
		const current: NonNullable<Settings['autoChannels']> =
			storage.cache?.autoChannels ?? []
		const remaining = current.filter(channel => !matches(channel))
		if (current.length === remaining.length) return
		reset()
		try {
			await storage.set({ autoChannels: remaining })
		} catch {
			ToastActionCreators.open('valate-auto-translate-error', {
				text: 'Could not remove auto-translate channels.',
				variant: 'critical',
			})
		}
	}
	subscribe('CONNECTION_OPEN', event => {
		reset()
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
	subscribe('THREAD_DELETE', event => {
		const thread = event.thread ?? event.channel ?? event
		if (typeof thread.id === 'string')
			void removeChannels(channel => channel.id === thread.id)
	})
}
