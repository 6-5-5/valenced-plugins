import {
	ActionSheetActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { useEffect, useRef, useState } from 'react'
import { Defaults, enabledProviders, language, ProviderNames } from './config'
import { splitSpoilers } from './text'
import type { JsonStorage } from '@valenced/json-storage'
import type { Provider, Settings } from './config'
import type { Translation } from './providers'
import type { TranslationService } from './service'

export const SheetKey = 'valate-translation'

interface Props {
	text: string
	storage: JsonStorage<Settings>
	service: TranslationService
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
	const {
		ActionSheet,
		BottomSheetTitleHeader,
		Button,
		Stack,
		TableRadioGroup,
		TableRadioRow,
		Text,
		TextInput,
	} = Design
	const settings = storage.use() ?? Defaults
	const [provider, setProvider] = useState<Provider>(
		enabledProviders(settings)[0],
	)
	const [target, setTarget] = useState(settings.target)
	const [options, setOptions] = useState(false)
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
	const [draftTarget, setDraftTarget] = useState(target)
	const [draftProvider, setDraftProvider] = useState(provider)
	function close() {
		controller.current?.abort()
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
				/>
			}
		>
			<Stack spacing={16} style={{ paddingBottom: 24 }}>
				{options ? (
					<>
						<TextInput
							label="Target language code"
							placeholder="en, es or pt-BR"
							value={draftTarget}
							onChange={setDraftTarget}
							maxLength={32}
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
							onPress={() => {
								setTarget(draftTarget.trim())
								setProvider(draftProvider)
								setOptions(false)
							}}
						/>
						<Button
							text="Back"
							variant="tertiary"
							onPress={() => setOptions(false)}
						/>
					</>
				) : (
					<>
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
						<SpoilerText
							text={busy ? 'Translating…' : (result?.text ?? error)}
						/>
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
								setDraftTarget(target)
								setDraftProvider(provider)
								setOptions(true)
							}}
						/>
					</>
				)}
				<Button
					text={busy ? 'Cancel' : 'Close'}
					variant="tertiary"
					onPress={close}
				/>
			</Stack>
		</ActionSheet>
	)
}
