const Protected =
	/```[\s\S]*?(?:```|$)|`[^`]*(?:`|$)|\|\|[\s\S]*?(?:\|\||$)|<(?:(?:@!?|@&|#)\d+|a?:\w+:\d+|t:\d+(?::\w)?)>|https?:\/\/[^\s<>]+/g

export function splitSpoilers(text: string) {
	const parts: { text: string; spoiler: boolean }[] = []
	let end = 0
	for (const match of text.matchAll(Protected)) {
		if (!match[0].startsWith('||')) continue
		if (match.index > end)
			parts.push({ text: text.slice(end, match.index), spoiler: false })
		parts.push({
			text: match[0].slice(
				2,
				match[0].endsWith('||') && match[0].length >= 4 ? -2 : undefined,
			),
			spoiler: true,
		})
		end = match.index + match[0].length
	}
	if (end < text.length) parts.push({ text: text.slice(end), spoiler: false })
	return parts
}

export function protect(text: string) {
	let prefix = 'VT'
	while (text.includes(`⟦${prefix}`)) prefix += 'X'
	const parts: { token: string; value: string }[] = []
	function token(value: string) {
		const token = `⟦${prefix}${parts.length}⟧`
		parts.push({ token, value })
		return token
	}
	const masked = splitSpoilers(text)
		.map(part =>
			part.spoiler
				? `${token('||')}${part.text.replace(Protected, token)}${token('||')}`
				: part.text.replace(Protected, token),
		)
		.join('')
	return {
		masked,
		hasText:
			masked.replace(new RegExp(`⟦${prefix}\\d+⟧`, 'g'), '').trim().length > 0,
		restore(translated: string) {
			if (translated.includes('||'))
				throw new Error(
					'The provider changed spoiler formatting. Try another provider.',
				)
			const tokens = translated.match(new RegExp(`⟦${prefix}\\d+⟧`, 'g')) ?? []
			if (
				tokens.length !== parts.length ||
				tokens.some((token, i) => token !== parts[i].token)
			)
				throw new Error(
					'The provider changed protected formatting. Try another provider.',
				)
			let result = translated
			for (const { token, value } of parts)
				result = result.replace(token, () => value)
			return result
		},
	}
}

export function detectionSample(text: string) {
	const sample = protect(text)
		.masked.replace(/⟦VT[X]*\d+⟧/g, ' ')
		.replace(/['’]/g, '')
		.replace(/[^\p{L}\p{M}\s]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 512)
	return sample.includes(' ') || (sample.match(/\p{L}/gu)?.length ?? 0) >= 40
		? sample
		: ''
}
