import { Design } from '@valenced/discord/design'
import { ReactNavigationNative } from '@valenced/externals/react-navigation'
import { useEffect, useRef, useState } from 'react'
import { fetchModels } from '../providers'
import { SettingsError } from './pages'
import ProviderFields from './provider-fields'
import { useSettingsEditor } from './use-editor'
import type { JsonStorage } from '@valenced/json-storage'
import type { Provider, Settings } from '../config'

export default function ProviderSettings({
	storage,
	provider,
}: {
	storage: JsonStorage<Settings>
	provider: Provider
}) {
	const { TableRowGroup, TableSwitchRow } = Design
	const editor = useSettingsEditor(storage, provider)
	const { draft, error, setError } = editor
	const navigation = ReactNavigationNative.useNavigation()
	const [models, setModels] = useState<string[]>([])
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
		})
		return () => {
			unsubscribe()
			controller.current?.abort()
		}
	}, [navigation])
	function updateProvider(
		provider: Provider,
		value: Record<string, string | boolean>,
		immediate = false,
	) {
		if (provider === 'oai' && ('url' in value || 'key' in value)) {
			controller.current?.abort()
			controller.current = null
			setBusy(false)
			setModels([])
		}
		editor.updateProvider(provider, value, immediate)
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
	return (
		<>
			<TableRowGroup>
				<TableSwitchRow
					label="Enabled"
					value={draft[provider].enabled}
					onValueChange={enabled => updateProvider(provider, { enabled }, true)}
				/>
			</TableRowGroup>
			<ProviderFields
				provider={provider}
				draft={draft}
				updateProvider={updateProvider}
				inputError={editor.inputError}
				busy={busy}
				models={models}
				loadModels={loadModels}
				setError={setError}
			/>
			<SettingsError error={error} />
		</>
	)
}
