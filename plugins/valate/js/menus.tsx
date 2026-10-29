import { Design } from '@valenced/discord/design'
import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { after } from '@valenced/patcher'
import { ReactJSXRuntime } from '@valenced/react'
import { afterJSX } from '@valenced/react/jsx-runtime'
import { lookupGeneratedIconComponent } from '@valenced/utils/discord'
import {
	Children,
	cloneElement,
	createContext,
	isValidElement,
	useContext,
} from 'react'
import { createMessageAction } from './actionsheet'
import { createChannelAction } from './channels'
import type { JsonStorage } from '@valenced/json-storage'
import type { FC, ReactElement, ReactNode } from 'react'
import type { MessageSheetProps } from './actionsheet'
import type { ChannelSheetProps } from './channels'
import type { Settings } from './config'
import type { Channel } from './incoming'
import type { patchRenderer } from './renderer'
import type { TranslationService } from './service'

type Menu =
	| { kind: 'message'; props: MessageSheetProps }
	| { kind: 'channel'; props: ChannelSheetProps }
type Element = ReactElement<{
	children?: ReactNode
	icon?: ReactNode
	IconComponent?: unknown
}>

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
			const rows = Children.toArray(element.props.children).flatMap(child => {
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
			})
			return matches === before ? node : cloneElement(element, {}, ...rows)
		}
		if (!element.props.children) return node
		const children = visit(element.props.children)
		return children === element.props.children
			? node
			: cloneElement(element, {}, children)
	}
	const result = visit(node)
	return matches === 1 ? result : undefined
}

export function patchMenus(
	storage: JsonStorage<Settings>,
	service: TranslationService,
	getChannel: (id: string) => Channel | undefined,
	cleanup: (...callbacks: (() => void)[]) => void,
	onError: () => void,
	renderer: ReturnType<typeof patchRenderer>,
) {
	const Context = createContext<Menu | null>(null)
	const messageAction = createMessageAction(
		storage,
		service,
		cleanup,
		onError,
		renderer,
	)
	const channelAction = createChannelAction(storage, getChannel, cleanup)
	const contexts = new Map<
		string,
		(element: ReactElement) => Menu | undefined
	>()
	let copyIcon: unknown
	let active = true
	cleanup(() => {
		active = false
		contexts.clear()
	})
	function MenuAction({
		kind,
		inline = false,
	}: {
		kind: Menu['kind']
		inline?: boolean
	}) {
		const menu = useContext(Context)
		if (!active || menu?.kind !== kind) return null
		const action =
			menu.kind === 'message'
				? messageAction(menu.props)
				: channelAction(menu.props)
		if (!action || inline) return action
		return <Design.ActionSheetRow.Group>{action}</Design.ActionSheetRow.Group>
	}
	function provide<P>(name: string, context: (props: P) => Menu) {
		cleanup(
			getModules(
				withName<FC<P>>(name),
				exports => {
					const module = exports as { default: FC<P> }
					const original = module.default
					contexts.set(name, element =>
						element.type === original || element.type === module.default
							? context(element.props as P)
							: undefined,
					)
				},
				{ returnNamespace: true },
			),
		)
	}
	provide<MessageSheetProps>('LongPressMessageActionSheet', props => ({
		kind: 'message',
		props,
	}))
	provide<ChannelSheetProps>('ChannelLongPressActionSheet', props => ({
		kind: 'channel',
		props,
	}))
	function provideContext(element: ReactElement) {
		if (
			!active ||
			!isValidElement(element) ||
			typeof element.type !== 'function'
		)
			return element
		try {
			const menu = contexts.get(element.type.name)?.(element)
			if (menu)
				return (
					<Context.Provider key={element.key} value={menu}>
						{element}
					</Context.Provider>
				)
		} catch {
			onError()
		}
		return element
	}
	cleanup(
		after(ReactJSXRuntime, 'jsx', provideContext),
		after(ReactJSXRuntime, 'jsxs', provideContext),
		afterJSX(Design.ActionSheet, element => {
			if (!active) return element
			try {
				const children = insertAfterCopy(
					element.props.children,
					<MenuAction key="valate-translate" kind="message" inline />,
					(copyIcon ??= lookupGeneratedIconComponent('CopyIcon')),
				)
				return cloneElement(
					element,
					{},
					...Children.toArray(children ?? element.props.children),
					children === undefined ? (
						<MenuAction key="valate-translate" kind="message" />
					) : null,
					<MenuAction key="valate-auto-translate" kind="channel" />,
				)
			} catch {
				onError()
				return element
			}
		}),
	)
}
