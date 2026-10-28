import {
	ActionSheetActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { createElement, isValidElement } from 'react'
import { appendAction } from './actionsheet'
import { Defaults } from './config'
import { TranslateIconSource } from './icon'
import type { JsonStorage } from '@valenced/json-storage'
import type { FC, ReactElement, ReactNode } from 'react'
import type { Settings } from './config'
import type { Channel } from './incoming'

type ChannelSheetProps = {
	channel?: Channel
	channelId?: string
	onClose?: () => void
}
type ChannelSheet = FC<ChannelSheetProps>

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

export function patchChannels(
	storage: JsonStorage<Settings>,
	getChannel: (id: string) => Channel | undefined,
	cleanup: (...callbacks: (() => void)[]) => void,
) {
	const patched = new WeakSet<object>()
	const wrappers = new WeakMap<ChannelSheet, ChannelSheet>()
	let active = true
	cleanup(() => {
		active = false
	})
	function wrap(Inner: ChannelSheet) {
		let Wrapper = wrappers.get(Inner)
		if (!Wrapper) {
			Wrapper = props => {
				const tree = Inner(props)
				if (!active) return tree
				try {
					const { ActionSheetRow } = Design
					const channel =
						props.channel ??
						(props.channelId ? getChannel(props.channelId) : undefined)
					if (
						!channel?.id ||
						![0, 1, 3, 5, 10, 11, 12].includes(channel.type ?? -1)
					)
						return tree
					const enabled = { ...Defaults, ...storage.cache }.autoChannels?.some(
						value => value.id === channel.id,
					)
					return appendAction(
						tree as ReactNode,
						<ActionSheetRow.Group key="valate-auto-translate">
							<ActionSheetRow
								label={
									enabled ? 'Disable auto-translate' : 'Enable auto-translate'
								}
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
						</ActionSheetRow.Group>,
					)
				} catch {
					return tree
				}
			}
			// Preserve the name expected by other channel-menu plugins, including Message Logger.
			Object.defineProperty(Wrapper, 'name', {
				value: 'ChannelLongPressActionSheetConnected',
			})
			wrappers.set(Inner, Wrapper)
		}
		return Wrapper
	}
	cleanup(
		getModules(
			withName<ChannelSheet>('ChannelLongPressActionSheet'),
			exports => {
				const module = exports as { default: ChannelSheet }
				if (patched.has(module)) return
				patched.add(module)
				cleanup(
					instead(module, 'default', function (args, original) {
						const tree = Reflect.apply(
							original,
							this,
							args,
						) as ReactElement<ChannelSheetProps> | null
						if (!active || !isValidElement(tree)) return tree
						const Inner = tree.type
						if (typeof Inner !== 'function' || Inner === Design.ActionSheet)
							return tree
						return createElement(wrap(Inner as ChannelSheet), {
							...tree.props,
							key: tree.key,
						})
					}),
				)
			},
			{ returnNamespace: true },
		),
	)
}
