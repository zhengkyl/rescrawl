# rescrawl

Draw beautiful lines and save as an animated SVG

Create animated handwriting SVGs

Try it: https://rescrawl.kylezhe.ng

Originally made for this blog post https://kylezhe.ng/writes/shakespeares-sonnets

### The pipeline

A Primer on Bézier Curves

- https://pomax.github.io/bezierinfo/index.html

https://raphlinus.github.io/curves/2022/09/09/parallel-beziers.html

https://github.com/paperjs/paper.js/issues/371

`rescrawl` converts a list of (x, y, t) points into a brush-like stroke. The stroke width varies with speed and time to imitate flowing ink. For a different approach using only (x, y) points try the legendary [perfect-freehand](https://github.com/steveruizok/perfect-freehand).


### notes

- some pens report pressure 0 on pointerDown
