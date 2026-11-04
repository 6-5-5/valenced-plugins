import { Design } from '@valenced/discord/design'
import { useState } from 'react'
import ChannelList from '../channel-list'
import { removeChannel } from '../channels'
import {
	Defaults,
	Languages,
	language,
	ProviderNames,
	providerOrder,
} from '../config'
import { useSettingsEditor } from './use-editor'
import type { JsonStorage } from '@valenced/json-storage'
import type { Provider, Settings } from '../config'

interface Props {
	storage: JsonStorage<Settings>
}

export function LanguageSettings({ storage }: Props) {
	const { TableRadioGroup, TableRadioRow, TextInput } = Design
	const { draft, change, inputError, error } = useSettingsEditor(
		storage,
		'language',
	)
	const [filter, setFilter] = useState('')
	return (
		<>
			<TextInput
				label="Language code"
				placeholder="en, es or pt-BR"
				description="Any code your provider supports. Suggestions are not a provider support list."
				value={draft.target}
				onChange={target => change({ ...draft, target })}
				{...inputError('target')}
				maxLength={32}
			/>
			<TextInput
				label="Find language"
				placeholder="Search by name or code"
				description="Up to eight suggestions. Enter other codes above."
				value={filter}
				onChange={setFilter}
				maxLength={64}
			/>
			<TableRadioGroup
				value={draft.target}
				onChange={(target: string) => change({ ...draft, target }, true)}
			>
				{Object.entries(Languages)
					.filter(([code, name]) =>
						`${code} ${name}`
							.toLowerCase()
							.includes(filter.trim().toLowerCase()),
					)
					.slice(0, 8)
					.map(([code, name]) => (
						<TableRadioRow
							key={code}
							label={`${code} · ${name}`}
							value={code}
						/>
					))}
			</TableRadioGroup>
			<SettingsError error={error} />
		</>
	)
}

export function AutoTranslateSettings({ storage }: Props) {
	const { TextInput } = Design
	const { settings, draft, change, inputError, error, setError } =
		useSettingsEditor(storage, 'channels')
	const [understood, setUnderstood] = useState(
		(settings.understoodLanguages ?? []).join(', '),
	)
	const [busy, setBusy] = useState(false)
	async function disableChannel(id: string) {
		if (busy) return
		setBusy(true)
		setError('')
		try {
			await removeChannel(storage, id)
		} catch {
			setError('Could not remove channel.')
		} finally {
			setBusy(false)
		}
	}
	return (
		<>
			<TextInput
				label="Languages to skip"
				placeholder="es, fr, ja"
				description={`Your target language (${language(settings.target)}) is always skipped. Add other language codes, separated by commas.`}
				value={understood}
				onChange={value => {
					setUnderstood(value)
					change({
						...draft,
						understoodLanguages: value
							.split(',')
							.map(code => code.trim().toLowerCase())
							.filter(Boolean),
					})
				}}
				{...inputError('understoodLanguages')}
				isDisabled={busy}
				maxLength={256}
			/>
			<ChannelList
				channels={settings.autoChannels ?? []}
				busy={busy}
				remove={disableChannel}
			/>
			<SettingsError error={error} />
		</>
	)
}

export function ProviderPrioritySettings({ storage }: Props) {
	const { Button, TableRow, TableRowGroup } = Design
	const settings = { ...Defaults, ...storage.use() }
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	async function moveUp(provider: Provider) {
		if (busy) return
		const priority = providerOrder(settings)
		const index = priority.indexOf(provider)
		if (index <= 0) return
		priority.splice(index - 1, 2, provider, priority[index - 1])
		setBusy(true)
		setError('')
		try {
			await storage.set({ priority })
		} catch {
			setError('Could not save provider order.')
		} finally {
			setBusy(false)
		}
	}
	return (
		<>
			<TableRowGroup description="The first enabled provider runs first. If it fails, the next enabled provider is tried.">
				{providerOrder(settings).map((provider, index) => (
					<TableRow
						key={provider}
						label={`${index + 1}. ${ProviderNames[provider]}`}
						subLabel={settings[provider].enabled ? undefined : 'Disabled'}
						trailing={
							index > 0 ? (
								<Button
									text="Move up"
									size="sm"
									variant="tertiary"
									disabled={busy}
									accessibilityLabel={`Move ${ProviderNames[provider]} up`}
									onPress={() => moveUp(provider)}
								/>
							) : undefined
						}
					/>
				))}
			</TableRowGroup>
			<SettingsError error={error} />
		</>
	)
}

export function SettingsError({ error }: { error: string }) {
	const { Text } = Design
	return error ? (
		<Text variant="text-sm/normal" color="text-danger">
			{error}
		</Text>
	) : null
}
