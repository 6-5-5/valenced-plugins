import Page from '@valenced/components/Page'
import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import {
	onSettingsModulesLoaded,
	refreshSettings,
	registerSettingsItems,
} from '@valenced/discord/modules/settings'
import { ReactNavigationNative } from '@valenced/externals/react-navigation'
import { useEffect, useRef, useState } from 'react'
import { ScrollView } from 'react-native'
import ChannelList from './channel-list'
import { removeChannel } from './channels'
import {
	baseUrl,
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
type SettingsPage = Provider | 'language' | 'priority' | 'channels' | null

class SettingsFieldError extends Error {
	constructor(
		public field: string,
		message: string,
	) {
		super(message)
	}
}

export function createSettingsEditor(
	storage: Props['api']['jsonStorage'],
	page: SettingsPage,
) {
	let draft = { ...Defaults, ...storage.cache }
	let saved = JSON.stringify(value())
	let queue = Promise.resolve()
	let pending: { value: string; promise: Promise<void> } | undefined
	function value() {
		if (page === 'language') return { target: draft.target }
		if (page === 'channels')
			return { understoodLanguages: draft.understoodLanguages ?? [] }
		if (!page || page === 'priority') return {}
		return { [page]: draft[page] }
	}
	return {
		get draft() {
			return draft
		},
		change(next: Settings) {
			draft = next
		},
		provider(provider: Provider, patch: Record<string, string | boolean>) {
			const current = draft[provider]
			if ('url' in patch && 'url' in current && patch.url !== current.url) {
				patch = {
					...patch,
					key: '',
					...(provider === 'oai' ? { model: '' } : {}),
				}
			}
			draft = { ...draft, [provider]: { ...current, ...patch } }
			return draft
		},
		disable(provider: Provider) {
			const promise = queue
				.catch(() => {})
				.then(() => storage.set({ [provider]: { enabled: false } }))
				.then(() => {
					saved = ''
				})
			queue = promise
			pending = { value: 'disable', promise }
			return promise.finally(() => {
				if (pending?.promise === promise) pending = undefined
			})
		},
		async commit() {
			const raw = JSON.stringify(value())
			if (raw === saved && !pending) return
			if (pending?.value === raw) return pending.promise
			let field = 'target'
			let patch: Partial<Settings>
			try {
				if (page === 'language') {
					patch = { target: validateTarget(draft.target.trim()) }
				} else if (page === 'channels') {
					field = 'understoodLanguages'
					const understoodLanguages = [
						...new Set(draft.understoodLanguages ?? []),
					]
					for (const code of understoodLanguages) validateTarget(code)
					patch = { understoodLanguages }
				} else if (page === 'google') {
					patch = { google: draft.google }
				} else {
					if (!page || page === 'priority') return
					const config = { ...draft[page] }
					field = 'key'
					if (/[\r\n]/.test(config.key))
						throw new Error('The API key contains a line break.')
					if (page === 'deepl') {
						if (draft.deepl.enabled) validateProvider(draft, page)
					} else {
						field = 'url'
						const provider = page === 'oai' ? draft.oai : draft.libre
						if (provider.url.trim() || provider.enabled)
							Object.assign(config, { url: baseUrl(provider.url) })
						if (page === 'oai') {
							field = 'model'
							if (
								draft.oai.model.length > 200 ||
								/[\r\n]/.test(draft.oai.model)
							)
								throw new Error('Enter a valid model ID.')
							if (draft.oai.enabled) validateProvider(draft, page)
						}
					}
					patch = { [page]: config }
				}
			} catch (error) {
				throw new SettingsFieldError(field, (error as Error).message)
			}
			const promise = queue
				.catch(() => {})
				// shortcut: Valenced hides disk-write errors; reliable retries need the host to report them.
				.then(() => storage.set(patch))
				.then(() => {
					saved = raw
				})
			queue = promise
			pending = { value: raw, promise }
			try {
				await promise
			} finally {
				if (pending?.promise === promise) pending = undefined
			}
		},
	}
}

const Pages = {
	language: 'Target language',
	priority: 'Provider priority',
	channels: 'Auto-translate',
	...ProviderNames,
}
const routeFor = (page: Exclude<SettingsPage, null>) => `cookie.valate.${page}`

export function registerSettings(api: Props['api']) {
	api.cleanup(
		onSettingsModulesLoaded(() => {
			api.cleanup(
				registerSettingsItems(
					Object.fromEntries(
						Object.entries(Pages).map(([page, title]) => {
							const name = page as Exclude<SettingsPage, null>
							const Screen = () => (
								<SettingsContent storage={api.jsonStorage} editing={name} />
							)
							return [
								routeFor(name),
								{
									parent: null,
									type: 'route',
									unsearchable: true,
									useTitle: () => title,
									screen: { route: routeFor(name), getComponent: () => Screen },
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
	const navigation = ReactNavigationNative.useNavigation()
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
	const settings = { ...Defaults, ...storage.use() }
	const enabled = enabledProviders(settings)
	const [editor] = useState(() => createSettingsEditor(storage, editing))
	const [draft, setDraft] = useState(editor.draft)
	const [understood, setUnderstood] = useState(
		(settings.understoodLanguages ?? []).join(', '),
	)
	const [error, setError] = useState('')
	const [fieldError, setFieldError] = useState<SettingsFieldError | null>(null)
	const [models, setModels] = useState<string[]>([])
	const [filter, setFilter] = useState('')
	const [busy, setBusy] = useState(false)
	const controller = useRef<AbortController | null>(null)
	const modelCache = useRef<{
		key: string
		models: string[]
		expires: number
	} | null>(null)
	useEffect(() => {
		const unsubscribe = navigation.addListener('beforeRemove', () => {
			controller.current?.abort()
			void editor.commit().catch((error: Error) => {
				ToastActionCreators.open('valate-settings-error', {
					text: `${error.message} Changes were not saved.`,
					variant: 'critical',
				})
			})
		})
		return () => {
			unsubscribe()
			controller.current?.abort()
		}
	}, [navigation, editor])
	async function commit(previous?: Settings, disable?: Provider) {
		const committing = editor.draft
		try {
			await (disable ? editor.disable(disable) : editor.commit())
			if (editor.draft !== committing) return
			setError('')
			setFieldError(null)
		} catch (error) {
			if (editor.draft !== committing) return
			if (previous) {
				editor.change(previous)
				setDraft(previous)
			}
			if (error instanceof SettingsFieldError) setFieldError(error)
			else setError('Could not save settings.')
		}
	}
	function change(next: Settings, immediate = false) {
		const previous = editor.draft
		editor.change(next)
		setDraft(next)
		setFieldError(null)
		if (immediate) void commit(previous)
	}
	function inputError(field: string) {
		return {
			status:
				fieldError?.field === field ? ('error' as const) : ('default' as const),
			errorMessage:
				fieldError?.field === field ? fieldError.message : undefined,
			onBlur: () => commit(),
		}
	}
	function updateProvider(
		provider: Provider,
		value: Record<string, string | boolean>,
		immediate = false,
	) {
		const previous = editor.draft
		if (provider === 'oai' && ('url' in value || 'key' in value)) {
			controller.current?.abort()
			controller.current = null
			setBusy(false)
			setModels([])
		}
		change(editor.provider(provider, value))
		if (immediate)
			void commit(previous, value.enabled === false ? provider : undefined)
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
			style={{ flex: 1 }}
			keyboardShouldPersistTaps="handled"
			keyboardDismissMode="on-drag"
			contentContainerStyle={{ paddingBottom: 32 }}
		>
			<Page spacing={16}>
				{!editing ? (
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
								onPress={() => navigation.navigate(routeFor('language'))}
							/>
							<TableRow
								label="Provider priority"
								subLabel={
									enabled.length
										? `${ProviderNames[enabled[0]]} first · fallback on failure`
										: 'All providers disabled'
								}
								arrow
								onPress={() => navigation.navigate(routeFor('priority'))}
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
								onPress={() => navigation.navigate(routeFor('channels'))}
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
									onPress={() => navigation.navigate(routeFor(provider))}
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
						{!!error && (
							<Text variant="text-sm/normal" color="text-danger">
								{error}
							</Text>
						)}
					</>
				) : editing === 'priority' ? (
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
						{!!error && (
							<Text variant="text-sm/normal" color="text-danger">
								{error}
							</Text>
						)}
					</>
				) : (
					<>
						{editing === 'language' ? (
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
									onChange={(target: string) =>
										change({ ...draft, target }, true)
									}
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
						) : (
							<>
								<TableRowGroup>
									<TableSwitchRow
										label="Enabled"
										value={draft[editing].enabled}
										onValueChange={enabled =>
											updateProvider(editing, { enabled }, true)
										}
									/>
								</TableRowGroup>
								{editing === 'google' ? (
									<Text variant="text-md/normal">
										Free. Unofficial endpoint.
									</Text>
								) : editing === 'deepl' ? (
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
														pro:
															mode === 'keyless'
																? draft.deepl.pro
																: mode === 'api-pro',
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
											secureTextEntry
											value={draft.deepl.key}
											onChange={key => updateProvider('deepl', { key })}
											{...inputError('key')}
											isDisabled={busy}
											maxLength={512}
										/>
									</>
								) : editing === 'libre' ? (
									<>
										<TextInput
											label="Instance URL"
											placeholder="https://translate.example.org/"
											value={draft.libre.url}
											onChange={url => updateProvider('libre', { url })}
											{...inputError('url')}
											maxLength={2048}
										/>
										<TextInput
											label="API key (optional)"
											secureTextEntry
											value={draft.libre.key}
											onChange={key => updateProvider('libre', { key })}
											{...inputError('key')}
											maxLength={512}
										/>
									</>
								) : (
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
										<TextInput
											label="API key (optional)"
											secureTextEntry
											value={draft.oai.key}
											onChange={key => updateProvider('oai', { key })}
											{...inputError('key')}
											maxLength={512}
										/>
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
													onChange={(model: string) =>
														updateProvider('oai', { model }, true)
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
					</>
				)}
			</Page>
		</ScrollView>
	)
}
