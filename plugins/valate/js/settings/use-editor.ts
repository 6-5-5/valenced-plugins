import { ToastActionCreators } from '@valenced/discord/actions'
import { ReactNavigationNative } from '@valenced/externals/react-navigation'
import { useEffect, useState } from 'react'
import { Defaults } from '../config'
import { createSettingsEditor, SettingsFieldError } from './editor'
import type { JsonStorage } from '@valenced/json-storage'
import type { Provider, Settings } from '../config'
import type { SettingsPage } from './editor'

export function useSettingsEditor(
	storage: JsonStorage<Settings>,
	page: SettingsPage,
) {
	const navigation = ReactNavigationNative.useNavigation()
	const settings = { ...Defaults, ...storage.use() }
	const [editor] = useState(() => createSettingsEditor(storage, page))
	const [draft, setDraft] = useState(editor.draft)
	const [error, setError] = useState('')
	const [fieldError, setFieldError] = useState<SettingsFieldError | null>(null)
	useEffect(() => {
		return navigation.addListener('beforeRemove', () => {
			void editor.commit().catch((error: Error) => {
				ToastActionCreators.open('valate-settings-error', {
					text: `${error.message} Changes were not saved.`,
					variant: 'critical',
				})
			})
		})
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
		change(editor.provider(provider, value))
		if (immediate)
			void commit(previous, value.enabled === false ? provider : undefined)
	}
	return {
		settings,
		draft,
		error,
		setError,
		change,
		inputError,
		updateProvider,
	}
}
