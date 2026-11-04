import Page from '@valenced/components/Page'
import {
	onSettingsModulesLoaded,
	refreshSettings,
	registerSettingsItems,
} from '@valenced/discord/modules/settings'
import { ScrollView } from 'react-native'
import { ProviderNames } from './config'
import SettingsHome from './settings/home'
import {
	AutoTranslateSettings,
	LanguageSettings,
	ProviderPrioritySettings,
} from './settings/pages'
import ProviderSettings from './settings/provider'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps, ReactNode } from 'react'
import type { Settings } from './config'
import type { SettingsPage } from './settings/editor'

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

const Pages = {
	language: 'Target language',
	priority: 'Provider priority',
	channels: 'Auto-translate',
	...ProviderNames,
}

export function registerSettings(api: Props['api']) {
	api.cleanup(
		onSettingsModulesLoaded(() => {
			api.cleanup(
				registerSettingsItems(
					Object.fromEntries(
						Object.entries(Pages).map(([page, title]) => {
							const name = page as Exclude<SettingsPage, null>
							const route = `cookie.valate.${name}`
							const Screen = () => (
								<SettingsContent storage={api.jsonStorage} editing={name} />
							)
							return [
								route,
								{
									parent: null,
									type: 'route',
									unsearchable: true,
									useTitle: () => title,
									screen: { route, getComponent: () => Screen },
								},
							]
						}),
					),
				),
				refreshSettings,
			)
			refreshSettings()
		}),
	)
}

export default function SettingsComponent({
	api: { jsonStorage: storage },
}: Props) {
	return <SettingsContent storage={storage} editing={null} />
}

function SettingsContent({
	storage,
	editing,
}: {
	storage: Props['api']['jsonStorage']
	editing: SettingsPage
}) {
	let content: ReactNode
	switch (editing) {
		case null:
			content = <SettingsHome storage={storage} />
			break
		case 'language':
			content = <LanguageSettings storage={storage} />
			break
		case 'channels':
			content = <AutoTranslateSettings storage={storage} />
			break
		case 'priority':
			content = <ProviderPrioritySettings storage={storage} />
			break
		default:
			content = <ProviderSettings storage={storage} provider={editing} />
	}
	return (
		<ScrollView
			style={{ flex: 1 }}
			keyboardShouldPersistTaps="handled"
			keyboardDismissMode="on-drag"
			contentContainerStyle={{ paddingBottom: 32 }}
		>
			<Page spacing={16}>{content}</Page>
		</ScrollView>
	)
}
