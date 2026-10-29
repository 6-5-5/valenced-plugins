import { ActionSheetActionCreators } from '@valenced/discord/actions'
import { Defaults } from './config'
import { watchIncoming } from './incoming'
import { patchMenus } from './menus'
import { patchRenderer } from './renderer'
import { createService } from './service'
import SettingsComponent from './settings'
import { SheetKey } from './sheet'
import type { Settings } from './config'

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: { load: true, default: Defaults },
	start({ cleanup, jsonStorage, logger }) {
		const service = createService()
		const renderer = patchRenderer(cleanup)
		const getChannel = watchIncoming(jsonStorage, service, renderer, cleanup)
		cleanup(
			() => service.clear(),
			jsonStorage.subscribe(() => {
				service.clear()
				renderer.display.clear()
			}),
			() => ActionSheetActionCreators.hideActionSheet(SheetKey),
		)
		let warned = false
		patchMenus(
			jsonStorage,
			service,
			getChannel,
			cleanup,
			() => {
				if (!warned)
					logger.warn(
						'Valate could not add its menu actions on this Discord version.',
					)
				warned = true
			},
			renderer,
		)
	},
	SettingsComponent,
})
