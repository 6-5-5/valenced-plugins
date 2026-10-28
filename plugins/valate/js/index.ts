import { ActionSheetActionCreators } from '@valenced/discord/actions'
import { patchMessages } from './actionsheet'
import { patchChannels } from './channels'
import { Defaults } from './config'
import { watchIncoming } from './incoming'
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
		patchChannels(jsonStorage, getChannel, cleanup)
		cleanup(
			() => service.clear(),
			jsonStorage.subscribe(() => {
				service.clear()
				renderer.display.clear()
			}),
			() => ActionSheetActionCreators.hideActionSheet(SheetKey),
		)
		let warned = false
		patchMessages(
			jsonStorage,
			service,
			cleanup,
			() => {
				if (!warned)
					logger.warn(
						'Valate could not add its message action on this Discord version.',
					)
				warned = true
			},
			renderer,
		)
	},
	SettingsComponent,
})
