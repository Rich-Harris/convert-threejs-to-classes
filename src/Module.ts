import MagicString from "../node_modules/magic-string";
import * as assert from 'assert';
import * as fs from "fs";
import * as acorn from 'acorn';
import { walk } from 'estree-walker';
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
	})),

	simplesubclass: createMatcher('_.prototype = Object.create(_.prototype)', m => ({
		target: m[0],
		superclass: m[1]
	})),

	setconstructor: createMatcher('_.prototype.constructor = _', m => ({
		target: m[0],
		superclass: m[1]
	})),

	assignToPrototype: createMatcher('_ = _ObjectExpression_', m => ({
		target: m[0],
		source: m[1]
	})),

	assignToThree: createMatcher('THREE._Identifier_ = _FunctionExpression_', m => ({
		target: m[0],
		source: m[1]
	}))
};

const notClasses = new Set([
	'String',
	'QuadraticBezier',
	'QuadraticBezierP0',
	'QuadraticBezierP1',
	'QuadraticBezierP2',
	'CubicBezierP0',
	'CubicBezierP1',
	'CubicBezierP2',
	'CubicBezierP3',
	'CubicBezier',
	'CatmullRom',
	'Number',
	'SRGBToLinear',
	'LinearToSRGB',
	'Object',
	'WebGLShader'
]);

export default class Module {
	file: string;
	source: string;
	code: MagicString;
	ast: any;

	isExample: boolean;

	superclasses: Map<string, string>;

	constructors: Map<string, string>;
	methods: Map<string, string[]>;
	staticMethods: Map<string, string[]>;
	properties: Map<string, Array<{ key: string, value: string, isStatic?: boolean }>>;

	constructor(file: string) {
		this.file = file;
		this.source = fs.readFileSync(file, 'utf-8');

		this.ast = acorn.parse(this.source, {
			ecmaVersion: 9,
			sourceType: 'module'
		});

		this.isExample = /examples\.original/.test(file);

		this.code = new MagicString(this.source);

		this.superclasses = new Map([
			['StructuredUniform', 'UniformContainer'], // saves us a job later
			['WebGLUniforms', 'UniformContainer']
		]);
		this.methods = new Map();
		this.staticMethods = new Map();
		this.constructors = new Map();
		this.properties = new Map();

		this.convert();
	}

	addSuperclass(name: string, superclass: string) {
		const existing = this.superclasses.get(name);
		if (existing) assert.equal(superclass, existing);
		assert.notEqual(name, superclass);

		this.superclasses.set(name, superclass);
	}

	findSuperclasses() {
		this.ast.body.forEach(node => {
			let nodes;

			// _ = Object.create(_)
			if (nodes = matchers.simplesubclass(node)) {
				this.superclasses.set(this.snip(nodes.target), this.snip(nodes.superclass));
				this.code.remove(node.start, node.end);
			}

			else if (nodes = matchers.setconstructor(node)) {
				this.code.remove(node.start, node.end);
			}

			else if (nodes = matchers.subclass(node)) {
				const { target, superclass } = nodes;

				const targetMatch = /^((THREE\.)?\w+)(\.prototype)?$/.exec(this.snip(target));
				assert.ok(!!targetMatch[2]);
				const name = targetMatch[1];

				assert.equal(name[0].toUpperCase(), name[0], 'not a class');

				const superclassMatch = /^((THREE\.)?\w+)(\.prototype)?$/.exec(this.snip(superclass));
				assert.ok(!!superclassMatch[2]);
				const superclassName = superclassMatch[1];

				this.superclasses.set(name, superclassName);
			}
		});
	}

	findAndConvertMethods() {
		this.ast.body.forEach(node => {
			const nodes = (
				matchers.assign(node) ||
				matchers.assignToPrototype(node) ||
				matchers.subclass(node)
			);
			if (!nodes) return;

			const { target, source } = nodes;

			const match = /^((THREE\.)?\w+)(\.prototype)?$/.exec(this.snip(target));
			if (!match) return;

			const name = match[1];
			const isStatic = !match[2];

			// don't convert example code, unless it needs to be
			// converted because of superclasses
			const superclass = this.superclasses.get(name);
			if (!superclass && /examples\.original/.test(this.file)) {
				return;
			}

			let c: number = source.start + 1;
			while (/\s/.test(this.source[c])) c += 1;

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

				else if (prop.key.name !== 'constructor') {
					if (!this.properties.has(name)) {
						this.properties.set(name, []);
					}

					this.properties.get(name).push({
						key: prop.key.name,
						isStatic,
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

			if (!node) return;

			if (node.type === 'FunctionDeclaration') {
				const { name } = node.id;
				this.overwriteConstructorBody(node, name);
			} else {
				const nodes = matchers.assignToThree(node);
				if (!nodes) return;

				const name = nodes.target.name;
				this.overwriteConstructorBody(nodes.source, `THREE.${name}`);
			}
		});
	}

	overwriteConstructorBody(node: any, name: string) {
		if (name[0].toUpperCase() !== name[0]) return; // not a class
		if (notClasses.has(name)) return;

		// don't convert example code, unless it needs to be
		// converted because of superclasses
		const superclass = this.superclasses.get(name);
		if (!superclass && /examples\.original/.test(this.file)) {
			return;
		}

		const declaration = superclass
			? `class ${name.replace('THREE.', '')} extends ${superclass}`
			: `class ${name.replace('THREE.', '')}`;

		const needsConstructor = this.makeValidConstructor(this.code, node, superclass);

		let ctor = null;
		if (needsConstructor) {
			let start = node.id
				? node.id.end
				: node.start + 8;

			while (this.code.original[start] !== '(') start += 1;

			ctor = needsConstructor && (
				`constructor ${this.code
					.slice(start, node.body.end)
					.replace(/^\t/gm, '\t\t')
					.replace(/^}/m, '\t}')}`
			);
		}

		const methods = this.methods.get(name) || [];
		const staticMethods = this.staticMethods.get(name) || [];

		const combined = [ctor, ...methods, ...staticMethods]
			.filter(Boolean)
			.join('\n\n\t');

		const properties = (this.properties.get(name) || []).map(prop => {
			const lhs = prop.isStatic
				? `${name}.${prop.key}`
				: `${name}.prototype.${prop.key}`;

			return `\n\n${lhs} = ${prop.value.replace(/^\t/gm, '')};`;
		});

		const body = `{\n\t${combined}\n}`;

		this.code.overwrite(node.start, node.end, `${declaration} ${body}${properties.join('')}`);
	}

	makeValidConstructor(code: MagicString, node: any, superclass: string) {
		if (!superclass) return node.body.body.length > 0;

		let statements = [];
		let c = node.body.start + 1;

		for (const statement of node.body.body) {
			// if this is a `Superclass.call` expression, replace with super
			const isSuper = (
				statement.type === 'ExpressionStatement' &&
				statement.expression.type === 'CallExpression' &&
				statement.expression.callee.type === 'MemberExpression' &&
				statement.expression.callee.property.name === 'call' &&
				this.snip(statement.expression.callee.object) === superclass &&
				statement.expression.arguments[0].type === 'ThisExpression'
			);

			if (isSuper) {
				if (statement.expression.arguments.length === 1) {
					code.overwrite(statement.expression.start, statement.expression.end, 'super()');
				} else {
					code.overwrite(statement.expression.callee.start, statement.expression.callee.end, 'super');
					code.remove(statement.expression.arguments[0].start, statement.expression.arguments[1].start);
				}

				// append all `this.x` statements
				if (statements.length > 0) {
					statements.forEach(s => code.remove(s.start, s.end));
					code.appendLeft(statement.end, statements.map(s => s.content).join(''));
				}

				return true;
			}

			const snippet = code.original.slice(statement.start, statement.end);
			if (/this/.test(snippet)) {
				statements.push({
					start: statement.start,
					end: statement.end,
					content: code.original.slice(c, statement.end)
				});
			}

			c = statement.end;
		}

		if (node.body.body.length === 0) return false;

		// if we're here, we never encountered super()
		code.prependRight(node.body.body[0].start, 'super();\n\n\t');

		return true;
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

// function needsConstructor(node: any, superclass: string) {
// 	const { body } = node.body;

// 	if (body.length === 0) return false;
// 	if (body.length > 1) return true;

// 	const statement = body[0];
// 	if (statement.type !== 'ExpressionStatement') return true;
// 	if (statement.expression.type !== 'CallExpression') return true;

// 	const { callee } = statement.expression;
// 	if (callee.type !== 'MemberExpression') return true;

// 	if (callee.property.name !== 'call') return true;
// 	if (callee.object.name !== superclass) return true;

// 	if (statement.expression.arguments[0].type !== 'ThisExpression') return true;

// 	const params = node.params;
// 	const args = statement.expression.arguments.slice(1);

// 	if (args.some((arg: any) => arg.type !== 'Identifier')) return true;

// 	return params.map((p: any) => p.name).join(',') !== args.map((p: any) => p.name).join(',');
// }