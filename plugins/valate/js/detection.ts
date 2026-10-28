import { francAll } from 'franc-min'
import { languageFamily } from './config'

export function needsTranslation(sample: string, understood: string[]) {
	if (!sample) return false
	if ((sample.match(/\p{L}/gu)?.length ?? 0) < 40) return true
	const [first, second] = francAll(sample, { minLength: 40 })
	if (first[0] === 'und' || (second && first[1] - second[1] < 0.15))
		return false
	return !understood.some(
		code => languageFamily(code) === languageFamily(first[0]),
	)
}
