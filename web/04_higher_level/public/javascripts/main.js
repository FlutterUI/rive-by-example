/*
 * Simple high level controller for playing a Rive animation
 */

(function () {

    // Rive Wasm bundle
    var _rive;
    // Tracks whether the Wasm bundle is loaded
    var _wasmLoaded = false;
    // Queued callbacks waiting for Wasm load to complete
    var _wasmLoadQueue = [];

    // Loads the Wasm bundle
    var _loadWasm = function (url) {
        Rive({
            // Loads Wasm bundle
            locateFile: (file) => '/wasm/' + file,
        }).then((rive) => {
            // Wasm successfully loaded
            _rive = rive;
            // Fire all the callbacks
            while (_wasmLoadQueue.length > 0) {
                _wasmLoadQueue.shift()(_rive);
            }
        }).catch((e) => {
            console.error('Unable to load Wasm module');
            throw e;
        });
    };

    // Adds a listener for Wasm load
    var _onWasmLoaded = function(cb) {
        if (_rive !== undefined) {
            // Wasm already loaded, fire immediately
            console.log('Wasm loaded, fire immediately');
            cb(_rive);
        } else {
            console.log('Waiting for Wasm to load');
            // Add to the load queue
            _wasmLoadQueue.push(cb);
        }
    }

    // Start loading the Wasm immediately
    _loadWasm();

    // Loop types. The index of the type is the value that comes from Wasm
    const loopTypes = ['oneShot', 'loop', 'pingPong'];

    /*
     * Loop event constructor
     */
    var LoopEvent = function ({animationName, loopValue}) {
        if (loopValue < 0 || loopValue > loopTypes.length) {
            console.error('Invalid loop value');
            return;
        }
        this.animationName = animationName;
        this.loopType = loopValue;
        this.loopName = loopTypes[loopValue];
    };

    /*
     * RiveAnimation constructor
     */
    var RiveAnimation = function ({
        src, artboard, animations, canvas, autoplay,
        onload, onloaderror, onplay, onplayerror, onloop
    }) {
        const self = this;

        // If no source file url specified, it's a bust
        if (!src) {
            console.error('Rive source file is required.');
            return;
        }
        self._src = src;

        // Name of the artboard. RiveAnimation operates on only one artboard. If
        // you want to have multiple artboards, use multiple RiveAnimations.
        self._artboardName = artboard;

        // List of animations that should be played.
        if (!animations) {
            self._animationNames = null;
        } else if (typeof animations === 'string') {
            self._animationNames = [animations];
        } else if (animations.constructor === Array) {
            self._animationNames = animations;
        }
        
        self._canvas = canvas;
        self._autoplay = autoplay;

        // The Rive Wasm runtime
        self._rive = null;
        // The instantiated artboard
        self._artboard = null;
        // The canvas context
        self._ctx = null;
        // Rive renderer
        self._renderer


        // Tracks when the Rive file is successfully loaded and the Wasm
        // runtime is initialized.
        self._loaded = false;

        // Queue of actions to take. Actions are queued if they're called before
        // RiveAnimation is initialized.
        self._queue = [];

        // Set up the event listeners
        self._onload = typeof onload === 'function' ? [{ fn: onload }] : [];
        self._onloaderror = typeof onloaderror === 'function' ? [{ fn: onloaderror }] : [];
        self._onplay = typeof onplay === 'function' ? [{ fn: onplay }] : [];
        // self._onplayerror = typeof onplayerror === 'function' ? [{ fn: onplayerror }] : [];
        self._onloop = typeof onloop === 'function' ? [{ fn: onloop }] : [];

        // Add 'load' task so the queue can be processed correctly on
        // successful load
        self._queue.push({
            event: 'load',
        });

        // Queue up play if necessary
        if (self._autoplay) {
            self._queue.push({
                event: 'play',
                action: () => {
                    self.play();
                }
            });
        }

        // Wait for Wasm to load
        _onWasmLoaded(self._wasmLoadEvent.bind(self));
    };

    /*
     * RiveAnimation api
     */

    RiveAnimation.prototype = {

        /* 
         * Callback when Wasm bundle is loaded
         */
        _wasmLoadEvent: function (rive) {
            var self = this;

            self._rive = rive;
             self._loadRiveFile();
        },

        /*
         * Loads a Rive file
         */
        _loadRiveFile: function () {
            var self = this;

            const req = new Request(self._src);
            return fetch(req).then((res) => {
                return res.arrayBuffer();
            }).then((buf) => {
                // The raw bytes of the animation are in the buffer, load them into a
                // Rive file
                self._file = self._rive.load(new Uint8Array(buf));

                // Fire the 'load' event and trigger the task queue
                if (self._file) {
                    self._loaded = true;

                    // Initialize playback and paint first frame; do this here
                    // so that if play() has already beren called, things are
                    // initialized before we start firing loaded events
                    self._initializePlayback();

                    // Paint the first frame
                    self._paintFrame();

                    // Emit the load event, which will also kick off processing
                    // the load queue
                    self._emit('load', 'File ' + self._src + ' loaded');
                }
            }).catch((e) => {
                self._emit('loaderror', 'Unable to load ' + self._src);
                console.error('Unable to load Rive file: ' + self._src);
                throw e;
            });
        },

        /*
         * Emits events of specified type
         * @param  {String} event Event name
         * @param  {String} msg   Event message
         * @return {RiveAnimation}
         */
        _emit: function (event, msg) {
            var self = this;
            var events = self['_on' + event];

            // Loop through event store and fire all functions.
            for (var i = events.length - 1; i >= 0; i--) {
                setTimeout(function (fn) {
                    fn.call(this, msg);
                }.bind(self, events[i].fn), 0);
            }

            // Step through any tasks in the queue
            self._loadQueue(event);

            return self;
        },

        /*
         * Actions queued up before the animation was initialized.
         * Takes an optional event parameter; if the event matches the next
         * task in the queue, that task is skipped as it's already occurred.
         * @param  {String} event Event that has just occurred.
         * @return {RiveAnimation}
         */
        _loadQueue: function (event) {
            var self = this;

            if (self._queue.length > 0) {
                var task = self._queue[0];
                // Remove the task  if its event has occurred and trigger the
                // next task. 
                if (task.event === event) {
                    self._queue.shift();
                    self._loadQueue();
                }

                if (!event) {
                    task.action();
                }
            }

            return self;
        },

        /*
         * Initializes artboard, animations, etc. prior to playback
         */
        _initializePlayback: function () {
            const self = this;

            // Get the artboard that contains the animations you want to play.
            // You animate the artboard, using animations it contains.
            self._artboard = self._artboardName ?
                self._file.artboard(self._artboardName) :
                self._file.defaultArtboard();

            // Check that the artboard has at least 1 animation
            if (self._artboard.animationCount() < 1) {
                self._emit('loaderror', 'Artboard has no animations');
                throw 'Artboard has no animations';
            }

            // Get the canvas where you want to render the animation and create a renderer
            self._ctx = self._canvas.getContext('2d');
            self._renderer = new self._rive.CanvasRenderer(self._ctx);

            // Get the animation and instance them
            if (!self._animationNames) {
                // No animations given, use the first one
                self._animations = [self._artboard.animationAt(0)];
            } else {
                self._animations = self._animationNames.map(name => self._artboard.animation(name));
            }

            self._instances = self._animations.map(a => new self._rive.LinearAnimationInstance(a));


            // Tracks the loop states of all animations
            self._loopCounts = [];
            for (var i=0; i< self._instances.length; i++) {
                self._loopCounts.push(0);
            }
        },

        /*
         * Paints the first frame on the animation
         */
        _paintFrame: function () {    
            const self = this;

            // Choose how you want the animation to align in the canvas
            self._ctx.save();
            self._renderer.align(self._rive.Fit.contain, self._rive.Alignment.center, {
                minX: 0,
                minY: 0,
                maxX: self._canvas.width,
                maxY: self._canvas.height
            }, self._artboard.bounds);
    
            // Advance to the first frame and draw the artboard
            self._artboard.advance(0);
            self._artboard.draw(self._renderer);
            self._ctx.restore();
        },

        /*
         * The draw rendering loop
         */
        _draw: function(time) {
            const self = this;

            // This is the looping function where the animation frames will be
            // rendered at the correct time interval

            // On the first pass, make sure lastTime has a valid value
            if (!self._lastTime) {
                self._lastTime = time;
            }
            // Calculate the elapsed time between frames in seconds
            const elapsedTime = (time - self._lastTime) / 1000;
            self._lastTime = time;

            // Advance the animation by the elapsed number of seconds
            for (const i in self._instances) {
                self._instances[i].advance(elapsedTime);
                if (self._instances[i].didLoop) {
                    self._loopCounts[i] += 1;
                }
                // Apply the animation to the artboard. The reason of this is that
                // multiple animations may be applied to an artboard, which will
                // then mix those animations together.
                self._instances[i].apply(self._artboard, 1.0);
            }

            // Once the animations have been applied to the artboard, advance it
            // by the elapsed time.
            self._artboard.advance(elapsedTime);

            // Clear the current frame of the canvas
            self._ctx.clearRect(0, 0, self._canvas.width, self._canvas.height);
            // Render the frame in the canvas
            self._ctx.save();
            self._renderer.align(self._rive.Fit.contain, self._rive.Alignment.center, {
                minX: 0,
                minY: 0,
                maxX: self._canvas.width,
                maxY: self._canvas.height
            }, self._artboard.bounds);
            self._artboard.draw(self._renderer);
            self._ctx.restore();

            for (var i in self._animations) {
                // Emit if the animation looped
                switch (self._animations[i].loopValue) {
                    case 0:
                        // Do nothing; this never loops
                        break;
                    case 1:
                        if (self._loopCounts[i]) {
                            self._emit('loop', new LoopEvent({
                                animationName: self._animations[i].name,
                                loopValue: self._animations[i].loopValue
                            }));
                            self._loopCounts[i] = 0;
                        }
                        break;
                    case 2:
                        // Wasm indicates a loop at each time the animation
                        // changes direction, so a full loop/lap occurs every
                        // two didLoops
                        if (self._loopCounts[i] > 1) {
                            self._emit('loop', new LoopEvent({
                                animationName: self._animations[i].name,
                                loopValue: self._animations[i].loopValue
                            }));
                            self._loopCounts[i] = 0;
                        }
                        break;
                }
            }

            // Calling requestAnimationFrame will call the draw function again
            // at the correct refresh rate. See
            // https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Basic_animations
            // for more details.
            requestAnimationFrame(self._draw.bind(self));
    
        },

        /*
         * Registers a callback for a named event
         */
        on: function (event, fn) {
            var self = this;
            var events = self['_on' + event];

            if (typeof fn === 'function') {
                events.push({ fn: fn });
            }

            return self;
        },

        /*
         * Starts/continues playback
         */
        play: function () {
            const self = this;

            if (!self._loaded) {
                self._queue.push({
                    event: 'play',
                    action: () => {
                        self.play();
                    }
                });
                return;
            }

            // Start animating by calling draw on the next refresh cycle.
            requestAnimationFrame(self._draw.bind(self));

            // Emit a play event
            const msg = 'Playing: ' + self._animationNames.join(', ');
            self._emit('play', msg);
        },

        /*
         * Pauses playback
         */
        pause: function() {},
    };

    /*
     * Utilities and debugging code below
     */ 

    // Handy debugging function to print contents of js object
    function printProps(obj) {
        var propValue;
        for (var propName in obj) {
            propValue = obj[propName]
            console.log(propName, propValue);
        }
    }

    // Test/example code

    var anim = new RiveAnimation({
        src: '/animations/truck_0_6.riv',
        // src: '/animations/pingpong.riv',
        animations: ['idle', 'bouncing', 'windshield_wipers'],
        canvas: document.getElementById('riveCanvas'),
        autoplay: true,
        // onload: (msg) => { console.log(msg); },
        // onloaderror: (msg) => { console.error(msg); },
        // onplay: (msg) => { console.log(msg); },
        // onloop: (l) => { console.log('Loop: ' + l.animationName + ': ' + l.loopName); },
    });

    // Will start the animation once the animation is loaded
    // anim.play();

    // Subscribe to listen to events
    // anim.on('load', () => {
    //     console.log('External detected load');
    // });

})();