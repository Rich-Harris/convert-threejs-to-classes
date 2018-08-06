import * as fs from 'fs';
import glob from 'tiny-glob/sync';
import Module from './Module';

const SRC = 'three.js/src.original';
const DEST = 'three.js/src';

const files = glob('**/*.js', { cwd: SRC })
.filter((file: string) => /AnimationAction/.test(file));

files.forEach((file: string) => {
	const mod = new Module(`${SRC}/${file}`);
	fs.writeFileSync(`${DEST}/${file}`, mod.toString());
});