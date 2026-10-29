import {
	ActionSheetActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Defaults, enabledProviders } from './config'
import { TranslateIconSource } from './icon'
import TranslationSheet, { SheetKey } from './sheet'
import type { JsonStorage } from '@valenced/json-storage'
import type { Settings } from './config'
import type { Message, patchRenderer } from './renderer'
import type { TranslationService } from './service'

export interface MessageSheetProps {
	message?: Message
	onClose?: () => void
}

export function createMessageAction(
	storage: JsonStorage<Settings>,
	service: TranslationService,
	cleanup: (...callbacks: (() => void)[]) => void,
	onError: () => void,
	renderer: ReturnType<typeof patchRenderer>,
) {
	const pending = new Map<string, AbortController>()
	let active = true
	cleanup(() => {
		active = false
		for (const controller of pending.values()) controller.abort()
		pending.clear()
	})
	return (props: MessageSheetProps) => {
		if (!active) return null
		try {
			const { ActionSheetRow } = Design
			const text = props.message?.content
			if (typeof text !== 'string' || !text.trim()) return null
			const message = props.message!
			const translated = renderer.display.get(message)
			return (
				<ActionSheetRow
					key="valate-translate"
					icon={<ActionSheetRow.Icon source={TranslateIconSource} />}
					label={translated ? 'Revert translation' : 'Translate'}
					onPress={async () => {
						if (!active) return
						if (props.onClose) props.onClose()
						else ActionSheetActionCreators.hideActionSheet()
						if (translated) {
							renderer.display.revert(message)
							return
						}
						const settings = { ...Defaults, ...storage.cache }
						if (settings.replaceText) {
							if (!message.id || !message.channel_id || !renderer.available()) {
								ToastActionCreators.open('valate-translate-error', {
									text: 'Replace mode is unavailable for this message.',
									variant: 'critical',
								})
								return
							}
							if (pending.has(message.id)) return
							const controller = new AbortController()
							const apply = renderer.display.prepare(message, controller)
							pending.set(message.id, controller)
							try {
								const result = await service.translateWithFallback(
									settings,
									enabledProviders(settings)[0],
									text,
									settings.target,
									controller.signal,
								)
								if (!controller.signal.aborted && !apply(result))
									throw new Error('Could not replace this message. Try again.')
							} catch (error) {
								if (!controller.signal.aborted)
									ToastActionCreators.open('valate-translate-error', {
										text:
											error instanceof Error
												? error.message
												: 'Translation failed.',
										variant: 'critical',
									})
							} finally {
								pending.delete(message.id)
							}
							return
						}
						ActionSheetActionCreators.openLazy(
							Promise.resolve({ default: TranslationSheet }),
							SheetKey,
							{
								text,
								storage,
								service,
							},
						)
					}}
				/>
			)
		} catch {
			onError()
			return null
		}
	}
}
