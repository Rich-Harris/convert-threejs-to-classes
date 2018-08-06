import * as fs from 'fs';
import glob from 'tiny-glob/sync';
import * as acorn from 'acorn';
import c from 'ansi-colors';
import Module from './Module';

import sms from 'source-map-support';
sms.install();

const SRC = 'three.js/src.original';
const DEST = 'three.js/src';

function createRegex(filter: string) {
	filter = filter
		// .replace(/\//g, '\\/')
		.replace(/\*\*/g, '.+')
		.replace(/\*/g, '[^/]+');

	return new RegExp(`^${filter}$`);
}

const regex = process.argv[2]
	? createRegex(process.argv[2])
	: /./;

const blacklist = new Set([
	'math/Vector3.js',
	'math/Quaternion.js',
	'math/Box3.js'
]);

const files = glob('**/*.js', { cwd: SRC })
	.filter((file: string) => !blacklist.has(file))
	.filter((file: string) => regex.test(file));

function isValid(str: string) {
	try {
		acorn.parse(str, {
			ecmaVersion: 9,
			sourceType: 'module'
		});
		return true;
	} catch (err) {
		return false;
	}
}

files.forEach((file: string) => {
	try {
		const mod = new Module(`${SRC}/${file}`);
		const output = mod.toString();

		fs.writeFileSync(`${DEST}/${file}`, output);

		if (isValid(output)) {
			console.log(`${c.bold.green('✔')} ${file}`);
		} else {
			console.log(c.bold.red(`! ${file}`));
			console.log(`Generated invalid code`);
		}
	} catch (err) {
		console.log(c.bold.red(`! ${file}`));
		console.log(err.stack);
	}
});

glob('**/*.js', { cwd: 'overrides' }).forEach((file: string) => {
	const data = fs.readFileSync(`overrides/${file}`);
	fs.writeFileSync(`three.js/${file}`, data);
});