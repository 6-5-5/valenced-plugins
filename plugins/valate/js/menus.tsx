import { ActionSheetActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { before, instead } from '@valenced/patcher'
import { lookupGeneratedIconComponent } from '@valenced/utils/discord'
import { cloneElement, isValidElement } from 'react'
import { createMessageAction } from './actionsheet'
import { createChannelAction } from './channels'
import type { JsonStorage } from '@valenced/json-storage'
import type { ReactElement, ReactNode } from 'react'
import type { MessageSheetProps } from './actionsheet'
import type { ChannelSheetProps } from './channels'
import type { Settings } from './config'
import type { Channel } from './incoming'
import type { patchRenderer } from './renderer'
import type { TranslationService } from './service'

type Element = ReactElement<{
	children?: ReactNode
	icon?: ReactNode
	IconComponent?: unknown
}>
type Sheet<P> = (props: P) => ReactNode

function insertAfterCopy(
	node: ReactNode,
	action: ReactNode,
	copyIcon: unknown,
): ReactNode | undefined {
	if (!copyIcon) return undefined
	const { ActionSheetRow } = Design
	let matches = 0
	function visit(node: ReactNode): ReactNode {
		if (Array.isArray(node)) {
			const children = node.map(visit)
			return children.some((child, index) => child !== node[index])
				? children
				: node
		}
		if (!isValidElement(node)) return node
		const element = node as Element
		if (element.type === ActionSheetRow.Group) {
			const before = matches
			const children = element.props.children
			const rows = (Array.isArray(children) ? children : [children]).flatMap(
				child => {
					if (!isValidElement(child) || child.type !== ActionSheetRow)
						return [child]
					const icon = (child as Element).props.icon
					if (!isValidElement(icon)) return [child]
					if (
						icon.type !== copyIcon &&
						(icon as Element).props.IconComponent !== copyIcon
					)
						return [child]
					matches++
					return [child, action]
				},
			)
			return matches === before
				? node
				: cloneElement(element, { children: rows })
		}
		if (!element.props.children) return node
		const children = visit(element.props.children)
		return children === element.props.children
			? node
			: cloneElement(element, { children })
	}
	const result = visit(node)
	return matches === 1 ? result : undefined
}

function containsAction(node: ReactNode, key: string): boolean {
	if (Array.isArray(node)) return node.some(child => containsAction(child, key))
	if (!isValidElement(node)) return false
	return (
		node.key === key || containsAction((node as Element).props.children, key)
	)
}

function insertAction(
	node: ReactNode,
	action: ReactElement,
	key: string,
	copyIcon?: unknown,
): ReactNode {
	if (Array.isArray(node)) {
		const children = node.map(child =>
			insertAction(child, action, key, copyIcon),
		)
		return children.some((child, index) => child !== node[index])
			? children
			: node
	}
	if (!isValidElement(node)) return node
	const element = node as Element
	if (element.type === Design.ActionSheet) {
		if (containsAction(element.props.children, key)) return node
		const inline = insertAfterCopy(element.props.children, action, copyIcon)
		const children = element.props.children
		return cloneElement(element, {
			children: inline ?? [
				...(Array.isArray(children)
					? children
					: children == null
						? []
						: [children]),
				<Design.ActionSheetRow.Group key={key} hasIcons>
					{action}
				</Design.ActionSheetRow.Group>,
			],
		})
	}
	const children = insertAction(element.props.children, action, key, copyIcon)
	return children === element.props.children
		? node
		: cloneElement(element, { children })
}

export function patchMenus(
	storage: JsonStorage<Settings>,
	service: TranslationService,
	getChannel: (id: string) => Channel | undefined,
	cleanup: (...callbacks: (() => void)[]) => void,
	onError: () => void,
	renderer: ReturnType<typeof patchRenderer>,
) {
	const messageAction = createMessageAction(
		storage,
		service,
		cleanup,
		onError,
		renderer,
	)
	const channelAction = createChannelAction(storage, getChannel, cleanup)
	let copyIcon: unknown
	let active = true
	cleanup(() => {
		active = false
	})
	function patch<P>(
		name: string,
		makeAction: (props: P) => ReactElement | null,
		key: string,
		inner = false,
		lazy = false,
	) {
		const renders = new WeakMap<Sheet<P>, Sheet<P>>()
		const patched = new WeakSet<object>()
		function edit(tree: ReactNode, props: P) {
			if (!active) return tree
			try {
				const action = makeAction(props)
				if (!action) return tree
				return insertAction(
					tree,
					action,
					key,
					inner
						? undefined
						: (copyIcon ??= lookupGeneratedIconComponent('CopyIcon')),
				)
			} catch {
				onError()
				return tree
			}
		}
		function renderMenu(this: unknown, args: [P], original: Sheet<P>) {
			const tree = original.apply(this, args)
			if (!active) return tree
			if (lazy) {
				const edited = edit(tree, args[0])
				if (edited !== tree) return edited
			}
			if (!inner || !isValidElement(tree) || typeof tree.type !== 'function')
				return edit(tree, args[0])
			try {
				const Inner = tree.type as Sheet<P>
				let render = renders.get(Inner)
				if (!render) {
					const target = { render: Inner }
					cleanup(
						instead(target, 'render', function (args, original) {
							return edit(original.apply(this, args), args[0])
						}),
					)
					render = target.render
					renders.set(Inner, render)
				}
				return {
					...tree,
					type: render,
					props: lazy ? { ...args[0], ...(tree.props as P) } : tree.props,
				}
			} catch {
				onError()
				return tree
			}
		}
		function patchSheet(exports: unknown) {
			if (!active) return
			const module = exports as {
				default: Sheet<P> | { type: Sheet<P> }
			}
			const target =
				typeof module.default === 'function' ? module : module.default
			if (patched.has(target)) return
			if (typeof module.default === 'function')
				cleanup(instead(module as { default: Sheet<P> }, 'default', renderMenu))
			else cleanup(instead(module.default, 'type', renderMenu))
			patched.add(target)
		}
		if (lazy) {
			cleanup(
				before(ActionSheetActionCreators, 'openLazy', args => {
					if (args[1] !== name) return args
					args[0] = args[0].then(module => {
						try {
							patchSheet(module)
						} catch {
							onError()
						}
						return module
					})
					return args
				}),
			)
		} else
			cleanup(
				getModules(withName<Sheet<P>>(name), patchSheet, {
					returnNamespace: true,
				}),
			)
	}
	patch<MessageSheetProps>(
		'LongPressMessageActionSheet',
		messageAction,
		'valate-translate',
	)
	patch<ChannelSheetProps>(
		'ChannelLongPressActionSheet',
		channelAction,
		'valate-auto-translate',
		true,
	)
	for (const name of [
		'ThreadLongPressActionSheet',
		'ForumPostLongPressActionSheet',
	])
		patch<ChannelSheetProps>(
			name,
			channelAction,
			'valate-auto-translate',
			true,
			true,
		)
}
