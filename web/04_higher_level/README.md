# Rive JS Runtime

## Play the default animation in the default artboard

```js
var anim = new RiveAnimation({
    src: 'my_animation.riv',
    canvas: document.getElementById('myCanvas'),
    autoplay: true
});
```

## Play a list of animations from a specified artboard

```js
var anim = new RiveAnimation({
    src: 'my_animation.riv',
    artboard: 'MyArtboard',
    animations: ['MyAnimation1', 'MyAnimation2', 'MyAnimation3'],
    canvas: document.getElementById('myCanvas'),
    autoplay: true,
});
```

## Set callbacks for events

```js
var anim = new RiveAnimation({
    src: 'my_animation.riv',
    animations: ['MyAnimation'],
    canvas: document.getElementById('myCanvas'),
    autoplay: true,
    onload: (msg) => { console.log(msg); },
    onloaderror: (msg) => { console.error(msg); },
    onplay: (msg) => { console.log(msg); },
    onloop: (msg) => { console.log(msg + ' animation looped'); }
});
```

## Start playback manually

```play``` can called before the Rive file is loaded; the animation
will begin playing once loading is complete.

```js
var anim = new RiveAnimation({
    src: 'my_animation.riv',
    canvas: document.getElementById('myCanvas'),
});

anim.play();
```