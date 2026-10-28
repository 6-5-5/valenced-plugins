import { Design } from '@valenced/discord/design'
import { Stores } from '@valenced/discord/flux'
import type { DiscordModules } from '@valenced/discord/types'
import type { Settings } from './config'

export default function ChannelList({
	channels,
	busy,
	remove,
}: {
	channels: NonNullable<Settings['autoChannels']>
	busy: boolean
	remove(id: string): void
}) {
	const { Button, TableRow, TableRowGroup } = Design
	const channelStore = Stores.ChannelStore as DiscordModules.Flux.Store<{
		getChannel(id: string): { name?: string; recipients?: string[] } | undefined
	}>
	const guildStore = Stores.GuildStore as DiscordModules.Flux.Store<{
		getGuild(id: string): { name?: string } | undefined
	}>
	const userStore = Stores.UserStore as DiscordModules.Flux.Store<{
		getUser(id: string): { globalName?: string; username?: string } | undefined
	}>
	return (
		<TableRowGroup
			description={
				channels.length
					? 'New messages and the latest 8 loaded. Open channel only.'
					: 'Long-press a channel to enable auto-translate.'
			}
		>
			{channels.map(({ id, guildId }) => {
				const channel = channelStore?.getChannel?.(id)
				const recipients = channel?.recipients
					?.map(recipient => {
						const user = userStore?.getUser?.(recipient)
						return user?.globalName ?? user?.username ?? recipient
					})
					.join(', ')
				const label = channel?.name
					? guildId
						? `#${channel.name}`
						: channel.name
					: recipients || id
				return (
					<TableRow
						key={id}
						label={label}
						subLabel={
							guildId
								? (guildStore?.getGuild?.(guildId)?.name ?? guildId)
								: 'Direct message'
						}
						trailing={
							<Button
								text="Remove"
								size="sm"
								variant="tertiary"
								disabled={busy}
								accessibilityLabel={`Remove ${label} from auto-translate`}
								onPress={() => remove(id)}
							/>
						}
					/>
				)
			})}
		</TableRowGroup>
	)
}
