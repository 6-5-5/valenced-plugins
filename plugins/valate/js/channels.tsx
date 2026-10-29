import {
	ActionSheetActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Defaults } from './config'
import { TranslateIconSource } from './icon'
import type { JsonStorage } from '@valenced/json-storage'
import type { Settings } from './config'
import type { Channel } from './incoming'

export interface ChannelSheetProps {
	channel?: Channel
	channelId?: string
	onClose?: () => void
}

export async function removeChannel(
	storage: JsonStorage<Settings>,
	id: string,
) {
	await storage.set({
		autoChannels: ({ ...Defaults, ...storage.cache }.autoChannels ?? []).filter(
			channel => channel.id !== id,
		),
	})
}

export async function toggleChannel(
	storage: JsonStorage<Settings>,
	channel: Channel,
) {
	if (
		!/^\d{1,20}$/.test(channel.id) ||
		(channel.guild_id && !/^\d{1,20}$/.test(channel.guild_id))
	)
		throw new Error('This channel cannot be configured.')
	const current = { ...Defaults, ...storage.cache }.autoChannels ?? []
	const enabled = current.some(value => value.id === channel.id)
	if (enabled) return removeChannel(storage, channel.id)
	await storage.set({
		autoChannels: [...current, { id: channel.id, guildId: channel.guild_id }],
	})
}

export function createChannelAction(
	storage: JsonStorage<Settings>,
	getChannel: (id: string) => Channel | undefined,
	cleanup: (...callbacks: (() => void)[]) => void,
) {
	let active = true
	cleanup(() => {
		active = false
	})
	return (props: ChannelSheetProps) => {
		if (!active) return null
		try {
			const { ActionSheetRow } = Design
			const channel =
				props.channel ??
				(props.channelId ? getChannel(props.channelId) : undefined)
			if (
				!channel?.id ||
				![0, 1, 3, 5, 10, 11, 12].includes(channel.type ?? -1)
			)
				return null
			const enabled = { ...Defaults, ...storage.cache }.autoChannels?.some(
				value => value.id === channel.id,
			)
			return (
				<ActionSheetRow
					label={enabled ? 'Disable auto-translate' : 'Enable auto-translate'}
					icon={<ActionSheetRow.Icon source={TranslateIconSource} />}
					onPress={async () => {
						if (!active) return
						if (props.onClose) props.onClose()
						else ActionSheetActionCreators.hideActionSheet()
						try {
							await toggleChannel(storage, channel)
						} catch {
							ToastActionCreators.open('valate-auto-translate-error', {
								text: 'Could not save auto-translate channels.',
								variant: 'critical',
							})
						}
					}}
				/>
			)
		} catch {
			return null
		}
	}
}
