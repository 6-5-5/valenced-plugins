import { Design } from '@valenced/discord/design'
import { ReactNavigationNative } from '@valenced/externals/react-navigation'
import { useState } from 'react'
import {
	Defaults,
	enabledProviders,
	language,
	ProviderNames,
	providerOrder,
} from '../config'
import { SettingsError } from './pages'
import type { JsonStorage } from '@valenced/json-storage'
import type { Settings } from '../config'

export default function SettingsHome({
	storage,
}: {
	storage: JsonStorage<Settings>
}) {
	const navigation = ReactNavigationNative.useNavigation()
	const { TableRow, TableRowGroup, TableSwitchRow, Text } = Design
	const settings = { ...Defaults, ...storage.use() }
	const enabled = enabledProviders(settings)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	async function setReplaceText(replaceText: boolean) {
		if (busy) return
		setBusy(true)
		setError('')
		try {
			await storage.set({ replaceText })
		} catch {
			setError('Could not save display mode.')
		} finally {
			setBusy(false)
		}
	}
	return (
		<>
			<Text variant="text-sm/normal" color="text-muted">
				Long-press a message to translate. Only you see the result.
			</Text>
			<TableRowGroup title="Translation">
				<TableSwitchRow
					label="Replace message text"
					subLabel="Show translations in chat instead of a sheet. Long-press to revert."
					value={settings.replaceText ?? false}
					disabled={busy}
					onValueChange={setReplaceText}
				/>
				<TableRow
					label="Translate to"
					subLabel={language(settings.target)}
					arrow
					onPress={() => navigation.navigate('cookie.valate.language')}
				/>
				<TableRow
					label="Provider priority"
					subLabel={
						enabled.length
							? `${ProviderNames[enabled[0]]} first · fallback on failure`
							: 'All providers disabled'
					}
					arrow
					onPress={() => navigation.navigate('cookie.valate.priority')}
				/>
			</TableRowGroup>
			<TableRowGroup
				title="Automatic translation"
				description="Only runs in the open channel. Long-press a channel to enable it."
			>
				<TableRow
					label="Auto-translate"
					subLabel={
						settings.autoChannels?.length
							? `Enabled in ${settings.autoChannels.length} ${settings.autoChannels.length === 1 ? 'channel' : 'channels'}`
							: 'Off in all channels'
					}
					arrow
					onPress={() => navigation.navigate('cookie.valate.channels')}
				/>
			</TableRowGroup>
			<TableRowGroup
				title="Providers"
				description="Message text is sent to enabled providers. API charges may apply."
			>
				{providerOrder(settings).map(provider => (
					<TableRow
						key={provider}
						label={ProviderNames[provider]}
						subLabel={
							enabled[0] === provider
								? 'Used first'
								: settings[provider].enabled
									? 'Fallback'
									: 'Disabled'
						}
						arrow
						onPress={() => navigation.navigate(`cookie.valate.${provider}`)}
					/>
				))}
			</TableRowGroup>
			<SettingsError error={error} />
		</>
	)
}
