import MagicString from "../node_modules/magic-string";
import * as assert from 'assert';
import * as fs from "fs";
import * as acorn from 'acorn';

export default class Module {
	file: string;
	source: string;
	code: MagicString;
	ast: any;

	superclasses: Map<string, string>;
	methodBlocks: Map<string, string>;
	constructors: Map<string, string>;

	constructor(file: string) {
		this.file = file;
		this.source = fs.readFileSync(file, 'utf-8');
		this.ast = acorn.parse(this.source, {
			ecmaVersion: 9,
			sourceType: 'module'
		});

		this.code = new MagicString(this.source);

		this.superclasses = new Map();
		this.methodBlocks = new Map();
		this.constructors = new Map();

		this.convert();
	}

	findSuperclasses() {
		const { superclasses } = this;
	}

	findAndConvertMethods() {
		this.ast.body.forEach(node => {
			if (node.type !== 'ExpressionStatement') return;
			if (node.expression.type !== 'CallExpression') return;

			// check if this is an Object.assign( SomeClass.prototype, { methods })
			const callee = this.snip(node.expression.callee);
			if (callee !== 'Object.assign') return;

			assert.equal(node.expression.arguments.length, 2);

			const [targetNode, methodsNode] = node.expression.arguments;

			const target = this.snip(targetNode);
			const match = /^(\w+)\.prototype$/.exec(target);

			assert.ok(match, target);

			const name = match[1];

			// check we're actually assigning methods
			assert.ok(methodsNode.properties.every(node => node.value.type === 'FunctionExpression'));

			methodsNode.properties.forEach((prop, i) => {
				// `foo: function()` -> `foo()`
				let c = prop.key.end;
				while (this.source[c] !== '(') c += 1;
				this.code.overwrite(prop.key.end, c, ' ');

				if (i < methodsNode.properties.length - 1) {
					// remove comma
					assert.equal(this.source[prop.end], ',');
					this.code.remove(prop.end, prop.end + 1);
				}
			});

			const methodBlock = `\t${this.code.slice(methodsNode.start + 1, methodsNode.end - 1).trim()}`;

			this.methodBlocks.set(name, methodBlock);

			let c = node.start;
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

			console.log('converting constructor', { name });

			const superclass = this.superclasses.get(name);

			const declaration = superclass
				? `class ${name} extends ${superclass}`
				: `class ${name}`;

			const constructorArgsAndBody = this.code
				.slice(node.id.end, node.body.end)
				.replace(/^/gm, '\t')
				.slice(1);

			const methodBlock = this.methodBlocks.get(name);

			this.code.overwrite(node.start, node.end, `${declaration} {\n\tconstructor ${constructorArgsAndBody}\n\n${methodBlock}\n}`);
		});
	}

	convert() {
		this.findSuperclasses();
		this.findAndConvertMethods();
		this.findAndConvertConstructors();

		// function handleDeclaration(node) {
		// 	const { name } = node.id;
		// 	const superclass = superclasses.get(name);

		// 	const declaration = superclass
		// 		? `class ${name} extends ${superclass}`
		// 		: `class ${name}`;

		// 	console.log(node.start, node.id.end);

		// 	code.overwrite(node.start, node.id.end, `${declaration} {\n\tconstructor`);


		// }

		// ast.body.forEach(statement => {
		// 	if (statement.type === 'FunctionDeclaration') {
		// 		handleDeclaration(statement);
		// 	}

		// 	if (statement.type === 'ExportNamedDeclaration') {
		// 		// TODO handle export named functions
		// 		console.log(statement);
		// 	}
		// });
	}

	snip({ start, end }) {
		return this.source.slice(start, end);
	}

	toString() {
		return this.code.toString();
	}
}