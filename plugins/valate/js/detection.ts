import { detectAll } from 'tinyld'
import { languageFamily } from './config'

export function needsTranslation(sample: string, understood: string[]) {
	if (!sample) return false
	const [first, second] = detectAll(sample)
	if (!first) return false
	const confident =
		first.accuracy >= 0.5 &&
		(!second || first.accuracy - second.accuracy >= 0.15)
	const multiword =
		first.accuracy >= 0.1 &&
		sample.split(' ').length >= 3 &&
		(!second || first.accuracy >= 2.25 * second.accuracy)
	if (!confident && !multiword) return false
	return !understood.some(
		code => languageFamily(code) === languageFamily(first.lang),
	)
}
