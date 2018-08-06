import MagicString from "../node_modules/magic-string";
import * as assert from 'assert';
import * as fs from "fs";
import * as acorn from 'acorn';
import { createMatcher } from "./match";

const matchers = {
	assign: createMatcher('Object.assign(_, _ObjectExpression_)', m => ({
		target: m[0],
		source: m[1]
	})),

	subclass: createMatcher('_ = Object.assign(Object.create(_), _ObjectExpression_)', m => ({
		target: m[0],
		superclass: m[1],
		source: m[2]
	}))
};

export default class Module {
	file: string;
	source: string;
	code: MagicString;
	ast: any;

	superclasses: Map<string, string>;

	constructors: Map<string, string>;
	methods: Map<string, string[]>;
	staticMethods: Map<string, string[]>;
	properties: Map<string, Array<{ key: string, value: string }>>;

	constructor(file: string) {
		this.file = file;
		this.source = fs.readFileSync(file, 'utf-8');
		this.ast = acorn.parse(this.source, {
			ecmaVersion: 9,
			sourceType: 'module'
		});

		this.code = new MagicString(this.source);

		this.superclasses = new Map();
		this.methods = new Map();
		this.staticMethods = new Map();
		this.constructors = new Map();
		this.properties = new Map();

		this.convert();
	}

	findSuperclasses() {
		this.ast.body.forEach(node => {
			// AnimationMixer.prototype = Object.assign( Object.create( EventDispatcher.prototype ), {
			const nodes = matchers.subclass(node);
			if (!nodes) return;

			const { target, superclass, source } = nodes;

			const match = /^(\w+)(\.prototype)?$/.exec(this.snip(target));
			assert.ok(!!match[2]);

			const name = match[1];

			if (name[0].toUpperCase() !== name[0]) return; // not a class

			this.superclasses.set(name, superclass.name);
		});
	}

	findAndConvertMethods() {
		this.ast.body.forEach(node => {
			const nodes = matchers.assign(node) || matchers.subclass(node);
			if (!nodes) return;

			const { target, source } = nodes;

			const match = /^(\w+)(\.prototype)?$/.exec(this.snip(target));

			const name = match[1];
			const isStatic = !match[2];

			let c: number = source.start + 1;

			// remove constructor
			const index = source.properties.findIndex(prop => prop.key.name === 'constructor');
			assert.ok(index <= 0);
			if (index === 0) {
				assert.ok(source.properties.length > 1);
				const prop = source.properties.shift();

				this.code.remove(prop.start, source.properties[1].start);
				c = prop.end + 1;
			}

			while (/\s/.test(this.source[c])) c += 1;

			// check we're actually assigning methods

			source.properties.forEach(prop => {
				if (prop.value.type === 'FunctionExpression') {
					// `foo: function()` -> `foo()`
					let argsStart = prop.key.end;
					while (this.source[argsStart] !== '(') argsStart += 1;
					this.code.overwrite(prop.key.end, argsStart, ' ');

					if (isStatic) {
						this.code.overwrite(prop.key.start, prop.key.end, `static ${prop.key.name}`);

						if (!this.staticMethods.get(name)) {
							this.staticMethods.set(name, []);
						}

						this.staticMethods.get(name).push(this.code.slice(c, prop.end));
					} else {
						if (!this.methods.get(name)) {
							this.methods.set(name, []);
						}

						this.methods.get(name).push(this.code.slice(c, prop.end));
					}
				}

				else {
					if (!this.properties.has(name)) {
						this.properties.set(name, []);
					}

					this.properties.get(name).push({
						key: prop.key.name,
						value: this.source.slice(prop.value.start, prop.value.end)
					});

					this.code.remove(c, prop.end);
				}

				c = prop.end;
				while (c < this.source.length && this.source[c] !== ',') c += 1;
				c += 1;
				while (c < this.source.length && /\s/.test(this.source[c])) c += 1;
			});

			c = node.start;
			while (/\s/.test(this.source[c - 1])) c -= 1;

			this.code.remove(c, node.end);
		});
	}

	findAndConvertConstructors() {
		this.ast.body.forEach(node => {
			if (node.type === 'ExportNamedDeclaration') {
				node = node.declaration;
			}

			if (!node || node.type !== 'FunctionDeclaration') return;
			const { name } = node.id;

			if (name[0].toUpperCase() !== name[0]) return; // not a class

			const superclass = this.superclasses.get(name);

			const declaration = superclass
				? `class ${name} extends ${superclass}`
				: `class ${name}`;

			const constructorArgsAndBody = this.code
				.slice(node.id.end, node.body.end)
				.replace(/^/gm, '\t')
				.slice(1);

			const methods = this.methods.get(name) || [];
			const staticMethods = this.staticMethods.get(name) || [];

			const combined = [...methods, ...staticMethods]
				.filter(Boolean)
				.join('\n\n\t');

			const properties = (this.properties.get(name) || []).map(prop => {
				return `\n\n${name}.prototype.${prop.key} = ${prop.value.replace(/^\t/gm, '')};`;
			});

			const body = `{\n\tconstructor ${constructorArgsAndBody}\n\n\t${combined}\n}`;

			this.code.overwrite(node.start, node.end, `${declaration} ${body}${properties.join('')}`);
		});
	}

	convert() {
		this.findSuperclasses();
		this.findAndConvertMethods();
		this.findAndConvertConstructors();
	}

	snip({ start, end }) {
		return this.source.slice(start, end);
	}

	toString() {
		return this.code.toString();
	}
}