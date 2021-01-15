/*
 * Simple high level controller for playing a Rive animation
 */

(function () {

    // Loop enum values
    const loopValues = { 'oneShot': 0, 'loop': 1, 'pingPong': 2 };

    // Handy debugging function to print contents of js object
    function printProps(obj) {
        var propValue;
        for (var propName in obj) {
            propValue = obj[propName]
            console.log(propName, propValue);
        }
    }

    // Craates a new RiveAnimation controller; don't use this directly, use
    // RiveAnimation.init() instead
    var RiveAnimation = function ({
        src, artboard, animation, canvas, autoplay,
        onload, onloaderror, onplay, onplayerror, onloop
    }) {
        const self = this;

        if (!src) {
            console.error('Rive source file is required.');
            return;
        }
        self._artboard = artboard;
        self._animation = animation;
        self._canvas = canvas;
        self._autoplay = autoplay;

        self._loaded = false;

        // Queue of actions to take
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

        // Load the Wasm and Rive file
        var res = self._loadWasm();
        res.then(() => {
            return self._loadRiveFile(src).then(() => {
                self._loaded = true;
                return self;
            });
        }).catch((e) => {
            console.error('Unable to load Rive Wasm bundle');
            throw e;
        });

        // return self;
    };

    // RiveAnimation api
    RiveAnimation.prototype = {

        /*
         * Loads a Rive file
         */
        _loadWasm: function (url) {
            var self = this;

            return Rive({
                // Loads file
                locateFile: (file) => '/wasm/' + file,
            }).then((rive) => {
                self._rive = rive;
                return rive;
            }).catch((e) => {
                console.error('Unable to load Wasm module');
                throw e;
            });
        },

        /*
         * Loads a Rive file
         */
        _loadRiveFile: function (src) {
            var self = this;

            const req = new Request(src);
            return fetch(req).then((res) => {
                return res.arrayBuffer();
            }).then((buf) => {
                // The raw bytes of the animation are in the buffer, load them into a
                // Rive file
                self._file = self._rive.load(new Uint8Array(buf));

                // Fire the 'load' event and trigger the task queue
                if (self._file) {
                    self._loaded = true;
                    self._emit('load', 'File ' + src + ' loaded');
                }

                return;
            }).catch((e) => {
                self._emit('loaderror', 'Unable to load ' + src);
                console.error('Unable to load Rive file: ' + src);
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

        on: function (event, fn) {
            var self = this;
            var events = self['_on' + event];

            if (typeof fn === 'function') {
                events.push({ fn: fn });
            }

            return self;
        },

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

            // Get the artboard that contains the animations you want to play.
            // You animate the artboard, using the animations it contains.
            const artboard = self._artboard ? self._file.artboard(self._artboard) : self._file.defaultArtboard();

            // Get an animation and instance it
            const animation = artboard.animation(self._animation);
            const instance = new self._rive.LinearAnimationInstance(animation);

            // Get the canvas where you want to render the animation and create a renderer
            const ctx = self._canvas.getContext('2d');
            const renderer = new self._rive.CanvasRenderer(ctx);

            // Track the last time the loop was performed
            let lastTime = 0;

            // Tracks the animation time for detecting looping
            let lastAnimationTime = 0;

            // Tracks the loop state of an animation
            var loopCount = 0;

            // This is the looping function where the animation frames will be
            // rendered at the correct time interval
            function draw(time) {
                // On the first pass, make sure lastTime has a valid value
                if (!lastTime) {
                    lastTime = time;
                }
                // Calculate the elapsed time between frames in seconds
                const elapsedTime = (time - lastTime) / 1000;
                lastTime = time;

                // Advance the animation by the elapsed number of seconds
                instance.advance(elapsedTime);
                if (instance.didLoop) {
                    loopCount++;
                }

                // Apply the animation to the artboard. The reason of this is that
                // multiple animations may be applied to an artboard, which will
                // then mix those animations together.
                instance.apply(artboard, 1.0);
                // Once the animations have been applied to the artboard, advance it
                // by the elapsed time.
                artboard.advance(elapsedTime);

                // Clear the current frame of the canvas
                ctx.clearRect(0, 0, self._canvas.width, self._canvas.height);
                // Render the frame in the canvas
                ctx.save();
                renderer.align(self._rive.Fit.contain, self._rive.Alignment.center, {
                    minX: 0,
                    minY: 0,
                    maxX: self._canvas.width,
                    maxY: self._canvas.height
                }, artboard.bounds);
                artboard.draw(renderer);
                ctx.restore();

                // Emit if the animation looped
                switch (animation.loopValue) {
                    case loopValues.oneShot:
                        // Do nothing; this never loops
                        break;
                    case loopValues.loop:
                        if (loopCount) {
                            self._emit('loop', 'oneShot');
                            loopCount = 0;
                        }
                        break;
                    case loopValues.pingPong:
                        // Wasm indicates a loop at each time the animation
                        // changes direction, so a full loop/lap occurs every
                        // two didLoops
                        if (loopCount > 1) {
                            self._emit('loop', 'pingPong');
                            loopCount = 0;
                        }
                        break;
                }

                // Calling requestAnimationFrame will call the draw function again
                // at the correct refresh rate. See
                // https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Basic_animations
                // for more details.
                requestAnimationFrame(draw)
            }

            // Start animating by calling draw on the next refresh cycle.
            requestAnimationFrame(draw);

            // Emit a play event
            self._emit('play', 'Playing ' + self._animation);
        }

    };

    // Test/example code

    var anim = new RiveAnimation({
        // src: '/animations/marty_0_6.riv',
        src: '/animations/pingpong.riv',
        animation: 'Animation1',
        canvas: document.getElementById('riveCanvas'),
        // autoplay: true,
        onload: (msg) => { console.log(msg); },
        onloaderror: (msg) => { console.error(msg); },
        onplay: (msg) => { console.log(msg); },
        onloop: (msg) => { console.log(msg + ' animation looped'); }
    });

    // Will start the animation once the animation is loaded
    anim.play();

    // Subscribe to listen to events
    anim.on('load', () => {
        console.log('External detected load');
    });

})();