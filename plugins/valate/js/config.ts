export const ProviderNames = {
	google: 'Google Translate',
	deepl: 'DeepL',
	libre: 'LibreTranslate',
	oai: 'OpenAI-compatible',
} as const
export type Provider = keyof typeof ProviderNames
export const Providers = Object.keys(ProviderNames) as Provider[]
export const GeminiUrl =
	'https://generativelanguage.googleapis.com/v1beta/openai/'

export interface Settings {
	provider: Provider
	priority?: Provider[]
	replaceText?: boolean
	autoChannels?: { id: string; guildId?: string }[]
	understoodLanguages?: string[]
	target: string
	deepl: { enabled: boolean; key: string; pro: boolean; keyless?: boolean }
	libre: { enabled: boolean; url: string; key: string }
	oai: { enabled: boolean; url: string; key: string; model: string }
}

export const Defaults: Settings = {
	provider: 'deepl',
	target: 'en',
	deepl: { enabled: true, key: '', pro: false, keyless: true },
	libre: { enabled: false, url: '', key: '' },
	oai: { enabled: false, url: '', key: '', model: '' },
}

export const Languages = {
	en: 'English',
	es: 'Spanish',
	fr: 'French',
	de: 'German',
	it: 'Italian',
	pt: 'Portuguese',
	'pt-BR': 'Portuguese (Brazil)',
	ru: 'Russian',
	uk: 'Ukrainian',
	pl: 'Polish',
	nl: 'Dutch',
	tr: 'Turkish',
	ar: 'Arabic',
	hi: 'Hindi',
	ja: 'Japanese',
	ko: 'Korean',
	'zh-CN': 'Chinese (Simplified)',
	'zh-TW': 'Chinese (Traditional)',
	af: 'Afrikaans',
	sq: 'Albanian',
	am: 'Amharic',
	hy: 'Armenian',
	az: 'Azerbaijani',
	eu: 'Basque',
	be: 'Belarusian',
	bn: 'Bengali',
	bs: 'Bosnian',
	bg: 'Bulgarian',
	my: 'Burmese',
	ca: 'Catalan',
	hr: 'Croatian',
	cs: 'Czech',
	da: 'Danish',
	et: 'Estonian',
	tl: 'Filipino (Tagalog)',
	fi: 'Finnish',
	ka: 'Georgian',
	el: 'Greek',
	gu: 'Gujarati',
	he: 'Hebrew',
	hu: 'Hungarian',
	is: 'Icelandic',
	id: 'Indonesian',
	ga: 'Irish',
	kn: 'Kannada',
	kk: 'Kazakh',
	km: 'Khmer',
	lv: 'Latvian',
	lt: 'Lithuanian',
	ms: 'Malay',
	ml: 'Malayalam',
	mr: 'Marathi',
	ne: 'Nepali',
	no: 'Norwegian',
	fa: 'Persian',
	ro: 'Romanian',
	sr: 'Serbian',
	sk: 'Slovak',
	sl: 'Slovenian',
	sw: 'Swahili',
	sv: 'Swedish',
	ta: 'Tamil',
	te: 'Telugu',
	th: 'Thai',
	ur: 'Urdu',
	uz: 'Uzbek',
	vi: 'Vietnamese',
	cy: 'Welsh',
	zu: 'Zulu',
} as const

export function language(code: string) {
	return Languages[code as keyof typeof Languages] ?? code
}

const Macrolanguages: Record<string, string> = {
	nb: 'no',
	nob: 'no',
	nn: 'no',
	nno: 'no',
	iw: 'he',
	in: 'id',
	ji: 'yi',
	jw: 'jv',
	fil: 'tl',
	cmn: 'zh',
	arb: 'ar',
	pes: 'fa',
	azj: 'az',
	uzn: 'uz',
	zlm: 'ms',
	swh: 'sw',
	plt: 'mg',
	fuv: 'ff',
	qug: 'qu',
	zyb: 'za',
	pbu: 'ps',
	npi: 'ne',
}

export function languageFamily(code: string) {
	const base = code.trim().toLowerCase().split('-')[0]
	return Macrolanguages[base] ?? iso6393To1[base] ?? base
}

export function providerOrder(settings: Settings): Provider[] {
	return [
		...new Set([...(settings.priority ?? [settings.provider]), ...Providers]),
	].filter(provider => Providers.includes(provider))
}

export function enabledProviders(settings: Settings) {
	return providerOrder(settings).filter(
		provider => provider === 'google' || settings[provider].enabled,
	)
}

export function validateTarget(target: string) {
	if (
		!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(target) ||
		target.toLowerCase() === 'auto'
	)
		throw new Error('Enter a target language code, such as en, es or pt-BR.')
	return target
}

export function baseUrl(value: string) {
	let url: URL
	try {
		url = new URL(value.trim())
	} catch {
		throw new Error('Enter a valid HTTPS base URL.')
	}
	if (
		url.protocol !== 'https:' ||
		!url.hostname ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		throw new Error(
			'Use HTTPS without credentials, query parameters or a fragment.',
		)
	return `${url.href.replace(/\/+$/, '')}/`
}

export function validateProvider(settings: Settings, provider: Provider) {
	if (provider === 'google') return
	const config = settings[provider]
	if (!config.enabled)
		throw new Error('Enable this provider in Valate settings first.')
	if (provider === 'deepl') {
		if (settings.deepl.keyless) return
		if (!settings.deepl.key.trim())
			throw new Error('Add your DeepL API key in Valate settings.')
	}
	if (provider === 'libre') baseUrl(settings.libre.url)
	if (provider === 'oai') {
		baseUrl(settings.oai.url)
		if (
			!settings.oai.model.trim() ||
			settings.oai.model.length > 200 ||
			/[\r\n]/.test(settings.oai.model)
		)
			throw new Error('Choose or enter a model in Valate settings.')
	}
	if (/[\r\n]/.test(config.key))
		throw new Error('The API key contains a line break.')
}

import { iso6393To1 } from 'iso-639-3/iso6393-to-1.js'
