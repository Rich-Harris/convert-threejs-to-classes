import * as acorn from 'acorn';

function tryParse(str: string) {
	try {
		return acorn.parseExpressionAt(str, 0);
	} catch (err) {
		return null;
	}
}

export function createMatcher(template: string, fn: (matches: any[]) => Record<string, any>) {
	const base = tryParse(template);

	if (!base) {
		throw new Error(`Could not parse ${template}`);
	}

	function match(a: any, b: any, matches: any[]) {
		if (a.type === 'Identifier') {
			if (a.name === '_') {
				matches.push(b);
				return true;
			}

			const match = /^_(\w+)_$/.exec(a.name);
			if (match) {
				if (b.type !== match[1]) return false;

				matches.push(b);
				return true;
			}
		}

		const { type } = a;
		if (type !== b.type) return false;

		if (type === 'Literal') return a.value === b.value;
		if (type === 'Identifier') return a.name === b.name;

		const keys = Object.keys(a).filter(key => {
			return key !== 'start' && key !== 'end';
		});

		const childKeys = keys.filter(key => typeof a[key] === 'object');
		const otherKeys = keys.filter(key => typeof a[key] !== 'object');

		for (const key of otherKeys) {
			if (a[key] !== b[key]) return false;
		}

		for (const key of childKeys) {
			if (!a[key] !== !b[key]) return false;
		}

		childKeys.sort((p, q) => a[p].start - a[q].start);

		for (const key of childKeys) {
			if (!match(a[key], b[key], matches)) return false;
		}

		return true;
	}

	return function(node: any) {
		const matches: any[] = [];

		if (node.type === 'ExpressionStatement') node = node.expression;

		return match(base, node, matches) ? fn(matches) : null;
	}
}