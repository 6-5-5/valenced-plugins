import {
	ActionSheetActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { lookupGeneratedIconComponent } from '@valenced/utils/discord'
import { Children, cloneElement, isValidElement } from 'react'
import { Defaults, enabledProviders } from './config'
import { TranslateIconSource } from './icon'
import TranslationSheet, { SheetKey } from './sheet'
import type { JsonStorage } from '@valenced/json-storage'
import type { FC, ReactElement, ReactNode } from 'react'
import type { Settings } from './config'
import type { Message, patchRenderer } from './renderer'
import type { TranslationService } from './service'

type MessageSheet = FC<{ message?: Message; onClose?: () => void }>
type Element = ReactElement<{
	children?: ReactNode
	icon?: ReactNode
	IconComponent?: unknown
}>

// shortcut: icon identity is not a row ID; replace it when a Copy Text ID is verified.
function isCopyRow(element: Element, copyIcon: unknown) {
	const { ActionSheetRow } = Design
	if (
		!copyIcon ||
		element.type !== ActionSheetRow ||
		!isValidElement(element.props.icon)
	)
		return false
	const icon = element.props.icon as Element
	return icon.type === copyIcon || icon.props.IconComponent === copyIcon
}

function insertAfterCopy(
	node: ReactNode,
	action: ReactNode,
	copyIcon: unknown,
): ReactNode | undefined {
	const { ActionSheetRow } = Design
	let matches = 0
	function visit(node: ReactNode): ReactNode {
		if (Array.isArray(node)) return node.map(visit)
		if (!isValidElement(node)) return node
		const element = node as Element
		if (element.type === ActionSheetRow.Group) {
			const children = Children.toArray(element.props.children)
			const rows = children.flatMap(child => {
				if (!isValidElement(child) || !isCopyRow(child as Element, copyIcon))
					return [child]
				matches++
				return [child, action]
			})
			return cloneElement(element, {}, ...rows)
		}
		if (!element.props.children) return node
		return cloneElement(element, {}, visit(element.props.children))
	}
	const result = visit(node)
	return matches === 1 ? result : undefined
}

export function appendAction(
	node: ReactNode,
	action: ReactNode,
	copyIcon?: unknown,
): ReactNode {
	const { ActionSheet } = Design
	if (Array.isArray(node))
		return node.map(child => appendAction(child, action, copyIcon))
	if (!isValidElement(node)) return node
	const element = node as Element
	if (element.type === ActionSheet)
		return (
			(copyIcon && isValidElement(action)
				? insertAfterCopy(element, (action as Element).props.children, copyIcon)
				: undefined) ??
			cloneElement(
				element,
				{},
				...Children.toArray(element.props.children),
				action,
			)
		)
	if (!element.props.children) return node
	return cloneElement(
		element,
		{},
		appendAction(element.props.children, action, copyIcon),
	)
}

export function patchMessages(
	storage: JsonStorage<Settings>,
	service: TranslationService,
	cleanup: (...callbacks: (() => void)[]) => void,
	onError: () => void,
	renderer?: ReturnType<typeof patchRenderer>,
) {
	const pending = new Map<string, AbortController>()
	cleanup(() => {
		for (const controller of pending.values()) controller.abort()
		pending.clear()
	})
	cleanup(
		getModules(
			withName<MessageSheet>('LongPressMessageActionSheet'),
			exports => {
				const module = exports as { default: MessageSheet }
				cleanup(
					instead(module, 'default', function (args, original) {
						const tree = Reflect.apply(original, this, args) as ReactNode
						try {
							const { ActionSheetRow } = Design
							const props = args[0]
							const text = props.message?.content
							if (typeof text !== 'string' || !text.trim()) return tree
							const message = props.message!
							const translated = renderer?.display.get(message)
							return appendAction(
								tree,
								<ActionSheetRow.Group key="valate-translate">
									<ActionSheetRow
										key="valate-translate"
										icon={<ActionSheetRow.Icon source={TranslateIconSource} />}
										label={translated ? 'Revert translation' : 'Translate'}
										onPress={async () => {
											if (props.onClose) props.onClose()
											else ActionSheetActionCreators.hideActionSheet()
											if (translated) {
												renderer!.display.revert(message)
												return
											}
											const settings = { ...Defaults, ...storage.cache }
											if (settings.replaceText) {
												if (
													!message.id ||
													!message.channel_id ||
													!renderer?.available()
												) {
													ToastActionCreators.open('valate-translate-error', {
														text: 'Replace mode is unavailable for this message.',
														variant: 'critical',
													})
													return
												}
												if (pending.has(message.id)) return
												const controller = new AbortController()
												const apply = renderer.display.prepare(message)
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
														throw new Error(
															'Could not replace this message. Try again.',
														)
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
								</ActionSheetRow.Group>,
								lookupGeneratedIconComponent('CopyIcon'),
							)
						} catch {
							onError()
							return tree
						}
					}),
				)
			},
			{ returnNamespace: true },
		),
	)
}
