export function isExternalLink(href: string): boolean {
	return /^https?:\/\//i.test(href);
}
