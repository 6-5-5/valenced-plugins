import { Design } from '@valenced/discord/design'
import { useState } from 'react'
import { GeminiUrl } from '../config'
import type { Provider, Settings } from '../config'
import type { useSettingsEditor } from './use-editor'

export default function ProviderFields({
	provider,
	draft,
	updateProvider,
	inputError,
	busy,
	models,
	loadModels,
	setError,
}: {
	provider: Provider
	draft: Settings
	updateProvider: ReturnType<typeof useSettingsEditor>['updateProvider']
	inputError: ReturnType<typeof useSettingsEditor>['inputError']
	busy: boolean
	models: string[]
	loadModels(): void
	setError(error: string): void
}) {
	const { Button, TableRadioGroup, TableRadioRow, Text, TextInput } = Design
	const [filter, setFilter] = useState('')
	if (provider === 'google')
		return <Text variant="text-md/normal">Free. Unofficial endpoint.</Text>
	const apiKey = {
		secureTextEntry: true,
		value: draft[provider].key,
		onChange: (key: string) => updateProvider(provider, { key }),
		...inputError('key'),
		maxLength: 512,
	}
	if (provider === 'deepl')
		return (
			<>
				<TableRadioGroup
					title="Service"
					description={
						draft.deepl.keyless
							? 'Unofficial service. Up to 1,500 characters per request. Availability may change.'
							: undefined
					}
					value={
						draft.deepl.keyless
							? 'keyless'
							: draft.deepl.pro
								? 'api-pro'
								: 'api-free'
					}
					onChange={(mode: 'keyless' | 'api-free' | 'api-pro') =>
						updateProvider(
							'deepl',
							{
								keyless: mode === 'keyless',
								pro: mode === 'keyless' ? draft.deepl.pro : mode === 'api-pro',
							},
							true,
						)
					}
				>
					<TableRadioRow
						label="Free"
						subLabel="No API key required."
						value="keyless"
						disabled={busy}
					/>
					<TableRadioRow
						label="API Free"
						subLabel="Requires a DeepL API Free key."
						value="api-free"
						disabled={busy}
					/>
					<TableRadioRow
						label="API Pro"
						subLabel="Requires a DeepL API Pro key. Usage charges apply."
						value="api-pro"
						disabled={busy}
					/>
				</TableRadioGroup>
				<TextInput
					label="API key"
					description="Required for API Free/Pro. Free does not use this key."
					{...apiKey}
					isDisabled={busy}
				/>
			</>
		)
	if (provider === 'libre')
		return (
			<>
				<TextInput
					label="Instance URL"
					placeholder="https://translate.example.org/"
					value={draft.libre.url}
					onChange={url => updateProvider('libre', { url })}
					{...inputError('url')}
					maxLength={2048}
				/>
				<TextInput label="API key (optional)" {...apiKey} />
			</>
		)
	return (
		<>
			<Button
				text="Use Gemini endpoint"
				variant="secondary"
				onPress={() => {
					updateProvider('oai', { url: GeminiUrl })
					setError('Add your Gemini key and choose a model.')
				}}
			/>
			<TextInput
				label="API base URL"
				placeholder="https://api.openai.com/v1/"
				value={draft.oai.url}
				onChange={url => updateProvider('oai', { url })}
				{...inputError('url')}
				maxLength={2048}
			/>
			<TextInput label="API key (optional)" {...apiKey} />
			<TextInput
				label="Model ID"
				placeholder="Enter or select a chat model"
				value={draft.oai.model}
				onChange={model => updateProvider('oai', { model })}
				{...inputError('model')}
				maxLength={200}
			/>
			<Button
				text={busy ? 'Fetching models…' : 'Fetch models'}
				variant="secondary"
				loading={busy}
				disabled={busy}
				onPress={loadModels}
			/>
			{models.length > 0 && (
				<>
					<TextInput
						label="Filter models"
						value={filter}
						onChange={setFilter}
						maxLength={200}
					/>
					<TableRadioGroup
						value={draft.oai.model}
						onChange={(model: string) => updateProvider('oai', { model }, true)}
					>
						{models
							.filter(model =>
								model.toLowerCase().includes(filter.toLowerCase()),
							)
							.slice(0, 40)
							.map(model => (
								<TableRadioRow key={model} label={model} value={model} />
							))}
					</TableRadioGroup>
					<Text variant="text-sm/normal" color="text-muted">
						40 matches shown at most. Choose a chat model.
					</Text>
				</>
			)}
		</>
	)
}
