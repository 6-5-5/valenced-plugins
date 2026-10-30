import {
	ActionSheetActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { useEffect, useRef, useState } from 'react'
import {
	Defaults,
	enabledProviders,
	language,
	ProviderNames,
	validateTarget,
} from './config'
import { splitSpoilers } from './text'
import type { JsonStorage } from '@valenced/json-storage'
import type { Provider, Settings } from './config'
import type { Translation } from './providers'
import type { TranslationService } from './service'

export const SheetKey = 'valate-translation'
export const OptionsSheetKey = 'valate-translation-options'

interface Props {
	text: string
	storage: JsonStorage<Settings>
	service: TranslationService
}

function TranslationOptionsSheet({
	storage,
	target,
	provider,
	translate,
}: {
	storage: JsonStorage<Settings>
	target: string
	provider: Provider
	translate(target: string, provider: Provider): void
}) {
	const {
		ActionSheet,
		BottomSheetTitleHeader,
		Button,
		Stack,
		TableRadioGroup,
		TableRadioRow,
		TextInput,
	} = Design
	const settings = storage.use() ?? Defaults
	const [draftTarget, setDraftTarget] = useState(target)
	const [draftProvider, setDraftProvider] = useState(provider)
	const [error, setError] = useState('')
	const close = () => ActionSheetActionCreators.hideActionSheet(OptionsSheetKey)
	return (
		<ActionSheet
			scrollable
			startExpanded
			keyboardShouldPersistTaps="handled"
			header={
				<BottomSheetTitleHeader
					title="Translation options"
					leading={
						<Button text="Back" size="sm" variant="tertiary" onPress={close} />
					}
				/>
			}
		>
			<Stack spacing={16} style={{ paddingBottom: 24 }}>
				<TextInput
					label="Target language code"
					placeholder="en, es or pt-BR"
					value={draftTarget}
					onChange={value => {
						setDraftTarget(value)
						setError('')
					}}
					maxLength={32}
					status={error ? 'error' : 'default'}
					errorMessage={error || undefined}
				/>
				<TableRadioGroup value={draftProvider} onChange={setDraftProvider}>
					{enabledProviders(settings).map(value => (
						<TableRadioRow
							key={value}
							label={ProviderNames[value]}
							value={value}
						/>
					))}
				</TableRadioGroup>
				<Button
					text="Translate"
					disabled={!enabledProviders(settings).includes(draftProvider)}
					onPress={() => {
						try {
							validateTarget(draftTarget.trim())
						} catch (error) {
							setError((error as Error).message)
							return
						}
						close()
						translate(draftTarget.trim(), draftProvider)
					}}
				/>
			</Stack>
		</ActionSheet>
	)
}

function Spoiler({ text }: { text: string }) {
	const { Text } = Design
	const [revealed, setRevealed] = useState(false)
	return (
		<Text
			accessibilityRole="button"
			accessibilityLabel={revealed ? `${text}. Hide spoiler` : 'Reveal spoiler'}
			onPress={() => setRevealed(!revealed)}
			color={revealed ? undefined : 'text-muted'}
		>
			{revealed ? text : '[Spoiler — tap to reveal]'}
		</Text>
	)
}

function SpoilerText({ text }: { text: string }) {
	const { Text } = Design
	return (
		<Text variant="text-md/normal" selectable>
			{splitSpoilers(text).map((part, index) =>
				part.spoiler ? (
					<Spoiler key={`${index}:${part.text}`} text={part.text} />
				) : (
					part.text
				),
			)}
		</Text>
	)
}

export default function TranslationSheet({ text, storage, service }: Props) {
	const { ActionSheet, BottomSheetTitleHeader, Button, Stack, Text } = Design
	const settings = storage.use() ?? Defaults
	const [{ provider, target }, setSelection] = useState({
		provider: enabledProviders(settings)[0] ?? settings.provider,
		target: settings.target,
	})
	const [result, setResult] = useState<Translation | null>(null)
	const [error, setError] = useState('')
	const [attempt, setAttempt] = useState(0)
	const [busy, setBusy] = useState(true)
	const controller = useRef<AbortController | null>(null)
	useEffect(() => {
		const request = new AbortController()
		controller.current = request
		setBusy(true)
		setResult(null)
		setError('')
		service
			.translateWithFallback(
				settings,
				provider,
				text,
				target,
				request.signal,
				attempt > 0,
			)
			.then(
				result => {
					if (request.signal.aborted) return
					setResult(result)
				},
				error => {
					if (!request.signal.aborted) setError((error as Error).message)
				},
			)
			.finally(() => {
				if (!request.signal.aborted) setBusy(false)
			})
		return () => request.abort()
	}, [settings, provider, text, target, attempt, service])
	useEffect(
		() => () => ActionSheetActionCreators.hideActionSheet(OptionsSheetKey),
		[],
	)
	function close() {
		controller.current?.abort()
		ActionSheetActionCreators.hideActionSheet(OptionsSheetKey)
		ActionSheetActionCreators.hideActionSheet(SheetKey)
	}
	return (
		<ActionSheet
			scrollable
			startExpanded
			keyboardShouldPersistTaps="handled"
			onDismiss={() => controller.current?.abort()}
			header={
				<BottomSheetTitleHeader
					title="Valate"
					subtitle={`${ProviderNames[result?.provider ?? provider]} → ${language(target)}`}
					trailing={
						<Button
							text={busy ? 'Cancel' : 'Close'}
							size="sm"
							variant="tertiary"
							onPress={close}
						/>
					}
				/>
			}
		>
			<Stack spacing={16} style={{ paddingBottom: 24 }}>
				<Text variant="text-sm/normal" color="text-muted">
					Original
				</Text>
				<SpoilerText text={text} />
				<Text variant="text-sm/normal" color="text-muted">
					{result
						? `Translation [${ProviderNames[result.provider]}]`
						: 'Translation'}
					{result?.source
						? ` · from ${language(result.source.toLowerCase())}`
						: ''}
				</Text>
				<SpoilerText text={busy ? 'Translating…' : (result?.text ?? error)} />
				{result && (
					<Button
						text="Copy translation"
						onPress={() => {
							Clipboard.setString(result.text)
							ToastActionCreators.open('valate-copied', {
								text: 'Translation copied',
								variant: 'success',
							})
						}}
					/>
				)}
				{!busy && (
					<Button
						text="Retry translation"
						variant="secondary"
						onPress={() => setAttempt(attempt + 1)}
					/>
				)}
				<Button
					text="Change language or provider"
					variant="tertiary"
					onPress={() => {
						ActionSheetActionCreators.openLazy(
							Promise.resolve({ default: TranslationOptionsSheet }),
							OptionsSheetKey,
							{
								storage,
								target,
								provider,
								translate(target, provider) {
									setSelection({ target, provider })
									setAttempt(attempt => attempt + 1)
								},
							},
							'stack',
						)
					}}
				/>
			</Stack>
		</ActionSheet>
	)
}
