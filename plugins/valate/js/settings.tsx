import Page from '@valenced/components/Page'
import { Design } from '@valenced/discord/design'
import { useEffect, useRef, useState } from 'react'
import { ScrollView } from 'react-native'
import ChannelList from './channel-list'
import { removeChannel } from './channels'
import {
	Defaults,
	enabledProviders,
	GeminiUrl,
	Languages,
	language,
	ProviderNames,
	providerOrder,
	validateProvider,
	validateTarget,
} from './config'
import { fetchModels } from './providers'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { Provider, Settings } from './config'

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

export default function SettingsComponent({
	api: { jsonStorage: storage },
}: Props) {
	const {
		Button,
		TableRow,
		TableRowGroup,
		TableSwitchRow,
		TableRadioGroup,
		TableRadioRow,
		Text,
		TextInput,
	} = Design
	const settings = storage.use() ?? Defaults
	const [editing, setEditing] = useState<
		Provider | 'language' | 'priority' | 'channels' | null
	>(null)
	const [draft, setDraft] = useState(settings)
	const [understood, setUnderstood] = useState('')
	const [error, setError] = useState('')
	const [models, setModels] = useState<string[]>([])
	const [filter, setFilter] = useState('')
	const [busy, setBusy] = useState(false)
	const chosenProvider =
		editing &&
		editing !== 'language' &&
		editing !== 'priority' &&
		editing !== 'channels' &&
		(editing === 'google' || draft[editing].enabled)
			? editing
			: null
	const controller = useRef<AbortController | null>(null)
	const modelCache = useRef<{
		key: string
		models: string[]
		expires: number
	} | null>(null)
	useEffect(() => () => controller.current?.abort(), [])
	function close() {
		controller.current?.abort()
		controller.current = null
		setBusy(false)
		setError('')
		setEditing(null)
	}
	function updateOai(value: Partial<Settings['oai']>) {
		controller.current?.abort()
		controller.current = null
		setBusy(false)
		setModels([])
		setDraft({ ...draft, oai: { ...draft.oai, ...value } })
	}
	async function loadModels() {
		const key = JSON.stringify([draft.oai.url, draft.oai.key])
		if (
			modelCache.current?.key === key &&
			modelCache.current.expires > Date.now()
		) {
			setModels(modelCache.current.models)
			return
		}
		controller.current?.abort()
		const request = new AbortController()
		controller.current = request
		setBusy(true)
		setError('')
		const timer = setTimeout(() => request.abort(), 15000)
		try {
			const result = await fetchModels(draft.oai, request.signal)
			if (controller.current !== request || request.signal.aborted) return
			setModels(result.models)
			modelCache.current = {
				key,
				models: result.models,
				expires: Date.now() + 300000,
			}
			if (!result.models.length)
				setError('No models returned. Enter one manually.')
			else if (result.hasMore)
				setError('First page only. Enter other models manually.')
		} catch (error) {
			if (controller.current === request)
				setError(
					request.signal.aborted
						? 'Model request cancelled or timed out.'
						: (error as Error).message,
				)
		} finally {
			clearTimeout(timer)
			if (controller.current === request) setBusy(false)
		}
	}
	async function save() {
		if (busy) return
		setBusy(true)
		setError('')
		try {
			const understoodLanguages =
				editing === 'channels'
					? [
							...new Set(
								understood
									.split(',')
									.map(code => code.trim().toLowerCase())
									.filter(Boolean),
							),
						]
					: draft.understoodLanguages
			for (const code of understoodLanguages ?? []) validateTarget(code)
			if (editing === 'channels') {
				await storage.set({ understoodLanguages })
				close()
				return
			}
			validateTarget(draft.target)
			if (
				editing &&
				editing !== 'language' &&
				editing !== 'priority' &&
				editing !== 'google' &&
				draft[editing].enabled
			)
				validateProvider(draft, editing)
			const priority = providerOrder(draft)
			const next = {
				...draft,
				autoChannels: { ...Defaults, ...storage.cache }.autoChannels,
				understoodLanguages,
				provider: chosenProvider ?? draft.provider,
				priority: chosenProvider
					? [
							chosenProvider,
							...priority.filter(provider => provider !== chosenProvider),
						]
					: priority,
			}
			if (next.provider !== 'google' && !next[next.provider].enabled)
				next.provider = 'google'
			await storage.set(next, true)
			close()
		} catch (error) {
			setError((error as Error).message)
		} finally {
			setBusy(false)
		}
	}
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
		<ScrollView
			keyboardShouldPersistTaps="handled"
			keyboardDismissMode="on-drag"
			contentContainerStyle={{ paddingBottom: 32 }}
		>
			<Page spacing={16}>
				{!editing ? (
					<>
						<Text variant="heading-lg/semibold">Valate</Text>
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
								onPress={() => {
									setError('')
									setDraft(settings)
									setFilter('')
									setEditing('language')
								}}
							/>
							<TableRow
								label="Provider priority"
								subLabel={`${ProviderNames[enabledProviders(settings)[0]]} first · fallback on failure`}
								arrow
								onPress={() => {
									setError('')
									setEditing('priority')
								}}
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
								onPress={() => {
									setError('')
									setUnderstood((settings.understoodLanguages ?? []).join(', '))
									setEditing('channels')
								}}
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
										enabledProviders(settings)[0] === provider
											? 'Used first'
											: provider === 'google' || settings[provider].enabled
												? 'Fallback'
												: 'Disabled'
									}
									arrow
									onPress={() => {
										setError('')
										setDraft(settings)
										setModels([])
										setFilter('')
										setEditing(provider)
									}}
								/>
							))}
						</TableRowGroup>
						{!!error && (
							<Text variant="text-sm/normal" color="text-danger">
								{error}
							</Text>
						)}
					</>
				) : editing === 'channels' ? (
					<>
						<Text variant="heading-lg/semibold">Auto-translate</Text>
						<TextInput
							label="Languages to skip"
							placeholder="es, fr, ja"
							description={`Your target language (${language(settings.target)}) is always skipped. Add other language codes, separated by commas.`}
							value={understood}
							onChange={setUnderstood}
							isDisabled={busy}
							maxLength={256}
						/>
						<ChannelList
							channels={settings.autoChannels ?? []}
							busy={busy}
							remove={disableChannel}
						/>
						{!!error && (
							<Text variant="text-sm/normal" color="text-danger">
								{error}
							</Text>
						)}
						<Button text="Done" disabled={busy} onPress={save} />
					</>
				) : editing === 'priority' ? (
					<>
						<Text variant="heading-lg/semibold">Provider priority</Text>
						<TableRowGroup description="The first enabled provider runs first. If it fails, the next enabled provider is tried.">
							{providerOrder(settings).map((provider, index) => (
								<TableRow
									key={provider}
									label={`${index + 1}. ${ProviderNames[provider]}`}
									subLabel={
										provider === 'google' || settings[provider].enabled
											? undefined
											: 'Disabled'
									}
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
						{!!error && (
							<Text variant="text-sm/normal" color="text-danger">
								{error}
							</Text>
						)}
						<Button text="Done" disabled={busy} onPress={close} />
					</>
				) : (
					<>
						<Text variant="heading-lg/semibold">
							{editing === 'language'
								? 'Target language'
								: ProviderNames[editing]}
						</Text>
						{editing === 'language' ? (
							<>
								<TextInput
									label="Language code"
									placeholder="en, es or pt-BR"
									description="Any code your provider supports. Suggestions are not a provider support list."
									value={draft.target}
									onChange={target => setDraft({ ...draft, target })}
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
									onChange={(target: string) => setDraft({ ...draft, target })}
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
							</>
						) : editing === 'google' ? (
							<Text variant="text-md/normal">Free. Unofficial endpoint.</Text>
						) : (
							<>
								<TableRowGroup>
									<TableSwitchRow
										label="Enabled"
										value={draft[editing].enabled}
										onValueChange={enabled =>
											setDraft({
												...draft,
												[editing]: { ...draft[editing], enabled },
											})
										}
									/>
								</TableRowGroup>
								{editing === 'deepl' ? (
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
												setDraft({
													...draft,
													deepl: {
														...draft.deepl,
														keyless: mode === 'keyless',
														pro:
															mode === 'keyless'
																? draft.deepl.pro
																: mode === 'api-pro',
													},
												})
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
										{!draft.deepl.keyless && (
											<TextInput
												label="API key"
												description="Use a key for the selected API plan."
												secureTextEntry
												value={draft.deepl.key}
												onChange={key =>
													setDraft({ ...draft, deepl: { ...draft.deepl, key } })
												}
												isDisabled={busy}
												maxLength={512}
											/>
										)}
									</>
								) : editing === 'libre' ? (
									<>
										<TextInput
											label="Instance URL"
											placeholder="https://translate.example.org/"
											value={draft.libre.url}
											onChange={url =>
												setDraft({ ...draft, libre: { ...draft.libre, url } })
											}
											maxLength={2048}
										/>
										<TextInput
											label="API key (optional)"
											secureTextEntry
											value={draft.libre.key}
											onChange={key =>
												setDraft({ ...draft, libre: { ...draft.libre, key } })
											}
											maxLength={512}
										/>
									</>
								) : (
									<>
										<Button
											text="Use Gemini endpoint"
											variant="secondary"
											onPress={() => {
												updateOai({ url: GeminiUrl, key: '', model: '' })
												setError('Add your Gemini key and choose a model.')
											}}
										/>
										<TextInput
											label="API base URL"
											placeholder="https://api.openai.com/v1/"
											value={draft.oai.url}
											onChange={url => updateOai({ url })}
											maxLength={2048}
										/>
										<TextInput
											label="API key (optional)"
											secureTextEntry
											value={draft.oai.key}
											onChange={key => updateOai({ key })}
											maxLength={512}
										/>
										<TextInput
											label="Model ID"
											placeholder="Enter or select a chat model"
											value={draft.oai.model}
											onChange={model =>
												setDraft({ ...draft, oai: { ...draft.oai, model } })
											}
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
													onChange={(model: string) =>
														setDraft({ ...draft, oai: { ...draft.oai, model } })
													}
												>
													{models
														.filter(model =>
															model
																.toLowerCase()
																.includes(filter.toLowerCase()),
														)
														.slice(0, 40)
														.map(model => (
															<TableRadioRow
																key={model}
																label={model}
																value={model}
															/>
														))}
												</TableRadioGroup>
												<Text variant="text-sm/normal" color="text-muted">
													40 matches shown at most. Choose a chat model.
												</Text>
											</>
										)}
									</>
								)}
							</>
						)}
						{!!error && (
							<Text variant="text-sm/normal" color="text-danger">
								{error}
							</Text>
						)}
						<Button
							text={chosenProvider ? 'Save and use' : 'Save'}
							disabled={busy}
							onPress={save}
						/>
						<Button text="Cancel" variant="tertiary" onPress={close} />
					</>
				)}
			</Page>
		</ScrollView>
	)
}
