# convert-threejs-to-classes

This is a script for converting the [Three.js codebase](https://github.com/mrdoob/three.js) to ES2015 classes.

It's very bad code — it's not intended to be maintained over time, but rather to convert the codebase once in order to create a pull request.


## Running the converter

* Clone this repo
* Install dependencies with `npm install`
* Run `npm run pull` to fetch the Three.js repo
* `(cd three.js && npm install)` to install Three.js's dependencies
* Run `npm run test` to run the converter and check that the unit tests still pass.

Once that's done, `cd three.js` then:

* `npm run build` to build the bundle
* `npx serve` to serve the site, then visit [localhost:5000/examples](http://localhost:5000/examples) to make sure the examples still work (some of them don't! See below)
* `rm -rf src.original examples.original` to get rid of the original source code that has been replaced


## Why are you doing this?

There are several good reasons to update from functions to classes. Firstly, the resulting bundle is smaller and faster:

|              | size    | minified | gzipped |
|--------------|---------|----------|---------|
| current      | 1104363 | 774528   | 158525  |
| with classes | 1068830 | 738111   | 154331  |

The minified JavaScript is roughly 5% smaller. Profiling shows that there's an even bigger reduction in the time the browser typically spends parsing and evaluating the bundle.

Secondly, they're (arguably!) much nicer — instead of this...

```js
function Path( points ) {

	CurvePath.call( this );

	// ...

}

Path.prototype = Object.assign( Object.create( CurvePath.prototype ), {

	constructor: Path,

	setFromPoints: function ( points ) {

		// ...

	},

	// ...

} );
```

...we can do this:

```js
class Path extends CurvePath {
	constructor ( points ) {

		super();

		// ...

	}

	setFromPoints ( points ) {

		// ...

	}

	// ...
}
```

The intent of the code is much more explicit, and it's just a lot more compact and *neat*.

Classes are also easier to statically analyse than the alternative, which hopefully paves the way for tree-shaking. We're not quite there yet, as there's still a lot of not-quite-idiomatic code in the Three.js codebase which make static analysis tricky. But we can fix that!


## What's broken/missing?

All the tests pass, and almost all the examples continue to work. The ones that *don't* work are broken because with classes you can no longer do this sort of thing (**which would be a breaking change for some Three.js users**):

```js
function ConvexBufferGeometry( points ) {

	THREE.BufferGeometry.call( this );

	// ...

}
```

Instead, you must make `ConvexBufferGeometry` a subclass of `THREE.BufferGeometry`:

```js
class ConvexBufferGeometry extends THREE.BufferGeometry {
	constructor ( points ) {

		super();

		// ...

	}

	// ...
}
```

Automatically converting all those cases is tricky. It might be easier just to fix them manually in a second pull request.

Another difference between classes and functions relates to hoisting. Because functions are hoisted to the top of the scope, circular dependencies (such as exist between `Matrix4` and `Vector3`) aren't a huge problem. Classes are not hoisted in the same way, which means that the order of concatenation matters. The cases where this is a problem can easily be fixed manually, but as far as this converter is concerned, the easiest thing is just to leave `Vector3`, `Box3` and `Quaternion` as functions.


## Follow-up work

Aside from fixing the broken examples, there are a few opportunities to tweak the codebase further. For example there are several cases where methods are defined inside IIFEs — presumably a legacy from before the codebase was modularised, when it was important to avoid variable name clashes:

```js
intersectsSphere: ( function () {

	var closestPoint = new Vector3();

	return function intersectsSphere( sphere ) {

		// Find the point on the AABB closest to the sphere center.
		this.clampPoint( sphere.center, closestPoint );

		// If that point is inside the sphere, the AABB and sphere intersect.
		return closestPoint.distanceToSquared( sphere.center ) <= ( sphere.radius * sphere.radius );

	};

} )(),
```

The code above (assigning a method to `Box3`) could instead be written like so:

```js
// at the top of the file
let closestPoint;

// inside the class body
intersectsSphere ( sphere ) {

	if (!closestPoint) closestPoint = new Vector3();

	// Find the point on the AABB closest to the sphere center.
	this.clampPoint( sphere.center, closestPoint );

	// If that point is inside the sphere, the AABB and sphere intersect.
	return closestPoint.distanceToSquared( sphere.center ) <= ( sphere.radius * sphere.radius );

}
```

Changing this would allow `Vector3` to become a class rather than a function.


## License

[LIL](LICENSE)